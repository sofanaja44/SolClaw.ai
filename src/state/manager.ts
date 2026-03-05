import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../utils/logger.js';
import type { BotState, Position, TradeRecord } from '../jupiter/types.js';

/**
 * 🐾 SolClaw.ai — State Manager
 * Persistent bot state + SQLite trade log.
 * 
 * Accounting rules:
 * - Balance = available SOL (not locked in positions)
 * - PnL only counts SELL trades (BUY has pnl=0, never counted as W/L)
 * - totalPnL persists across restarts (loaded from DB)
 */
export class StateManager {
    private db: Database.Database;
    public state: BotState;

    constructor() {
        const dbPath = path.resolve(process.cwd(), 'trades.db');
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initDatabase();

        this.state = {
            balanceSol: 0,
            balanceUsdc: 0,
            tokenBalances: {},
            positions: [],
            dailyPnL: 0,
            totalPnL: 0,
            consecutiveFailures: 0,
            isRunning: true,
            lastTradeTime: 0,
            tradesCount: 0,
            killSwitchActive: false,
        };

        this.loadPositions();
        this.loadTotalPnL();

        logger.info(`💾 State manager initialized (DB: ${dbPath})`);
    }

    private initDatabase(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        input_mint TEXT NOT NULL,
        output_mint TEXT NOT NULL,
        input_amount TEXT NOT NULL,
        output_amount TEXT NOT NULL,
        price_impact_pct REAL,
        slippage_bps INTEGER,
        tx_hash TEXT,
        status TEXT NOT NULL,
        error_reason TEXT,
        ai_reasoning TEXT,
        tp REAL,
        sl REAL,
        pnl REAL DEFAULT 0,
        token_name TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        mint TEXT NOT NULL,
        entry_price REAL NOT NULL,
        current_price REAL,
        amount REAL NOT NULL,
        amount_sol REAL NOT NULL,
        tp REAL NOT NULL,
        sl REAL NOT NULL,
        risk_reward_ratio REAL,
        opened_at INTEGER NOT NULL,
        reasoning TEXT,
        tx_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        pnl REAL DEFAULT 0,
        trades_count INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0
      );
    `);

        // Migration: add token_name if missing
        try {
            this.db.prepare(`ALTER TABLE trades ADD COLUMN token_name TEXT DEFAULT ''`).run();
        } catch {
            // Column already exists
        }
    }

    /** Record a trade */
    recordTrade(trade: Omit<TradeRecord, 'id'>): void {
        const stmt = this.db.prepare(`
      INSERT INTO trades (timestamp, type, input_mint, output_mint, input_amount, output_amount, 
        price_impact_pct, slippage_bps, tx_hash, status, error_reason, ai_reasoning, tp, sl, pnl, token_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        stmt.run(
            trade.timestamp,
            trade.type,
            trade.inputMint,
            trade.outputMint,
            trade.inputAmount,
            trade.outputAmount,
            trade.priceImpactPct,
            trade.slippageBps,
            trade.txHash,
            trade.status,
            trade.errorReason,
            trade.aiReasoning,
            trade.tp,
            trade.sl,
            trade.pnl,
            trade.tokenName || ''
        );

        // Only SELL trades affect PnL / W-L stats
        if (trade.type === 'SELL' && trade.status === 'SUCCESS') {
            const today = new Date().toISOString().split('T')[0];
            this.db.prepare(`
          INSERT INTO daily_stats (date, pnl, trades_count, wins, losses)
          VALUES (?, ?, 1, ?, ?)
          ON CONFLICT(date) DO UPDATE SET
            pnl = pnl + ?,
            trades_count = trades_count + 1,
            wins = wins + ?,
            losses = losses + ?
        `).run(
                today,
                trade.pnl,
                trade.pnl > 0 ? 1 : 0,
                trade.pnl <= 0 ? 1 : 0,
                trade.pnl,
                trade.pnl > 0 ? 1 : 0,
                trade.pnl <= 0 ? 1 : 0
            );

            this.state.dailyPnL += trade.pnl;
            this.state.totalPnL += trade.pnl;
        }

        // Update general counters
        this.state.tradesCount++;
        if (trade.status === 'SUCCESS') {
            this.state.consecutiveFailures = 0;
        } else {
            this.state.consecutiveFailures++;
        }
        this.state.lastTradeTime = Date.now();

        logger.info(`📝 Trade recorded: ${trade.type} ${trade.status} PnL=${trade.pnl.toFixed(6)}`);
    }

    /** Save position to DB */
    savePosition(position: Position): void {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO positions (id, token, mint, entry_price, current_price, amount, 
        amount_sol, tp, sl, risk_reward_ratio, opened_at, reasoning, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        stmt.run(
            position.id,
            position.token,
            position.mint,
            position.entryPrice,
            position.currentPrice,
            position.amount,
            position.amountSol,
            position.tp,
            position.sl,
            position.riskRewardRatio,
            position.openedAt,
            position.reasoning,
            position.txHash
        );

        // Update in-memory
        const idx = this.state.positions.findIndex((p) => p.id === position.id);
        if (idx >= 0) {
            this.state.positions[idx] = position;
        } else {
            this.state.positions.push(position);
        }
    }

    /** Remove closed position */
    removePosition(positionId: string): void {
        this.db.prepare('DELETE FROM positions WHERE id = ?').run(positionId);
        this.state.positions = this.state.positions.filter((p) => p.id !== positionId);
    }

    /** Load open positions from DB */
    private loadPositions(): void {
        const rows = this.db.prepare('SELECT * FROM positions').all() as Array<{
            id: string;
            token: string;
            mint: string;
            entry_price: number;
            current_price: number;
            amount: number;
            amount_sol: number;
            tp: number;
            sl: number;
            risk_reward_ratio: number;
            opened_at: number;
            reasoning: string;
            tx_hash: string;
        }>;

        this.state.positions = rows.map((row) => ({
            id: row.id,
            token: row.token,
            mint: row.mint,
            side: 'LONG' as const,
            entryPrice: row.entry_price,
            currentPrice: row.current_price || row.entry_price,
            amount: row.amount,
            amountSol: row.amount_sol,
            tp: row.tp,
            sl: row.sl,
            riskRewardRatio: row.risk_reward_ratio,
            openedAt: row.opened_at,
            reasoning: row.reasoning,
            txHash: row.tx_hash,
        }));

        if (this.state.positions.length > 0) {
            logger.info(`📋 Loaded ${this.state.positions.length} open positions`);
        }
    }

    /** Load total PnL from all past SELL trades (persists across restarts) */
    private loadTotalPnL(): void {
        // Total PnL = sum of all SELL trade PnLs
        const totalRow = this.db.prepare(
            `SELECT COALESCE(SUM(pnl), 0) as total_pnl FROM trades WHERE type = 'SELL' AND status = 'SUCCESS'`
        ).get() as { total_pnl: number } | undefined;
        this.state.totalPnL = totalRow?.total_pnl || 0;

        // Daily PnL from today's stats
        const today = new Date().toISOString().split('T')[0];
        const dailyRow = this.db.prepare(
            `SELECT COALESCE(pnl, 0) as daily_pnl FROM daily_stats WHERE date = ?`
        ).get(today) as { daily_pnl: number } | undefined;
        this.state.dailyPnL = dailyRow?.daily_pnl || 0;

        // Trades count
        const countRow = this.db.prepare(
            `SELECT COUNT(*) as cnt FROM trades`
        ).get() as { cnt: number } | undefined;
        this.state.tradesCount = countRow?.cnt || 0;

        if (this.state.totalPnL !== 0) {
            logger.info(`📊 Loaded PnL: Total=${this.state.totalPnL > 0 ? '+' : ''}${this.state.totalPnL.toFixed(6)} SOL, Today=${this.state.dailyPnL.toFixed(6)} SOL`);
        }
    }

    /** Get today's stats */
    getDailyStats(): { pnl: number; trades: number; wins: number; losses: number } {
        const today = new Date().toISOString().split('T')[0];
        const row = this.db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(today) as {
            pnl: number;
            trades_count: number;
            wins: number;
            losses: number;
        } | undefined;

        return {
            pnl: row?.pnl || 0,
            trades: row?.trades_count || 0,
            wins: row?.wins || 0,
            losses: row?.losses || 0,
        };
    }

    /** Get recent trades */
    getRecentTrades(limit: number = 10): TradeRecord[] {
        return this.db
            .prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ?')
            .all(limit) as TradeRecord[];
    }

    close(): void {
        this.db.close();
    }
}
