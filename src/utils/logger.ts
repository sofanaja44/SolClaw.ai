import winston from 'winston';

/**
 * 🐾 SolClaw.ai — Advanced Logger
 * 
 * - Console: colored, compact (time + level + message)
 * - bot.log: full structured logs with metadata
 * - errors.log: errors only (easier to audit)
 * - trades.log: trade activity only (for analysis)
 */

const LOG_DIR = process.cwd();

// Custom format for trade-specific logging
const tradeFilter = winston.format((info) => {
    return info.category === 'trade' ? info : false;
});

// Custom format for errors only
const errorFilter = winston.format((info) => {
    return info.level === 'error' ? info : false;
});

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
        })
    ),
    transports: [
        // Console — colored, compact
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] ${level}: ${message}`;
                })
            ),
        }),

        // bot.log — все записи, rotation 5MB x 5 files
        new winston.transports.File({
            filename: `${LOG_DIR}/bot.log`,
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
        }),

        // errors.log — only errors
        new winston.transports.File({
            filename: `${LOG_DIR}/errors.log`,
            level: 'error',
            maxsize: 2 * 1024 * 1024,
            maxFiles: 3,
            format: winston.format.combine(
                errorFilter(),
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
                })
            ),
        }),

        // trades.log — trade events only (for analysis)
        new winston.transports.File({
            filename: `${LOG_DIR}/trades.log`,
            maxsize: 2 * 1024 * 1024,
            maxFiles: 3,
            format: winston.format.combine(
                tradeFilter(),
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.json()
            ),
        }),
    ],
});

/**
 * Log a trade event (goes to trades.log for easy analysis).
 */
export function logTrade(data: {
    type: 'BUY' | 'SELL';
    token: string;
    pnl?: number;
    pnlUsd?: number;
    amount?: number;
    price?: number;
    status: string;
    reasoning?: string;
}) {
    logger.info(`📊 TRADE: ${data.type} ${data.token} | PnL: ${data.pnl?.toFixed(4) || '0'} SOL | Status: ${data.status}`, {
        category: 'trade',
        ...data,
    });
}
