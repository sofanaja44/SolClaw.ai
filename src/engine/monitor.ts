import { JupiterConnector } from '../jupiter/index.js';
import { TradingAIAgent } from '../ai/agent.js';
import { TradeExecutor } from './executor.js';
import { StateManager } from '../state/manager.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * 🐾 SolClaw.ai — Smart Position Monitor
 * 
 * Phase 3 upgrade: Trailing Stop-Loss + Breakeven Lock.
 * 
 * How trailing SL works:
 * 1. Position opens with fixed TP/SL (e.g. +10% / -5%)
 * 2. When price rises X% above entry → trailing SL activates
 * 3. SL now "trails" X% below the highest price ever reached
 * 4. If price drops from peak → SL catches it → sell with profit locked
 * 
 * Example: Entry $1.00, Trail activation +3%, Trail distance 5%
 *   - Price hits $1.03 → trailing activates, SL = $1.03 * 0.95 = $0.9785
 *   - Price rises to $1.10 → SL updates to $1.10 * 0.95 = $1.045 (profit locked!)
 *   - Price drops to $1.04 → SL ($1.045) is hit → SELL with +4% profit
 *   - Without trailing: would have hit original SL at $0.95 → LOSS
 */
export class PositionMonitor {
    private jupiter: JupiterConnector;
    private ai: TradingAIAgent;
    private stateManager: StateManager;
    private executor: TradeExecutor;

    constructor(
        jupiter: JupiterConnector,
        ai: TradingAIAgent,
        stateManager: StateManager,
        executor: TradeExecutor
    ) {
        this.jupiter = jupiter;
        this.ai = ai;
        this.stateManager = stateManager;
        this.executor = executor;
    }

    /**
     * Check all open positions — TP/SL + trailing logic.
     */
    async checkPositions(): Promise<void> {
        const positions = this.stateManager.state.positions;
        if (positions.length === 0) return;

        // Get current prices for all position tokens
        const mints = positions.map((p) => p.mint);
        const prices = await this.jupiter.price.getPrices(mints);

        for (const position of positions) {
            const currentPrice = prices[position.mint];
            if (!currentPrice) {
                logger.warn(`⚠️ Cannot get price for ${position.token} (${position.mint.slice(0, 8)}...)`);
                continue;
            }

            // Update current price
            position.currentPrice = currentPrice;

            // ─── Trailing Stop-Loss Logic ───
            if (CONFIG.TRAILING_SL_ENABLED) {
                this.updateTrailingStopLoss(position, currentPrice);
            }

            // ─── Check TP/SL (including trailing SL) ───
            const closeReason = this.checkTPSL(position, currentPrice);

            if (closeReason) {
                logger.info(`🚨 ${closeReason}`);
                await this.executor.executeClose(position, closeReason);
            } else {
                // AI override check (for manual/smart close decisions)
                const decision = await this.ai.shouldClosePosition(
                    position,
                    currentPrice,
                    this.stateManager.state
                );

                if (decision.shouldClose) {
                    logger.info(`🧠 AI Close: ${decision.reason}`);
                    await this.executor.executeClose(position, decision.reason);
                } else {
                    // Emit status
                    const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
                    const emoji = pnlPct >= 0 ? '📈' : '📉';
                    const trailInfo = position.trailingActive
                        ? ` [TRAILING SL=$${position.sl.toFixed(8)}]`
                        : '';
                    logger.debug(
                        `${emoji} ${position.token}: $${currentPrice.toFixed(8)} (${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(1)}%)${trailInfo}`
                    );
                }
            }
        }
    }

    /**
     * Update trailing stop-loss for a position.
     */
    private updateTrailingStopLoss(position: typeof this.stateManager.state.positions[0], currentPrice: number): void {
        const { TRAILING_SL_ACTIVATION_PCT, TRAILING_SL_DISTANCE_PCT, BREAKEVEN_LOCK_PCT } = CONFIG;

        const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

        // Initialize highestPrice if not set
        if (!position.highestPrice || currentPrice > position.highestPrice) {
            position.highestPrice = currentPrice;
        }

        // ─── Step 1: Breakeven Lock ───
        // Once price reaches BREAKEVEN_LOCK_PCT above entry, move SL to entry price
        if (pnlPct >= BREAKEVEN_LOCK_PCT && !position.trailingActive) {
            if (!position.originalSl) {
                position.originalSl = position.sl;
            }
            // Move SL to breakeven (entry price)
            if (position.sl < position.entryPrice) {
                position.sl = position.entryPrice;
                logger.info(`🔒 ${position.token}: Breakeven lock activated! SL moved to entry $${position.entryPrice.toFixed(8)}`);
                this.stateManager.savePosition(position);
            }
        }

        // ─── Step 2: Trailing SL Activation ───
        // Once price surges TRAILING_SL_ACTIVATION_PCT, activate trailing
        if (pnlPct >= TRAILING_SL_ACTIVATION_PCT && !position.trailingActive) {
            position.trailingActive = true;
            if (!position.originalSl) {
                position.originalSl = position.sl;
            }
            logger.info(`🔄 ${position.token}: Trailing SL activated! Gain: +${pnlPct.toFixed(1)}%`);
        }

        // ─── Step 3: Update Trailing SL ───
        // SL trails TRAILING_SL_DISTANCE_PCT below the highest price
        if (position.trailingActive && position.highestPrice) {
            const newTrailingSL = position.highestPrice * (1 - TRAILING_SL_DISTANCE_PCT / 100);

            // Only move SL up, never down
            if (newTrailingSL > position.sl) {
                const oldSl = position.sl;
                position.sl = newTrailingSL;
                logger.info(
                    `📐 ${position.token}: Trailing SL updated: $${oldSl.toFixed(8)} → $${newTrailingSL.toFixed(8)} ` +
                    `(peak: $${position.highestPrice.toFixed(8)}, trail: -${TRAILING_SL_DISTANCE_PCT}%)`
                );
                this.stateManager.savePosition(position);
            }
        }
    }

    /**
     * Check if TP or SL is hit.
     */
    private checkTPSL(position: typeof this.stateManager.state.positions[0], currentPrice: number): string | null {
        // Take Profit hit
        if (currentPrice >= position.tp) {
            return `🎯 Take Profit hit! ${position.token}: Entry=$${position.entryPrice.toFixed(8)}, TP=$${position.tp.toFixed(8)}, Current=$${currentPrice.toFixed(8)}`;
        }

        // Stop Loss hit (includes trailing SL)
        if (currentPrice <= position.sl) {
            const trailInfo = position.trailingActive ? ' (Trailing)' : '';
            return `🛑 Stop Loss${trailInfo} hit! ${position.token}: Entry=$${position.entryPrice.toFixed(8)}, SL=$${position.sl.toFixed(8)}, Current=$${currentPrice.toFixed(8)}`;
        }

        return null;
    }
}
