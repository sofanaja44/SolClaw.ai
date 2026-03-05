import { Connection } from '@solana/web3.js';
import { CONFIG } from '../config/index.js';
import { logger } from './logger.js';

/**
 * 🐾 SolClaw.ai — Dynamic Priority Fee Calculator
 *
 * Fetches recent priority fees from Solana RPC and calculates
 * optimal fee to ensure fast inclusion without overpaying.
 */

const FEE_CACHE_TTL_MS = 10_000; // Cache fees for 10s
const MAX_PRIORITY_FEE_LAMPORTS = 5_000_000; // 0.005 SOL cap
const MIN_PRIORITY_FEE_LAMPORTS = 10_000; // 0.00001 SOL minimum
const FEE_MULTIPLIER = 1.3; // Pay 30% above median for competitive edge

let cachedFee: { fee: number; timestamp: number } | null = null;

/**
 * Get optimal priority fee based on recent network activity.
 * Falls back to a sensible default if RPC call fails.
 */
export async function getDynamicPriorityFee(connection?: Connection): Promise<number> {
    // Return cached if fresh
    if (cachedFee && Date.now() - cachedFee.timestamp < FEE_CACHE_TTL_MS) {
        return cachedFee.fee;
    }

    try {
        const conn = connection || new Connection(CONFIG.SOLANA_RPC_URL, 'confirmed');

        // Fetch recent prioritization fees
        const fees = await conn.getRecentPrioritizationFees();

        if (!fees || fees.length === 0) {
            return getDefaultFee();
        }

        // Filter out zero fees and sort
        const nonZeroFees = fees
            .map(f => f.prioritizationFee)
            .filter(f => f > 0)
            .sort((a, b) => a - b);

        if (nonZeroFees.length === 0) {
            return getDefaultFee();
        }

        // Use 75th percentile for competitive placement
        const p75Index = Math.floor(nonZeroFees.length * 0.75);
        const medianFee = nonZeroFees[p75Index];

        // Apply multiplier and clamp
        const dynamicFee = Math.min(
            Math.max(
                Math.round(medianFee * FEE_MULTIPLIER),
                MIN_PRIORITY_FEE_LAMPORTS
            ),
            MAX_PRIORITY_FEE_LAMPORTS
        );

        // Cache result
        cachedFee = { fee: dynamicFee, timestamp: Date.now() };

        logger.info(`⚡ Priority fee: ${dynamicFee} lamports (network p75: ${medianFee})`);
        return dynamicFee;
    } catch (err) {
        logger.warn(`⚠️ Failed to fetch priority fees: ${err}`);
        return getDefaultFee();
    }
}

function getDefaultFee(): number {
    const defaultFee = 100_000; // 0.0001 SOL
    cachedFee = { fee: defaultFee, timestamp: Date.now() };
    return defaultFee;
}

/**
 * Build priority fee config for Jupiter Legacy API.
 * Returns the structure expected by Jupiter's `prioritizationFeeLamports` parameter.
 */
export function buildPriorityFeeConfig(feeLamports: number): {
    priorityLevelWithMaxLamports: { maxLamports: number; priorityLevel: string };
} {
    let level = 'medium';
    if (feeLamports > 500_000) level = 'veryHigh';
    else if (feeLamports > 100_000) level = 'high';

    return {
        priorityLevelWithMaxLamports: {
            maxLamports: feeLamports,
            priorityLevel: level,
        },
    };
}
