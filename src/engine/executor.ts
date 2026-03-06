import { randomUUID } from 'crypto';
import { CORE_TOKENS, TokenRegistry } from '../config/tokens.js';
import { CONFIG, calculatePositionSol } from '../config/index.js';
import { JupiterConnector } from '../jupiter/index.js';
import { TradingAIAgent } from '../ai/agent.js';
import { RiskManager } from '../risk/manager.js';
import { StateManager } from '../state/manager.js';
import { WalletManager } from '../wallet/index.js';
import { logger, logTrade } from '../utils/logger.js';
import { alertBuy, alertSell } from '../utils/telegram.js';
import type { MarketSnapshot, Position } from '../jupiter/types.js';

/**
 * Trade Executor — orchestrates the full trade pipeline.
 * AI Analysis → Risk Check → Jupiter Swap → Record.
 * Uses 1% of balance per trade for conservative risk management.
 */
export class TradeExecutor {
    private jupiter: JupiterConnector;
    private ai: TradingAIAgent;
    private risk: RiskManager;
    private stateManager: StateManager;
    private wallet: WalletManager;
    private tokenRegistry: TokenRegistry;
    public onAIDecision: ((d: { action: string; reasoning: string; token?: string }) => void) | null = null;

    constructor(
        jupiter: JupiterConnector,
        ai: TradingAIAgent,
        risk: RiskManager,
        stateManager: StateManager,
        wallet: WalletManager,
        tokenRegistry: TokenRegistry
    ) {
        this.jupiter = jupiter;
        this.ai = ai;
        this.risk = risk;
        this.stateManager = stateManager;
        this.wallet = wallet;
        this.tokenRegistry = tokenRegistry;
    }

    async execute(snapshot: MarketSnapshot): Promise<void> {
        const state = this.stateManager.state;

        // AI analyzes market
        const decision = await this.ai.analyzeMarket(snapshot, state);

        // Emit AI decision to dashboard
        if (this.onAIDecision) {
            const token = decision.toolCall?.arguments?.token_symbol as string || '';
            this.onAIDecision({
                action: decision.action,
                reasoning: (decision.toolCall?.arguments?.reasoning as string) || '',
                token,
            });
        }

        if (decision.action === 'HOLD') {
            return;
        }

        if (decision.action === 'BUY' && decision.toolCall?.name === 'execute_buy') {
            await this.executeBuy(decision.toolCall.arguments, snapshot);
        }

        if (decision.action === 'SELL' && decision.toolCall?.name === 'close_position') {
            const mint = decision.toolCall.arguments.token_mint as string;
            const position = state.positions.find((p) => p.mint === mint);
            if (position) {
                await this.executeClose(position, decision.toolCall.arguments.reasoning as string);
            }
        }
    }

    private async executeBuy(
        args: Record<string, unknown>,
        snapshot: MarketSnapshot
    ): Promise<void> {
        const tokenSymbol = args.token_symbol as string;
        let tokenMint = args.token_mint as string;
        const tpPct = args.tp_percentage as number;
        const slPct = args.sl_percentage as number;
        const reasoning = args.reasoning as string;
        const confidence = args.confidence as number;

        // ═══════════════════════════════════════
        // POSITION SIZING: 1% of total balance
        // ═══════════════════════════════════════
        const currentBalance = this.stateManager.state.balanceSol;
        const amountSol = calculatePositionSol(currentBalance);

        // Minimum viable trade size
        if (amountSol < 0.001) {
            logger.warn(`⚠️ Position too small: ${amountSol.toFixed(6)} SOL (1% of ${currentBalance.toFixed(4)} SOL)`);
            return;
        }

        // Validate: AI might give wrong mint — find correct one from watchlist
        const watchlistMatch = snapshot.watchlist.find(
            (w) => w.mint === tokenMint || w.symbol.toUpperCase() === tokenSymbol.toUpperCase()
        );
        if (watchlistMatch) {
            tokenMint = watchlistMatch.mint;
        } else {
            const registryToken = this.tokenRegistry.getAll().find(
                (t) => t.symbol.toUpperCase() === tokenSymbol.toUpperCase()
            );
            if (registryToken) {
                tokenMint = registryToken.mint;
            } else {
                logger.warn(`⚠️ Token ${tokenSymbol} (${tokenMint}) not in watchlist/registry, skipping`);
                return;
            }
        }

        const mode = CONFIG.PAPER_TRADING ? '📋' : '🔴';
        logger.info(`${mode} BUY Signal: ${tokenSymbol} — ${amountSol.toFixed(4)} SOL (1% of ${currentBalance.toFixed(4)}) (confidence: ${confidence}%)`);
        logger.info(`   Reasoning: ${reasoning}`);

        // Validate mint address (base58, typically 32-44 chars)
        if (!tokenMint || tokenMint.length < 32 || tokenMint.length > 50) {
            logger.warn(`⚠️ Invalid mint address for ${tokenSymbol}: "${tokenMint}" (length=${tokenMint?.length}), skipping`);
            return;
        }
        logger.info(`   🔑 Mint: ${tokenMint}`);

        // Validate R:R ratio
        if (tpPct / slPct < CONFIG.MIN_RISK_REWARD_RATIO) {
            logger.warn(`⚠️ R:R ratio ${(tpPct / slPct).toFixed(1)} < min ${CONFIG.MIN_RISK_REWARD_RATIO}:1, adjusting...`);
            // Auto-adjust: keep SL, increase TP to meet minimum R:R
            const adjustedTpPct = slPct * CONFIG.MIN_RISK_REWARD_RATIO;
            logger.info(`   📐 Adjusted TP: ${tpPct}% → ${adjustedTpPct}%`);
        }

        // Ensure R:R >= 1:2
        const finalTpPct = Math.max(tpPct, slPct * CONFIG.MIN_RISK_REWARD_RATIO);
        const finalSlPct = slPct;

        // Convert SOL amount to lamports
        const amountLamports = Math.floor(amountSol * 1e9).toString();

        // Get quote for risk check
        const quote = await this.jupiter.getQuote({
            inputMint: CORE_TOKENS.SOL.mint,
            outputMint: tokenMint,
            amount: amountLamports,
        });

        if (!quote) {
            logger.warn(`⚠️ Cannot get quote for ${tokenSymbol} (${tokenMint}), skipping`);
            return;
        }

        // Risk check
        const riskResult = this.risk.evaluate({
            priceImpactPct: parseFloat(quote.priceImpactPct),
            inAmount: quote.inAmount,
            outAmount: quote.outAmount,
            tokenMint,
            amountSol,
            state: this.stateManager.state,
        });

        if (!riskResult.allowed) {
            logger.warn(`⛔ Trade blocked: ${riskResult.reason}`);
            return;
        }

        // Execute swap
        logger.info(`✅ Risk check passed — executing swap...`);

        const result = await this.jupiter.executeSwap({
            inputMint: CORE_TOKENS.SOL.mint,
            outputMint: tokenMint,
            amount: amountLamports,
        });

        // Calculate TP/SL prices
        const entryPrice = snapshot.prices[tokenMint] || 0;
        const tp = entryPrice * (1 + finalTpPct / 100);
        const sl = entryPrice * (1 - finalSlPct / 100);
        const riskRewardRatio = finalTpPct / finalSlPct;

        // Record trade
        this.stateManager.recordTrade({
            timestamp: new Date().toISOString(),
            type: 'BUY',
            inputMint: CORE_TOKENS.SOL.mint,
            outputMint: tokenMint,
            inputAmount: result.inAmount,
            outputAmount: result.outAmount,
            priceImpactPct: parseFloat(result.priceImpactPct),
            slippageBps: result.slippageBps,
            txHash: result.txHash,
            status: result.success ? 'SUCCESS' : 'FAILED',
            errorReason: result.error || '',
            aiReasoning: reasoning,
            tp, sl,
            pnl: 0,
            tokenName: tokenSymbol,
        });

        // Save position if successful
        if (result.success) {
            // Convert raw outAmount to human-readable using token decimals
            const tokenInfo = this.tokenRegistry.get(tokenMint);
            const tokenDecimals = tokenInfo?.decimals || 9;
            const humanAmount = parseInt(result.outAmount) / Math.pow(10, tokenDecimals);

            const position: Position = {
                id: randomUUID(),
                token: tokenSymbol,
                mint: tokenMint,
                side: 'LONG',
                entryPrice,
                currentPrice: entryPrice,
                amount: humanAmount,
                amountSol: amountSol,
                tp, sl, riskRewardRatio,
                openedAt: Date.now(),
                reasoning,
                txHash: result.txHash,
            };

            this.stateManager.savePosition(position);
            this.stateManager.state.balanceSol -= amountSol;

            logger.info(`📈 Position opened: ${tokenSymbol}`);
            logger.info(`   Entry: $${entryPrice.toFixed(8)} | TP: $${tp.toFixed(8)} (+${finalTpPct}%) | SL: $${sl.toFixed(8)} (-${finalSlPct}%)`);
            logger.info(`   Amount: ${humanAmount.toFixed(2)} ${tokenSymbol} | Size: ${amountSol.toFixed(4)} SOL (${CONFIG.POSITION_SIZE_PCT}% of balance)`);

            // Telegram alert
            alertBuy({ token: tokenSymbol, price: entryPrice, amountSol, tp, sl, reasoning }).catch(() => { });
            logTrade({ type: 'BUY', token: tokenSymbol, amount: humanAmount, price: entryPrice, status: 'SUCCESS', reasoning });
        }
    }

    async executeClose(position: Position, reason: string): Promise<void> {
        const mode = CONFIG.PAPER_TRADING ? '📋' : '🔴';
        logger.info(`${mode} Closing: ${position.token} — ${reason}`);

        let token = this.tokenRegistry.get(position.mint);
        if (!token) {
            // Auto-register: try to fetch real decimals from Jupiter token API
            logger.warn(`⚠️ Token ${position.token} not in registry — fetching metadata...`);
            let decimals = 6; // safe default for most meme coins (pump.fun tokens = 6)
            try {
                const res = await fetch(`https://api.jup.ag/tokens/v1/token/${position.mint}`);
                if (res.ok) {
                    const meta = (await res.json()) as { decimals?: number };
                    if (meta.decimals !== undefined) decimals = meta.decimals;
                    logger.info(`   ✅ Fetched decimals: ${decimals} for ${position.token}`);
                }
            } catch {
                logger.warn(`   ⚠️ Could not fetch decimals, using default: ${decimals}`);
            }
            this.tokenRegistry.add({
                mint: position.mint,
                symbol: position.token,
                name: position.token,
                decimals,
            });
            token = this.tokenRegistry.get(position.mint)!;
        }

        let sellAmount = position.amount;

        if (!CONFIG.PAPER_TRADING) {
            const actualBalance = await this.wallet.getTokenBalance(position.mint);
            sellAmount = Math.min(position.amount, actualBalance);
        }

        if (sellAmount <= 0) {
            logger.warn(`⚠️ No balance to sell for ${position.token}`);
            this.stateManager.removePosition(position.id);
            return;
        }

        const rawSellAmount = Math.floor(sellAmount * Math.pow(10, token.decimals)).toString();

        const result = await this.jupiter.executeSwap({
            inputMint: position.mint,
            outputMint: CORE_TOKENS.SOL.mint,
            amount: rawSellAmount,
        });

        let soldSol = parseInt(result.outAmount) / 1e9;

        // 🛡️ PnL Sanity Check: if sold amount is unreasonably large (>10x original),
        // it's likely a decimals mismatch. Cap at entry amount to prevent balance inflation.
        const maxReasonableSol = position.amountSol * 10; // max 10x gain is already insane for meme coins
        if (soldSol > maxReasonableSol) {
            logger.warn(`🚨 SANITY CHECK: soldSol=${soldSol.toFixed(4)} is >10x entry=${position.amountSol.toFixed(4)}. Likely decimals bug. Capping to entry amount.`);
            soldSol = position.amountSol; // return original amount (net-zero trade)
        }

        const pnl = soldSol - position.amountSol;

        this.stateManager.recordTrade({
            timestamp: new Date().toISOString(),
            type: 'SELL',
            inputMint: position.mint,
            outputMint: CORE_TOKENS.SOL.mint,
            inputAmount: rawSellAmount,
            outputAmount: result.outAmount,
            priceImpactPct: parseFloat(result.priceImpactPct),
            slippageBps: result.slippageBps,
            txHash: result.txHash,
            status: result.success ? 'SUCCESS' : 'FAILED',
            errorReason: result.error || '',
            aiReasoning: reason,
            tp: position.tp, sl: position.sl,
            pnl: result.success ? pnl : 0,
            tokenName: position.token,
        });

        if (result.success) {
            this.stateManager.removePosition(position.id);
            this.stateManager.state.balanceSol += soldSol;

            const emoji = pnl >= 0 ? '💰' : '📉';
            logger.info(`${emoji} Closed ${position.token}: PnL=${pnl > 0 ? '+' : ''}${pnl.toFixed(6)} SOL`);

            // Telegram alert
            const solPrice = await this.jupiter.price.getPrice('So11111111111111111111111111111111111111112') || 90;
            alertSell({ token: position.token, pnlSol: pnl, pnlUsd: pnl * solPrice, reason }).catch(() => { });
            logTrade({ type: 'SELL', token: position.token, pnl, pnlUsd: pnl * solPrice, status: 'SUCCESS', reasoning: reason });
        }
    }

    /**
     * 🐾 Phase 4: Partial Take-Profit
     * Sell a percentage of a position while keeping the rest open.
     * This locks in profits while letting the "moonbag" ride.
     */
    async executePartialClose(position: Position, sellPct: number, reason: string): Promise<void> {
        const mode = CONFIG.PAPER_TRADING ? '📋' : '🔴';
        logger.info(`${mode} Partial Close (${sellPct}%): ${position.token} — ${reason}`);

        // Save original amounts on first partial
        if (!position.originalAmount) {
            position.originalAmount = position.amount;
            position.originalAmountSol = position.amountSol;
        }

        const sellAmount = position.amount * (sellPct / 100);
        const sellAmountSol = position.amountSol * (sellPct / 100);

        if (sellAmount <= 0) {
            logger.warn(`⚠️ Nothing to partial-sell for ${position.token}`);
            return;
        }

        let token = this.tokenRegistry.get(position.mint);
        if (!token) {
            let decimals = 6;
            try {
                const res = await fetch(`https://api.jup.ag/tokens/v1/token/${position.mint}`);
                if (res.ok) {
                    const meta = (await res.json()) as { decimals?: number };
                    if (meta.decimals !== undefined) decimals = meta.decimals;
                }
            } catch { /* use default */ }
            this.tokenRegistry.add({ mint: position.mint, symbol: position.token, name: position.token, decimals });
            token = this.tokenRegistry.get(position.mint)!;
        }

        const rawSellAmount = Math.floor(sellAmount * Math.pow(10, token.decimals)).toString();

        const result = await this.jupiter.executeSwap({
            inputMint: position.mint,
            outputMint: CORE_TOKENS.SOL.mint,
            amount: rawSellAmount,
        });

        let soldSol = parseInt(result.outAmount) / 1e9;

        // Sanity check
        const maxReasonable = sellAmountSol * 10;
        if (soldSol > maxReasonable) {
            logger.warn(`🚨 SANITY: partial soldSol=${soldSol.toFixed(4)} too high. Capping.`);
            soldSol = sellAmountSol;
        }

        const pnl = soldSol - sellAmountSol;

        this.stateManager.recordTrade({
            timestamp: new Date().toISOString(),
            type: 'SELL',
            inputMint: position.mint,
            outputMint: CORE_TOKENS.SOL.mint,
            inputAmount: rawSellAmount,
            outputAmount: result.outAmount,
            priceImpactPct: parseFloat(result.priceImpactPct),
            slippageBps: result.slippageBps,
            txHash: result.txHash,
            status: result.success ? 'SUCCESS' : 'FAILED',
            errorReason: result.error || '',
            aiReasoning: `[PARTIAL ${sellPct}%] ${reason}`,
            tp: position.tp, sl: position.sl,
            pnl: result.success ? pnl : 0,
            tokenName: position.token,
        });

        if (result.success) {
            // Reduce position size (keep remaining open)
            position.amount -= sellAmount;
            position.amountSol -= sellAmountSol;
            position.partialTpStage = (position.partialTpStage || 0) + 1;

            // Add sold SOL back to balance
            this.stateManager.state.balanceSol += soldSol;
            this.stateManager.savePosition(position);

            const emoji = '💎';
            const solPrice = await this.jupiter.price.getPrice('So11111111111111111111111111111111111111112') || 90;
            logger.info(`${emoji} Partial TP #${position.partialTpStage}: Sold ${sellPct}% of ${position.token} | PnL=${pnl > 0 ? '+' : ''}${pnl.toFixed(6)} SOL ($${(pnl * solPrice).toFixed(2)})`);
            logger.info(`   Remaining: ${(position.amount).toFixed(2)} tokens (${position.amountSol.toFixed(4)} SOL) — moonbag riding! 🌙`);

            alertSell({ token: `${position.token} (${sellPct}% partial)`, pnlSol: pnl, pnlUsd: pnl * solPrice, reason }).catch(() => { });
        }
    }
}
