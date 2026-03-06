import { CONFIG, validateConfig, calculatePositionSol } from './config/index.js';
import { TokenRegistry, CORE_TOKENS } from './config/tokens.js';
import { WalletManager } from './wallet/index.js';
import { JupiterConnector } from './jupiter/index.js';
import { RiskManager } from './risk/manager.js';
import { TradingAIAgent } from './ai/agent.js';
import { StateManager } from './state/manager.js';
import { MarketScanner } from './engine/scanner.js';
import { TradeExecutor } from './engine/executor.js';
import { PositionMonitor } from './engine/monitor.js';
import { WhaleTracker } from './engine/whale.js';
import { logger } from './utils/logger.js';
import { DashboardServer } from './server/index.js';
import { alertStatus, isTelegramEnabled } from './utils/telegram.js';

/**
 * ═══════════════════════════════════════════
 *  🐾 SOLCLAW.AI
 *  Solana Meme Coin Trading Bot
 * ═══════════════════════════════════════════
 */

class TradingBot {
    private wallet: WalletManager;
    private jupiter: JupiterConnector;
    private risk: RiskManager;
    private ai: TradingAIAgent;
    private stateManager: StateManager;
    private scanner: MarketScanner;
    private executor: TradeExecutor;
    private monitor: PositionMonitor;
    private whaleTracker: WhaleTracker;
    private tokenRegistry: TokenRegistry;
    private dashboard: DashboardServer;

    private scanInterval: ReturnType<typeof setInterval> | null = null;
    private monitorInterval: ReturnType<typeof setInterval> | null = null;
    private dashboardInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Validate config
        validateConfig();

        // Initialize modules
        this.tokenRegistry = new TokenRegistry();
        this.wallet = new WalletManager();
        this.jupiter = new JupiterConnector(this.wallet);
        this.risk = new RiskManager();
        this.ai = new TradingAIAgent();
        this.stateManager = new StateManager();
        this.scanner = new MarketScanner(this.jupiter, this.tokenRegistry);
        this.executor = new TradeExecutor(
            this.jupiter,
            this.ai,
            this.risk,
            this.stateManager,
            this.wallet,
            this.tokenRegistry
        );
        this.monitor = new PositionMonitor(
            this.jupiter,
            this.ai,
            this.stateManager,
            this.executor
        );
        this.whaleTracker = new WhaleTracker(
            this.stateManager,
            this.jupiter,
            this.executor
        );

        // Dashboard server
        this.dashboard = new DashboardServer(this.stateManager);

        // Wire AI decisions to dashboard
        this.executor.onAIDecision = (d) => this.dashboard.emitAIDecision(d);
    }

    async start(): Promise<void> {
        console.log('');
        console.log('  ╔═══════════════════════════════════════════╗');
        console.log('  ║   🐾 SOLCLAW.AI                          ║');
        console.log('  ║   Solana Meme Coin Trading Bot             ║');
        console.log('  ╚═══════════════════════════════════════════╝');
        console.log('');

        // Setup balance
        if (CONFIG.PAPER_TRADING) {
            // Paper mode: calculate SOL balance from USD budget
            const solPrice = await this.jupiter.price.getPrice(CORE_TOKENS.SOL.mint);
            const solBalance = solPrice > 0 ? CONFIG.PAPER_BALANCE_USD / solPrice : 0.7;
            this.stateManager.state.balanceSol = solBalance;
            this.risk.setStartingBalance(solBalance);
            const posSize = calculatePositionSol(solBalance);
            logger.info(`💵 Paper balance: $${CONFIG.PAPER_BALANCE_USD} = ${solBalance.toFixed(4)} SOL (SOL=$${solPrice.toFixed(2)})`);
            logger.info(`💎 Position size: ${posSize.toFixed(4)} SOL per trade (${CONFIG.POSITION_SIZE_PCT}% of balance)`);
        } else {
            const balance = await this.wallet.getBalanceSOL();
            this.stateManager.state.balanceSol = balance;
            this.risk.setStartingBalance(balance);
            const posSize = calculatePositionSol(balance);
            logger.info(`💰 Live balance: ${balance.toFixed(4)} SOL`);
            logger.info(`💎 Position size: ${posSize.toFixed(4)} SOL per trade (${CONFIG.POSITION_SIZE_PCT}% of balance)`);

            if (balance < 0.05) {
                logger.error('❌ Insufficient balance (< 0.05 SOL). Fund your wallet first.');
                process.exit(1);
            }
        }

        // Show daily stats
        const stats = this.stateManager.getDailyStats();
        if (stats.trades > 0) {
            logger.info(`📊 Today: PnL=${stats.pnl > 0 ? '+' : ''}${stats.pnl.toFixed(4)} SOL | W:${stats.wins} L:${stats.losses}`);
        }

        // Start scan loop
        logger.info(`📡 Market scan every ${CONFIG.SCAN_INTERVAL_MS / 1000}s`);
        this.scanInterval = setInterval(() => this.scanAndTrade(), CONFIG.SCAN_INTERVAL_MS);

        // Start position monitor loop
        logger.info(`👁️  TP/SL monitor every ${CONFIG.MONITOR_INTERVAL_MS / 1000}s`);
        this.monitorInterval = setInterval(() => this.monitorPositions(), CONFIG.MONITOR_INTERVAL_MS);

        // Start dashboard (print status every 30s)
        this.dashboardInterval = setInterval(() => this.printDashboard(), 30000);

        // Start web dashboard
        await this.dashboard.start();

        // Start whale tracker
        this.whaleTracker.onWhaleSwap = (swap) => {
            this.dashboard.broadcast('whale_swap', swap);
            logger.info(`🐳 Whale swap detected: ${swap.tokenSymbol} by ${swap.wallet.slice(0, 8)}...`);
        };
        await this.whaleTracker.start();

        // Run first scan immediately
        await this.scanAndTrade();

        console.log('');
        logger.info('✅ Bot is running! Press Ctrl+C to stop.');
        logger.info('🌐 Open dashboard: http://localhost:3000');
        if (isTelegramEnabled()) {
            logger.info('📢 Telegram alerts: ENABLED');
            alertStatus('started', `Mode: ${CONFIG.PAPER_TRADING ? 'Paper' : 'Live'} | Balance: ${this.stateManager.state.balanceSol.toFixed(4)} SOL`).catch(() => { });
        } else {
            logger.info('📢 Telegram alerts: DISABLED (set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID in .env)');
        }
        console.log('');

        // Handle graceful shutdown
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }

    private async scanAndTrade(): Promise<void> {
        if (!this.stateManager.state.isRunning) return;

        try {
            // Refresh real balance (only in live mode)
            if (!CONFIG.PAPER_TRADING) {
                const balance = await this.wallet.getBalanceSOL();
                this.stateManager.state.balanceSol = balance;
            }

            // Scan market
            const snapshot = await this.scanner.scan();

            // Push to dashboard
            this.dashboard.emitScan(snapshot);

            if (snapshot.watchlist.length === 0) {
                return;
            }

            // Track positions before trade
            const posBefore = this.stateManager.state.positions.length;

            // Let AI analyze and execute
            await this.executor.execute(snapshot);

            // Detect if a new trade happened and notify dashboard
            const posAfter = this.stateManager.state.positions.length;
            if (posAfter !== posBefore) {
                this.dashboard.emitTrade({ positionChange: posAfter - posBefore });
            }
        } catch (err) {
            logger.error(`❌ Scan error: ${err}`);
            this.stateManager.state.consecutiveFailures++;

            if (this.stateManager.state.consecutiveFailures >= 5) {
                this.risk.triggerKillSwitch(this.stateManager.state, 'Too many consecutive errors');
            }
        }
    }

    private async monitorPositions(): Promise<void> {
        if (!this.stateManager.state.isRunning) return;

        try {
            await this.monitor.checkPositions();
            this.dashboard.emitPositionUpdate();
        } catch (err) {
            logger.error(`❌ Monitor error: ${err}`);
        }
    }

    private printDashboard(): void {
        const s = this.stateManager.state;
        const stats = this.stateManager.getDailyStats();
        const mode = CONFIG.PAPER_TRADING ? '📋 PAPER' : '🔴 LIVE';
        const posSize = calculatePositionSol(s.balanceSol);

        console.log('');
        console.log(`  ─── ${mode} DASHBOARD ───────────────────────`);
        console.log(`  💰 Balance: ${s.balanceSol.toFixed(4)} SOL`);
        console.log(`  � Per trade: ${posSize.toFixed(4)} SOL (${CONFIG.POSITION_SIZE_PCT}%)`);
        console.log(`  �📊 Daily PnL: ${s.dailyPnL > 0 ? '+' : ''}${s.dailyPnL.toFixed(4)} SOL`);
        console.log(`  📈 Trades: ${stats.trades} (W:${stats.wins} L:${stats.losses})`);
        console.log(`  📦 Open Positions: ${s.positions.length}`);

        for (const pos of s.positions) {
            const pnlPct = pos.entryPrice > 0
                ? ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100
                : 0;
            const emoji = pnlPct >= 0 ? '🟢' : '🔴';
            console.log(`     ${emoji} ${pos.token}: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(1)}% | ${pos.amountSol.toFixed(4)} SOL`);
        }

        console.log(`  ──────────────────────────────────────────`);
        console.log('');
    }

    private shutdown(): void {
        console.log('');
        logger.info('🛑 Shutting down...');

        this.stateManager.state.isRunning = false;

        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.monitorInterval) clearInterval(this.monitorInterval);
        if (this.dashboardInterval) clearInterval(this.dashboardInterval);
        this.whaleTracker.stop();
        this.dashboard.stop();

        const stats = this.stateManager.getDailyStats();
        const s = this.stateManager.state;
        const mode = CONFIG.PAPER_TRADING ? 'PAPER' : 'LIVE';

        console.log('');
        console.log('  ╔═══════════════════════════════════════════════╗');
        console.log(`  ║   📊 ${mode} SESSION SUMMARY                   ║`);
        console.log('  ╠═══════════════════════════════════════════════╣');
        console.log(`  ║  Balance:    ${s.balanceSol.toFixed(4)} SOL`.padEnd(50) + '║');
        console.log(`  ║  Daily PnL:  ${stats.pnl > 0 ? '+' : ''}${stats.pnl.toFixed(4)} SOL`.padEnd(50) + '║');
        console.log(`  ║  Total PnL:  ${s.totalPnL > 0 ? '+' : ''}${s.totalPnL.toFixed(4)} SOL`.padEnd(50) + '║');
        console.log(`  ║  Trades:     ${stats.trades} (W:${stats.wins} L:${stats.losses})`.padEnd(50) + '║');
        console.log(`  ║  Positions:  ${s.positions.length} open`.padEnd(50) + '║');
        console.log(`  ║  Risk/Trade: ${CONFIG.POSITION_SIZE_PCT}% | R:R min 1:${CONFIG.MIN_RISK_REWARD_RATIO}`.padEnd(50) + '║');
        console.log('  ╚═══════════════════════════════════════════════╝');
        console.log('');

        this.stateManager.close();
        process.exit(0);
    }
}

// ═══════════════════════════════════════════
const bot = new TradingBot();
bot.start().catch((err) => {
    logger.error(`💀 Fatal: ${err}`);
    process.exit(1);
});
