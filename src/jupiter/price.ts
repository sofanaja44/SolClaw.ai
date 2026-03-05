import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface PriceV3Entry {
    createdAt: string;
    liquidity: number;
    usdPrice: number;
    blockId: number;
    decimals: number;
    priceChange24h: number;
}

/**
 * Jupiter Price API v3.
 * Response format: { [mintAddress]: { usdPrice, priceChange24h, liquidity, ... } }
 */
export class JupiterPrice {
    private headers: Record<string, string>;
    private cache: Map<string, { price: number; change24h: number; timestamp: number }> = new Map();
    private CACHE_TTL_MS = 3000;

    constructor() {
        this.headers = {
            'x-api-key': CONFIG.JUP_API_KEY,
        };
    }

    async getPrices(mints: string[]): Promise<Record<string, number>> {
        const now = Date.now();
        const result: Record<string, number> = {};
        const uncachedMints: string[] = [];

        for (const mint of mints) {
            const cached = this.cache.get(mint);
            if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
                result[mint] = cached.price;
            } else {
                uncachedMints.push(mint);
            }
        }

        if (uncachedMints.length === 0) return result;

        const batches = this.chunkArray(uncachedMints, 100);

        for (const batch of batches) {
            try {
                const ids = batch.join(',');
                const url = `${CONFIG.JUP_API_BASE}/price/v3?ids=${ids}`;
                const res = await fetch(url, { headers: this.headers });

                if (!res.ok) {
                    logger.warn(`⚠️ Price API v3 returned ${res.status}`);
                    continue;
                }

                // v3 format: top-level keys are mint addresses
                const data = (await res.json()) as Record<string, PriceV3Entry>;

                for (const [mint, info] of Object.entries(data)) {
                    if (info && typeof info === 'object' && 'usdPrice' in info) {
                        const price = Number(info.usdPrice);
                        if (price > 0) {
                            result[mint] = price;
                            this.cache.set(mint, {
                                price,
                                change24h: info.priceChange24h || 0,
                                timestamp: now,
                            });
                        }
                    }
                }
            } catch (err) {
                logger.warn(`⚠️ Price fetch error: ${err}`);
            }
        }

        return result;
    }

    async getPrice(mint: string): Promise<number> {
        const prices = await this.getPrices([mint]);
        return prices[mint] || 0;
    }

    /** Get 24h price change percentage */
    getPriceChange24h(mint: string): number {
        return this.cache.get(mint)?.change24h || 0;
    }

    private chunkArray<T>(arr: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }
}
