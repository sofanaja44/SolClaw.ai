import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { TRADING_SYSTEM_PROMPT, TRADE_ANALYSIS_TOOLS } from './prompts.js';
import type {
    TradeSignal,
    TPSLResult,
    MarketSnapshot,
    Position,
    CloseDecision,
    BotState,
} from '../jupiter/types.js';

/**
 * AI Trading Agent — powered by OpenRouter.
 * Analyzes market, decides trades, calculates TP/SL.
 */
export class TradingAIAgent {
    private apiKey: string;
    private model: string;
    private baseUrl = 'https://openrouter.ai/api/v1/chat/completions';

    constructor() {
        this.apiKey = CONFIG.OPENROUTER_API_KEY;
        this.model = CONFIG.OPENROUTER_MODEL;
    }

    /**
     * Analyze market snapshot and decide: BUY, SELL, or HOLD.
     */
    async analyzeMarket(
        snapshot: MarketSnapshot,
        state: BotState
    ): Promise<{
        action: 'BUY' | 'SELL' | 'HOLD';
        toolCall?: {
            name: string;
            arguments: Record<string, unknown>;
        };
    }> {
        const userMessage = this.buildAnalysisPrompt(snapshot, state);

        try {
            const response = await this.callOpenRouter(userMessage);

            // Check if AI returned a tool call
            const message = response.choices?.[0]?.message;

            if (message?.tool_calls && message.tool_calls.length > 0) {
                const toolCall = message.tool_calls[0];
                const args = JSON.parse(toolCall.function.arguments);

                logger.info(`🧠 AI Decision: ${toolCall.function.name} — ${args.reasoning || ''}`);

                if (toolCall.function.name === 'execute_buy') {
                    return { action: 'BUY', toolCall: { name: 'execute_buy', arguments: args } };
                }
                if (toolCall.function.name === 'close_position') {
                    return { action: 'SELL', toolCall: { name: 'close_position', arguments: args } };
                }
                return { action: 'HOLD', toolCall: { name: 'hold', arguments: args } };
            }

            // No tool call — treat as HOLD
            logger.info(`🧠 AI: No action (HOLD) — ${message?.content?.slice(0, 100) || 'no response'}`);
            return { action: 'HOLD' };
        } catch (err) {
            logger.error(`❌ AI Agent error: ${err}`);
            return { action: 'HOLD' };
        }
    }

    /**
     * Calculate optimal TP/SL for a specific trade.
     */
    async calculateTPSL(params: {
        token: string;
        entryPrice: number;
        balance: number;
        positionSize: number;
        currentPrice: number;
    }): Promise<TPSLResult> {
        const prompt = `Calculate optimal Take Profit and Stop Loss for this trade:

Token: ${params.token}
Entry Price: $${params.entryPrice.toFixed(8)}
Current Price: $${params.currentPrice.toFixed(8)}
Position Size: ${params.positionSize} SOL
Account Balance: ${params.balance} SOL

Requirements:
- Minimum risk/reward ratio: 1:${CONFIG.MIN_RISK_REWARD_RATIO}
- This is a meme coin on Solana — high volatility expected
- Consider the position size relative to balance

Respond in this exact JSON format:
{
  "tp_price": <number>,
  "sl_price": <number>,
  "risk_reward_ratio": <number>,
  "reasoning": "<string>"
}`;

        try {
            const response = await this.callOpenRouter(prompt, false);
            const content = response.choices?.[0]?.message?.content || '';

            // Parse JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    tp: parsed.tp_price,
                    sl: parsed.sl_price,
                    riskRewardRatio: parsed.risk_reward_ratio || CONFIG.MIN_RISK_REWARD_RATIO,
                    reasoning: parsed.reasoning || 'AI calculated TP/SL',
                };
            }

            // Fallback: use default percentages
            return this.defaultTPSL(params.entryPrice);
        } catch (err) {
            logger.warn(`⚠️ AI TPSL calculation failed, using defaults: ${err}`);
            return this.defaultTPSL(params.entryPrice);
        }
    }

    /**
     * Check if a position should be closed based on current conditions.
     */
    async shouldClosePosition(
        position: Position,
        currentPrice: number,
        state: BotState
    ): Promise<CloseDecision> {
        // Hard TP/SL check (no AI needed)
        if (currentPrice >= position.tp) {
            return {
                shouldClose: true,
                reason: `🎯 Take Profit hit! Entry: $${position.entryPrice.toFixed(8)}, TP: $${position.tp.toFixed(8)}, Current: $${currentPrice.toFixed(8)}`,
                urgency: 'HIGH',
            };
        }

        if (currentPrice <= position.sl) {
            return {
                shouldClose: true,
                reason: `🛑 Stop Loss hit! Entry: $${position.entryPrice.toFixed(8)}, SL: $${position.sl.toFixed(8)}, Current: $${currentPrice.toFixed(8)}`,
                urgency: 'HIGH',
            };
        }

        return { shouldClose: false, reason: 'Position within TP/SL range', urgency: 'LOW' };
    }

    private buildAnalysisPrompt(snapshot: MarketSnapshot, state: BotState): string {
        const positionsSummary =
            state.positions.length > 0
                ? state.positions
                    .map(
                        (p) =>
                            `  - ${p.token}: entry=$${p.entryPrice.toFixed(8)} current=$${p.currentPrice.toFixed(8)} TP=$${p.tp.toFixed(8)} SL=$${p.sl.toFixed(8)} size=${p.amountSol}SOL`
                    )
                    .join('\n')
                : '  None';

        const tokenList =
            snapshot.watchlist.length > 0
                ? snapshot.watchlist
                    .map(
                        (t) =>
                            `  - ${t.symbol} (${t.mint.slice(0, 8)}...): price=$${t.price.toFixed(8)} 1h=${t.priceChange1h > 0 ? '+' : ''}${t.priceChange1h.toFixed(1)}% 24h=${t.priceChange24h > 0 ? '+' : ''}${t.priceChange24h.toFixed(1)}% vol=$${(t.volume24h / 1000).toFixed(0)}k liq=$${(t.liquidity / 1000).toFixed(0)}k`
                    )
                    .join('\n')
                : '  No tokens on watchlist';

        return `MARKET SNAPSHOT (${new Date(snapshot.timestamp).toISOString()}):

SOL Price: $${snapshot.solPrice.toFixed(2)}

WATCHLIST TOKENS:
${tokenList}

PORTFOLIO:
  Balance: ${state.balanceSol.toFixed(4)} SOL
  Daily PnL: ${state.dailyPnL > 0 ? '+' : ''}${state.dailyPnL.toFixed(4)} SOL
  Max Position: ${CONFIG.MAX_POSITION_SOL} SOL
  Trades today: ${state.tradesCount}

OPEN POSITIONS:
${positionsSummary}

Analyze the market and decide: Should we BUY any token, CLOSE any position, or HOLD?
Only recommend BUY if you see strong indicators and risk/reward >= 1:${CONFIG.MIN_RISK_REWARD_RATIO}.`;
    }

    private async callOpenRouter(
        userMessage: string,
        useTools: boolean = true
    ): Promise<{
        choices: Array<{
            message: {
                content?: string;
                tool_calls?: Array<{
                    function: { name: string; arguments: string };
                }>;
            };
        }>;
    }> {
        const body: Record<string, unknown> = {
            model: this.model,
            messages: [
                { role: 'system', content: TRADING_SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.3,
            max_tokens: 1024,
        };

        if (useTools) {
            body.tools = TRADE_ANALYSIS_TOOLS;
            body.tool_choice = 'auto';
        }

        const res = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://solana-trading-bot',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`OpenRouter API failed (${res.status}): ${errText}`);
        }

        return (await res.json()) as {
            choices: Array<{
                message: {
                    content?: string;
                    tool_calls?: Array<{
                        function: { name: string; arguments: string };
                    }>;
                };
            }>;
        };
    }

    private defaultTPSL(entryPrice: number): TPSLResult {
        return {
            tp: entryPrice * 1.2, // +20%
            sl: entryPrice * 0.92, // -8%
            riskRewardRatio: 2.5,
            reasoning: 'Default TP/SL: +20% / -8% (fallback when AI unavailable)',
        };
    }
}
