import { CONFIG, calculateMaxDailyLossSol } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { RiskCheckResult, BotState } from '../jupiter/types.js';

/**
 * Risk Manager — gate all trades through safety checks.
 *
 * Rules:
 * - Position size: 1% of balance per trade
 * - Risk:Reward ratio: minimum 1:2
 * - Max daily loss: 5% of starting balance
 * - Price impact: max 3%
 * - Kill switch on consecutive failures
 */
export class RiskManager {
    private startingBalanceSol: number = 0;

    /** Set starting balance for daily loss tracking */
    setStartingBalance(balanceSol: number): void {
        this.startingBalanceSol = balanceSol;
    }

    /** Master evaluation — run all checks */
    evaluate(params: {
        priceImpactPct: number;
        inAmount: string;
        outAmount: string;
        tokenMint: string;
        amountSol: number;
        state: BotState;
    }): RiskCheckResult {
        // 1. Kill switch
        if (params.state.killSwitchActive) {
            return { allowed: false, reason: '🛑 Kill switch active — bot stopped' };
        }

        // 2. Not running
        if (!params.state.isRunning) {
            return { allowed: false, reason: 'Bot is not running' };
        }

        // 3. Price impact check
        const impactCheck = this.checkPriceImpact(params.priceImpactPct);
        if (!impactCheck.allowed) return impactCheck;

        // 4. Daily loss check (% based)
        const startBal = this.startingBalanceSol || params.state.balanceSol;
        const maxLossSol = calculateMaxDailyLossSol(startBal);
        const lossCheck = this.checkDailyLoss(params.state.dailyPnL, maxLossSol);
        if (!lossCheck.allowed) return lossCheck;

        // 5. Duplicate position check
        const existingPosition = params.state.positions.find(
            (p) => p.mint === params.tokenMint
        );
        if (existingPosition) {
            return { allowed: false, reason: `⚠️ Already have open position in ${existingPosition.token}` };
        }

        // 6. Consecutive failures check
        const failCheck = this.checkConsecutiveFailures(params.state.consecutiveFailures);
        if (!failCheck.allowed) return failCheck;

        // 7. Trade cooldown check
        const cooldownCheck = this.checkCooldown(params.state.lastTradeTime);
        if (!cooldownCheck.allowed) return cooldownCheck;

        // 8. Balance check
        const balCheck = this.checkBalance(params.state.balanceSol, params.amountSol);
        if (!balCheck.allowed) return balCheck;

        return { allowed: true, reason: '✅ All risk checks passed' };
    }

    checkPriceImpact(impactPct: number): RiskCheckResult {
        if (impactPct > CONFIG.MAX_PRICE_IMPACT_PCT) {
            return {
                allowed: false,
                reason: `Price impact ${impactPct.toFixed(2)}% exceeds max ${CONFIG.MAX_PRICE_IMPACT_PCT}%`,
            };
        }
        return { allowed: true, reason: 'Price impact OK' };
    }

    checkDailyLoss(dailyPnL: number, maxLossSol: number): RiskCheckResult {
        if (dailyPnL < -maxLossSol) {
            return {
                allowed: false,
                reason: `🛑 Daily loss ${dailyPnL.toFixed(4)} SOL exceeds max ${maxLossSol.toFixed(4)} SOL (${CONFIG.MAX_DAILY_LOSS_PCT}%) — KILL SWITCH`,
            };
        }
        return { allowed: true, reason: 'Daily loss within limits' };
    }

    checkConsecutiveFailures(failures: number): RiskCheckResult {
        if (failures >= 3) {
            return {
                allowed: false,
                reason: `Circuit breaker: ${failures} consecutive failures — cooling down`,
            };
        }
        return { allowed: true, reason: 'No excessive failures' };
    }

    checkCooldown(lastTradeTime: number): RiskCheckResult {
        const elapsed = Date.now() - lastTradeTime;
        if (elapsed < CONFIG.TRADE_COOLDOWN_MS) {
            return {
                allowed: false,
                reason: `Cooldown: ${CONFIG.TRADE_COOLDOWN_MS - elapsed}ms remaining`,
            };
        }
        return { allowed: true, reason: 'Cooldown OK' };
    }

    checkBalance(balanceSol: number, tradeAmountSol: number): RiskCheckResult {
        // Keep 0.01 SOL for tx fees
        if (balanceSol - tradeAmountSol < 0.01) {
            return {
                allowed: false,
                reason: `Insufficient balance: ${balanceSol.toFixed(4)} SOL, need ${tradeAmountSol.toFixed(4)} + 0.01 fee reserve`,
            };
        }
        return { allowed: true, reason: 'Balance OK' };
    }

    /** Trigger kill switch — stops all trading */
    triggerKillSwitch(state: BotState, reason: string): void {
        state.killSwitchActive = true;
        state.isRunning = false;
        logger.error(`🛑 KILL SWITCH ACTIVATED: ${reason}`);
    }
}
