import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import type { StateManager } from '../state/manager.js';
import { CONFIG, calculatePositionSol } from '../config/index.js';

/**
 * Dashboard Server — Express + WebSocket for real-time monitoring.
 * Serves the dashboard at http://localhost:3000
 */
export class DashboardServer {
    private app: express.Application;
    private server: ReturnType<typeof createServer>;
    private wss: WebSocketServer;
    private stateManager: StateManager;
    private lastSnapshot: any = null;
    private port: number;

    constructor(stateManager: StateManager, port: number = 3000) {
        this.stateManager = stateManager;
        this.port = port;
        this.app = express();
        this.server = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.setupRoutes();
        this.setupWebSocket();
    }

    private setupRoutes(): void {
        // Serve dashboard HTML
        this.app.get('/', (_req, res) => {
            const htmlPath = path.resolve(
                path.dirname(fileURLToPath(import.meta.url)),
                'dashboard.html'
            );
            res.sendFile(htmlPath);
        });

        // REST API — fallback polling
        this.app.get('/api/status', (_req, res) => {
            const s = this.stateManager.state;
            res.json({
                running: s.isRunning,
                killSwitch: s.killSwitchActive,
                balance: s.balanceSol,
                dailyPnL: s.dailyPnL,
                totalPnL: s.totalPnL,
                positionCount: s.positions.length,
                tradesCount: s.tradesCount,
                positionSizeSol: calculatePositionSol(s.balanceSol),
                config: {
                    mode: CONFIG.PAPER_TRADING ? 'PAPER' : 'LIVE',
                    positionSizePct: CONFIG.POSITION_SIZE_PCT,
                    minRR: CONFIG.MIN_RISK_REWARD_RATIO,
                    maxDailyLossPct: CONFIG.MAX_DAILY_LOSS_PCT,
                    model: CONFIG.OPENROUTER_MODEL,
                    maxTokens: CONFIG.MAX_TOKENS_WATCH,
                    scanInterval: CONFIG.SCAN_INTERVAL_MS,
                },
            });
        });

        this.app.get('/api/positions', (_req, res) => {
            res.json(this.stateManager.state.positions);
        });

        this.app.get('/api/trades', (_req, res) => {
            res.json(this.stateManager.getRecentTrades(50));
        });

        this.app.get('/api/stats', (_req, res) => {
            res.json(this.stateManager.getDailyStats());
        });

        this.app.get('/api/watchlist', (_req, res) => {
            res.json(this.lastSnapshot?.watchlist || []);
        });

        this.app.post('/api/bot/stop', (_req, res) => {
            this.stateManager.state.killSwitchActive = true;
            this.stateManager.state.isRunning = false;
            this.broadcast('status', this.getStatusPayload());
            res.json({ ok: true, message: 'Bot stopped' });
        });

        this.app.post('/api/bot/start', (_req, res) => {
            this.stateManager.state.killSwitchActive = false;
            this.stateManager.state.isRunning = true;
            this.broadcast('status', this.getStatusPayload());
            res.json({ ok: true, message: 'Bot resumed' });
        });
    }

    private setupWebSocket(): void {
        this.wss.on('connection', (ws) => {
            // Send initial state on connect
            ws.send(JSON.stringify({ type: 'status', data: this.getStatusPayload() }));
            ws.send(JSON.stringify({ type: 'positions', data: this.stateManager.state.positions }));
            if (this.lastSnapshot) {
                ws.send(JSON.stringify({ type: 'scan', data: this.lastSnapshot }));
            }
            const stats = this.stateManager.getDailyStats();
            ws.send(JSON.stringify({ type: 'stats', data: stats }));
            const trades = this.stateManager.getRecentTrades(20);
            ws.send(JSON.stringify({ type: 'trades', data: trades }));
        });
    }

    /** Broadcast to all connected clients */
    broadcast(type: string, data: any): void {
        const msg = JSON.stringify({ type, data });
        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
            }
        });
    }

    /** Emit scan results */
    emitScan(snapshot: any): void {
        this.lastSnapshot = snapshot;
        this.broadcast('scan', snapshot);
    }

    /** Emit AI decision */
    emitAIDecision(decision: { action: string; reasoning: string; confidence?: number; token?: string }): void {
        this.broadcast('ai_decision', { ...decision, timestamp: Date.now() });
    }

    /** Emit trade executed */
    emitTrade(trade: any): void {
        this.broadcast('trade', trade);
        this.broadcast('status', this.getStatusPayload());
        this.broadcast('positions', this.stateManager.state.positions);
    }

    /** Emit position updates */
    emitPositionUpdate(): void {
        this.broadcast('positions', this.stateManager.state.positions);
        this.broadcast('status', this.getStatusPayload());
    }

    private getStatusPayload() {
        const s = this.stateManager.state;
        return {
            running: s.isRunning,
            killSwitch: s.killSwitchActive,
            balance: s.balanceSol,
            dailyPnL: s.dailyPnL,
            totalPnL: s.totalPnL,
            positionCount: s.positions.length,
            tradesCount: s.tradesCount,
            positionSizeSol: calculatePositionSol(s.balanceSol),
        };
    }

    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.server.listen(this.port, () => {
                logger.info(`🌐 Dashboard: http://localhost:${this.port}`);
                resolve();
            });
        });
    }

    stop(): void {
        this.wss.close();
        this.server.close();
    }
}
