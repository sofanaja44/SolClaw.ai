import { Connection, VersionedTransaction, Keypair } from '@solana/web3.js';
import { CONFIG } from '../config/index.js';
import { logger } from './logger.js';

/**
 * 🐾 SolClaw.ai — Jito MEV Protection
 *
 * Submits transactions via Jito block engine to avoid sandwich attacks.
 * Jito bundles skip the public mempool, preventing front-running.
 *
 * Only used in LIVE trading mode.
 */

const JITO_ENDPOINTS = [
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
];

// Jito tip accounts (official)
const JITO_TIP_ACCOUNTS = [
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'DttWaMuVvTiDuGWN4Sn982BF8JrnzR5STi55ZBGQZiDd',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSGA57Pi7JMjSYRSswC',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    'HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiYqM2m6p',
    'ADaUMid9yfUytqMBgopwjb2o2J6bPvDpS94GjDq4fLBk',
    'DfXygSm48pNMxRmnRt93NMi7HSUXyGqbv7wVnj7GQFZE',
    'Hn4CtoAbEMHwXw1Q8NL2GcLqjpjU7FNqrX43bhjqETBz',
];

export interface JitoConfig {
    enabled: boolean;
    tipLamports: number;
}

/**
 * Get Jito configuration from environment.
 */
export function getJitoConfig(): JitoConfig {
    return {
        enabled: process.env['JITO_ENABLED'] === 'true',
        tipLamports: parseInt(process.env['JITO_TIP_LAMPORTS'] || '10000'),
    };
}

/**
 * Submit a signed transaction via Jito bundle.
 * Tries multiple Jito endpoints for redundancy.
 */
export async function sendViaJito(
    signedTxBase64: string,
): Promise<{ success: boolean; bundleId?: string; error?: string }> {
    const config = getJitoConfig();

    if (!config.enabled) {
        return { success: false, error: 'Jito not enabled' };
    }

    // Convert base64 to base58 (Jito expects base58-encoded transactions)
    const txBuffer = Buffer.from(signedTxBase64, 'base64');
    const bs58Tx = encodeBs58(txBuffer);

    const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [[bs58Tx]],
    };

    // Try each Jito endpoint
    for (const endpoint of JITO_ENDPOINTS) {
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000),
            });

            if (res.ok) {
                const data = (await res.json()) as { result?: string; error?: { message: string } };
                if (data.result) {
                    logger.info(`🛡️ Jito bundle sent: ${data.result} via ${new URL(endpoint).hostname}`);
                    return { success: true, bundleId: data.result };
                }
                if (data.error) {
                    logger.warn(`⚠️ Jito error: ${data.error.message}`);
                }
            }
        } catch {
            // Try next endpoint
            continue;
        }
    }

    return { success: false, error: 'All Jito endpoints failed' };
}

/**
 * Get a random Jito tip account.
 */
export function getRandomTipAccount(): string {
    return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

// Simple base58 encoder (avoid extra dependency)
function encodeBs58(buffer: Buffer): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const digits = [0];
    for (const byte of buffer) {
        let carry = byte;
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let result = '';
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) result += ALPHABET[0];
    for (let i = digits.length - 1; i >= 0; i--) result += ALPHABET[digits[i]];
    return result;
}
