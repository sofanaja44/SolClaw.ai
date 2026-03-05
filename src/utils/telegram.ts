import { logger } from './logger.js';

/**
 * 🐾 SolClaw.ai — Telegram Alert Bot
 * 
 * Sends trade notifications directly to your Telegram.
 * Setup: 
 *   1. Chat with @BotFather on Telegram → /newbot → get token
 *   2. Send any message to your bot
 *   3. Visit https://api.telegram.org/bot<TOKEN>/getUpdates → get chat_id
 *   4. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramConfig {
    enabled: boolean;
    token: string;
    chatId: string;
}

let config: TelegramConfig | null = null;

function getConfig(): TelegramConfig {
    if (!config) {
        const token = process.env['TELEGRAM_BOT_TOKEN'] || '';
        const chatId = process.env['TELEGRAM_CHAT_ID'] || '';
        config = {
            enabled: !!(token && chatId),
            token,
            chatId,
        };
    }
    return config;
}

/**
 * Send a message to Telegram.
 */
async function send(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<boolean> {
    const cfg = getConfig();
    if (!cfg.enabled) return false;

    try {
        const url = `${TELEGRAM_API}${cfg.token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: cfg.chatId,
                text,
                parse_mode: parseMode,
                disable_web_page_preview: true,
            }),
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            const err = await res.text();
            logger.warn(`⚠️ Telegram send failed: ${err}`);
            return false;
        }
        return true;
    } catch (err) {
        logger.warn(`⚠️ Telegram error: ${err}`);
        return false;
    }
}

/**
 * Alert: New BUY trade opened.
 */
export async function alertBuy(data: {
    token: string;
    price: number;
    amountSol: number;
    tp: number;
    sl: number;
    reasoning: string;
}): Promise<void> {
    const tpPct = ((data.tp - data.price) / data.price * 100).toFixed(1);
    const slPct = ((data.price - data.sl) / data.price * 100).toFixed(1);

    const msg = [
        `🟢 <b>BUY — ${data.token}</b>`,
        ``,
        `💰 Price: <code>$${fmtPrice(data.price)}</code>`,
        `📦 Size: <code>${data.amountSol.toFixed(4)} SOL</code>`,
        `🎯 TP: <code>$${fmtPrice(data.tp)}</code> (+${tpPct}%)`,
        `🛑 SL: <code>$${fmtPrice(data.sl)}</code> (-${slPct}%)`,
        ``,
        `🧠 <i>${data.reasoning.slice(0, 150)}</i>`,
        ``,
        `⏰ ${new Date().toLocaleTimeString()}`,
    ].join('\n');

    await send(msg);
}

/**
 * Alert: SELL trade closed (win or loss).
 */
export async function alertSell(data: {
    token: string;
    pnlSol: number;
    pnlUsd: number;
    reason: string;
}): Promise<void> {
    const isWin = data.pnlSol >= 0;
    const emoji = isWin ? '💰' : '📉';
    const label = isWin ? 'WIN' : 'LOSS';

    const msg = [
        `${emoji} <b>${label} — ${data.token}</b>`,
        ``,
        `PnL: <code>${data.pnlSol > 0 ? '+' : ''}${data.pnlSol.toFixed(4)} SOL</code> (<code>${data.pnlUsd > 0 ? '+' : ''}$${Math.abs(data.pnlUsd).toFixed(2)}</code>)`,
        ``,
        `📋 <i>${data.reason.slice(0, 100)}</i>`,
        `⏰ ${new Date().toLocaleTimeString()}`,
    ].join('\n');

    await send(msg);
}

/**
 * Alert: Bot status change.
 */
export async function alertStatus(status: 'started' | 'stopped' | 'error', detail?: string): Promise<void> {
    const icons = { started: '🟢', stopped: '🔴', error: '🚨' };
    const labels = { started: 'Bot Started', stopped: 'Bot Stopped', error: 'ERROR' };

    const msg = [
        `${icons[status]} <b>SolClaw.ai — ${labels[status]}</b>`,
        detail ? `\n<i>${detail}</i>` : '',
        `\n⏰ ${new Date().toLocaleTimeString()}`,
    ].join('');

    await send(msg);
}

/**
 * Alert: Daily summary report.
 */
export async function alertDailySummary(data: {
    pnlSol: number;
    pnlUsd: number;
    wins: number;
    losses: number;
    balance: number;
    balanceUsd: number;
}): Promise<void> {
    const total = data.wins + data.losses;
    const wr = total > 0 ? ((data.wins / total) * 100).toFixed(0) : '--';
    const pnlEmoji = data.pnlSol >= 0 ? '📈' : '📉';

    const msg = [
        `📊 <b>SolClaw.ai — Daily Report</b>`,
        ``,
        `${pnlEmoji} PnL: <code>${data.pnlSol > 0 ? '+' : ''}${data.pnlSol.toFixed(4)} SOL</code> (<code>$${Math.abs(data.pnlUsd).toFixed(2)}</code>)`,
        `🏆 Win Rate: <code>${wr}%</code> (${data.wins}W / ${data.losses}L)`,
        `💼 Balance: <code>${data.balance.toFixed(4)} SOL</code> (<code>$${data.balanceUsd.toFixed(2)}</code>)`,
        ``,
        `⏰ ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
    ].join('\n');

    await send(msg);
}

/**
 * Check if Telegram alerts are configured.
 */
export function isTelegramEnabled(): boolean {
    return getConfig().enabled;
}

function fmtPrice(p: number): string {
    if (p >= 100) return p.toFixed(2);
    if (p >= 1) return p.toFixed(3);
    if (p >= 0.01) return p.toFixed(4);
    if (p >= 0.0001) return p.toFixed(6);
    return p.toFixed(8);
}
