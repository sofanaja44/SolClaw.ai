import { CONFIG } from '../config/index.js';
import { TokenRegistry, CORE_TOKENS } from '../config/tokens.js';
import { JupiterConnector } from '../jupiter/index.js';
import { logger } from '../utils/logger.js';
import type { MarketSnapshot, WatchlistToken } from '../jupiter/types.js';

// Blue-chip meme coins (seeds — rest discovered dynamically from Jupiter)
const SEED_MEME_COINS = [
    { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5 },
    { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat', decimals: 6 },
    { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6 },
    { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', name: 'Popcat', decimals: 9 },
    { mint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', symbol: 'PNUT', name: 'Peanut the Squirrel', decimals: 6 },
];

export class MarketScanner {
    private jupiter: JupiterConnector;
    private tokenRegistry: TokenRegistry;
    private previousPrices: Record<string, number> = {};
    private initialized = false;
    private lastDiscoveryTime = 0;
    private DISCOVERY_INTERVAL_MS = 60000; // Re-discover tokens every 60s

    constructor(jupiter: JupiterConnector, tokenRegistry: TokenRegistry) {
        this.jupiter = jupiter;
        this.tokenRegistry = tokenRegistry;
    }

    async scan(): Promise<MarketSnapshot> {
        try {
            if (!this.initialized) {
                for (const coin of SEED_MEME_COINS) {
                    this.tokenRegistry.add(coin);
                }
                this.initialized = true;
                logger.info(`🔍 Loaded ${SEED_MEME_COINS.length} seed meme coins`);
            }

            // Discover trending tokens from Jupiter (throttled)
            const now = Date.now();
            if (now - this.lastDiscoveryTime > this.DISCOVERY_INTERVAL_MS) {
                await this.discoverTrending();
                this.lastDiscoveryTime = now;
            }

            const allMints = this.tokenRegistry.getAll().map((t) => t.mint);
            const prices = await this.jupiter.price.getPrices(allMints);

            const solPrice = prices[CORE_TOKENS.SOL.mint] || 0;

            const memeCoins = this.tokenRegistry.getMemeCoins();
            const watchlist: WatchlistToken[] = [];

            for (const token of memeCoins) {
                const price = prices[token.mint];
                if (!price || price <= 0) continue;

                const prevPrice = this.previousPrices[token.mint];
                const priceChange1h = prevPrice ? ((price - prevPrice) / prevPrice) * 100 : 0;
                const priceChange24h = this.jupiter.price.getPriceChange24h(token.mint);

                watchlist.push({
                    mint: token.mint,
                    symbol: token.symbol,
                    name: token.name,
                    price,
                    priceChange1h,
                    priceChange24h,
                    volume24h: 100000,
                    liquidity: 50000,
                    marketCap: 0,
                });
            }

            this.previousPrices = { ...prices };

            const snapshot: MarketSnapshot = {
                timestamp: Date.now(),
                prices,
                solPrice,
                watchlist,
            };

            if (watchlist.length > 0) {
                const top5 = watchlist
                    .sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h))
                    .slice(0, 5)
                    .map((w) => `${w.symbol}(${w.priceChange24h > 0 ? '+' : ''}${w.priceChange24h.toFixed(1)}%)`)
                    .join(' | ');
                logger.info(`📡 Scan: ${watchlist.length} coins, SOL=$${solPrice.toFixed(2)} | Top: ${top5}`);
            } else {
                logger.info(`📡 Scan: ${watchlist.length} coins tracked, SOL=$${solPrice.toFixed(2)}`);
            }

            return snapshot;
        } catch (err) {
            logger.error(`❌ Scan failed: ${err}`);
            return { timestamp: Date.now(), prices: {}, solPrice: 0, watchlist: [] };
        }
    }

    /**
     * Discover trending tokens from Jupiter Token API v2.
     * Uses /tokens/v2/toptrending/1h for hot tokens + /tokens/v2/recent for newly listed.
     */
    private async discoverTrending(): Promise<void> {
        const coreMints = new Set(Object.values(CORE_TOKENS).map((t) => t.mint));
        let totalAdded = 0;

        // 1) Top trending tokens (1h)
        try {
            const res = await fetch(`${CONFIG.JUP_API_BASE}/tokens/v2/toptrending/1h`, {
                headers: { 'x-api-key': CONFIG.JUP_API_KEY },
            });
            if (res.ok) {
                const tokens = (await res.json()) as Array<{
                    id: string; symbol: string; name: string; decimals: number;
                }>;
                for (const token of tokens) {
                    if (this.tokenRegistry.getMemeCoins().length >= CONFIG.MAX_TOKENS_WATCH) break;
                    if (this.tokenRegistry.get(token.id)) continue;
                    if (coreMints.has(token.id)) continue;
                    if (!token.symbol || !token.id) continue;

                    this.tokenRegistry.add({
                        mint: token.id,
                        decimals: token.decimals || 9,
                        symbol: token.symbol,
                        name: token.name || token.symbol,
                    });
                    totalAdded++;
                }
            }
        } catch {
            // Silent fail
        }

        // 2) Recently listed tokens
        try {
            const res = await fetch(`${CONFIG.JUP_API_BASE}/tokens/v2/recent`, {
                headers: { 'x-api-key': CONFIG.JUP_API_KEY },
            });
            if (res.ok) {
                const tokens = (await res.json()) as Array<{
                    id: string; symbol: string; name: string; decimals: number;
                }>;
                for (const token of tokens) {
                    if (this.tokenRegistry.getMemeCoins().length >= CONFIG.MAX_TOKENS_WATCH) break;
                    if (this.tokenRegistry.get(token.id)) continue;
                    if (coreMints.has(token.id)) continue;
                    if (!token.symbol || !token.id) continue;

                    this.tokenRegistry.add({
                        mint: token.id,
                        decimals: token.decimals || 9,
                        symbol: token.symbol,
                        name: token.name || token.symbol,
                    });
                    totalAdded++;
                }
            }
        } catch {
            // Silent fail
        }

        if (totalAdded > 0) {
            const total = this.tokenRegistry.getMemeCoins().length;
            logger.info(`🆕 Discovered ${totalAdded} tokens from Jupiter (total watchlist: ${total}/${CONFIG.MAX_TOKENS_WATCH})`);
        }
    }
}
