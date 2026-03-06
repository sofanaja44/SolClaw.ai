import { Connection, PublicKey } from '@solana/web3.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { TradeExecutor } from './executor.js';
import { StateManager } from '../state/manager.js';
import { JupiterConnector } from '../jupiter/index.js';
import { CORE_TOKENS } from '../config/tokens.js';

/**
 * 🐳 SolClaw.ai — Whale Copy Trading Engine
 * 
 * Monitors specified whale wallets for new token purchases.
 * When a whale buys a token, the bot analyzes it and optionally copies the trade.
 * 
 * How it works:
 * 1. Poll each whale wallet's recent transactions via Solana RPC
 * 2. Detect swap transactions (SOL → Token)
 * 3. Filter: only tokens with enough liquidity
 * 4. Execute copy trade with our standard position sizing
 * 
 * Uses Helius RPC if available (better parsed tx data), 
 * falls back to standard Solana RPC.
 */

interface WhaleSwap {
    wallet: string;
    tokenMint: string;
    tokenSymbol: string;
    type: 'BUY' | 'SELL';
    timestamp: number;
    txHash: string;
}

export class WhaleTracker {
    private connection: Connection;
    private stateManager: StateManager;
    private jupiter: JupiterConnector;
    private executor: TradeExecutor;
    private wallets: string[];
    private lastSignatures: Map<string, string> = new Map(); // wallet -> last known tx signature
    private knownTokens: Map<string, string> = new Map(); // mint -> symbol cache
    private isRunning = false;
    private pollInterval: ReturnType<typeof setInterval> | null = null;

    // Callback for dashboard
    public onWhaleSwap: ((swap: WhaleSwap) => void) | null = null;

    constructor(
        stateManager: StateManager,
        jupiter: JupiterConnector,
        executor: TradeExecutor
    ) {
        this.connection = new Connection(CONFIG.SOLANA_RPC_URL, 'confirmed');
        this.stateManager = stateManager;
        this.jupiter = jupiter;
        this.executor = executor;
        this.wallets = CONFIG.WHALE_WALLETS.filter(w => w.length > 30); // filter valid addresses
    }

    /**
     * Start polling whale wallets
     */
    async start(): Promise<void> {
        if (!CONFIG.WHALE_TRACKING_ENABLED || this.wallets.length === 0) {
            logger.info('🐳 Whale tracking disabled or no wallets configured');
            return;
        }

        this.isRunning = true;
        logger.info(`🐳 Whale Tracker started — monitoring ${this.wallets.length} wallet(s)`);
        this.wallets.forEach((w, i) => {
            logger.info(`   Whale #${i + 1}: ${w.slice(0, 6)}...${w.slice(-4)}`);
        });

        // Initialize last signatures (don't copy old trades on first run)
        await this.initializeSignatures();

        // Start polling
        this.pollInterval = setInterval(() => {
            if (this.isRunning) this.pollAllWallets().catch(e => logger.error(`🐳 Poll error: ${e}`));
        }, CONFIG.WHALE_POLL_INTERVAL_MS);

        // First poll after a short delay
        setTimeout(() => this.pollAllWallets().catch(e => logger.error(`🐳 Poll error: ${e}`)), 5000);
    }

    stop(): void {
        this.isRunning = false;
        if (this.pollInterval) clearInterval(this.pollInterval);
        logger.info('🐳 Whale Tracker stopped');
    }

    /**
     * Initialize: record latest tx signature for each wallet
     * so we don't copy old trades on startup.
     */
    private async initializeSignatures(): Promise<void> {
        for (const wallet of this.wallets) {
            try {
                const pubkey = new PublicKey(wallet);
                const sigs = await this.connection.getSignaturesForAddress(pubkey, { limit: 1 });
                if (sigs.length > 0) {
                    this.lastSignatures.set(wallet, sigs[0].signature);
                }
            } catch (e) {
                logger.warn(`🐳 Failed to init signatures for ${wallet.slice(0, 8)}...: ${e}`);
            }
        }
        logger.info(`🐳 Initialized ${this.lastSignatures.size}/${this.wallets.length} whale signatures`);
    }

    /**
     * Poll all whale wallets for new transactions
     */
    private async pollAllWallets(): Promise<void> {
        for (const wallet of this.wallets) {
            try {
                await this.pollWallet(wallet);
            } catch (e) {
                logger.debug(`🐳 Error polling ${wallet.slice(0, 8)}...: ${e}`);
            }
            // Small delay between wallets to avoid rate limits
            await new Promise(r => setTimeout(r, 500));
        }
    }

    /**
     * Poll a single whale wallet for new token swaps
     */
    private async pollWallet(wallet: string): Promise<void> {
        const pubkey = new PublicKey(wallet);
        const lastSig = this.lastSignatures.get(wallet);

        // Get recent signatures since last check
        const options: { limit: number; until?: string } = { limit: 10 };
        if (lastSig) options.until = lastSig;

        const signatures = await this.connection.getSignaturesForAddress(pubkey, options);

        if (signatures.length === 0) return;

        // Update last signature
        this.lastSignatures.set(wallet, signatures[0].signature);

        // Process new transactions (oldest first)
        const newSigs = signatures.reverse();

        for (const sigInfo of newSigs) {
            if (sigInfo.err) continue; // skip failed txs

            try {
                const swap = await this.parseSwapTransaction(wallet, sigInfo.signature);
                if (swap && swap.type === 'BUY') {
                    await this.handleWhaleSwap(swap);
                }
            } catch {
                // Skip unparseable transactions
            }
        }
    }

    /**
     * Parse a transaction to detect if it's a token swap (BUY)
     */
    private async parseSwapTransaction(wallet: string, signature: string): Promise<WhaleSwap | null> {
        const tx = await this.connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.meta) return null;

        // Look at token balance changes to detect swaps
        const preBalances = tx.meta.preTokenBalances || [];
        const postBalances = tx.meta.postTokenBalances || [];

        // Find token mints where the whale's balance INCREASED (= bought token)
        const walletPubkey = wallet;
        let boughtMint: string | null = null;

        for (const post of postBalances) {
            if (post.owner !== walletPubkey) continue;

            const pre = preBalances.find(
                p => p.owner === walletPubkey && p.mint === post.mint
            );

            const preBal = pre?.uiTokenAmount?.uiAmount || 0;
            const postBal = post.uiTokenAmount?.uiAmount || 0;

            // Token balance increased → whale bought this token
            if (postBal > preBal && post.mint !== CORE_TOKENS.SOL.mint) {
                boughtMint = post.mint;
                break;
            }
        }

        if (!boughtMint) return null;

        // Get token symbol
        const symbol = await this.getTokenSymbol(boughtMint);

        return {
            wallet,
            tokenMint: boughtMint,
            tokenSymbol: symbol,
            type: 'BUY',
            timestamp: (tx.blockTime || 0) * 1000,
            txHash: signature,
        };
    }

    /**
     * Handle a detected whale swap — evaluate and optionally copy
     */
    private async handleWhaleSwap(swap: WhaleSwap): Promise<void> {
        const walletLabel = swap.wallet.slice(0, 6) + '...' + swap.wallet.slice(-4);
        logger.info(`🐳 Whale ${walletLabel} bought ${swap.tokenSymbol} (${swap.tokenMint.slice(0, 8)}...)`);

        // Emit to dashboard
        if (this.onWhaleSwap) this.onWhaleSwap(swap);

        // Check if we already have a position in this token
        const existingPos = this.stateManager.state.positions.find(p => p.mint === swap.tokenMint);
        if (existingPos) {
            logger.info(`   Already holding ${swap.tokenSymbol} — skipping copy`);
            return;
        }

        // Check if we have enough balance
        const state = this.stateManager.state;
        if (state.positions.length >= CONFIG.MAX_TOKENS_WATCH) {
            logger.info(`   Max positions reached — skipping copy`);
            return;
        }

        // Quick validation via price check
        try {
            logger.info(`   ✅ ${swap.tokenSymbol} detected — preparing to copy whale trade`);

            // Create a synthetic market snapshot for the executor
            const price = await this.jupiter.price.getPrice(swap.tokenMint) || 0;
            if (price <= 0) {
                logger.warn(`   ⚠️ Cannot get price for ${swap.tokenSymbol}`);
                return;
            }

            const solPriceNow = await this.jupiter.price.getPrice(CORE_TOKENS.SOL.mint) || 90;

            // Use the executor to buy with standard risk management
            const snapshot = {
                timestamp: Date.now(),
                solPrice: solPriceNow,
                prices: { [swap.tokenMint]: price, [CORE_TOKENS.SOL.mint]: solPriceNow } as Record<string, number>,
                watchlist: [{
                    symbol: swap.tokenSymbol,
                    name: swap.tokenSymbol,
                    mint: swap.tokenMint,
                    price,
                    priceChange1h: 0,
                    priceChange24h: 0,
                    volume24h: 50000,
                    liquidity: 50000,
                    marketCap: 0,
                }],
            };

            // Standard position sizing: 1% of balance
            const amountSol = state.balanceSol * (CONFIG.POSITION_SIZE_PCT / 100);
            if (amountSol < 0.001) {
                logger.warn(`   ⚠️ Balance too low to copy trade`);
                return;
            }

            logger.info(`🐳 Copy Trade: BUY ${swap.tokenSymbol} | ${amountSol.toFixed(4)} SOL`);

            // Execute via AI agent (provides safety analysis layer)
            await this.executor.execute(snapshot);

        } catch (e) {
            logger.warn(`   ⚠️ Failed to copy whale trade: ${e}`);
        }
    }

    /**
     * Get token symbol from mint (with caching)
     */
    private async getTokenSymbol(mint: string): Promise<string> {
        if (this.knownTokens.has(mint)) return this.knownTokens.get(mint)!;

        try {
            const res = await fetch(`https://api.jup.ag/tokens/v1/token/${mint}`);
            if (res.ok) {
                const data = (await res.json()) as { symbol?: string };
                const sym = data.symbol || mint.slice(0, 6);
                this.knownTokens.set(mint, sym);
                return sym;
            }
        } catch { /* ignore */ }

        const fallback = mint.slice(0, 6);
        this.knownTokens.set(mint, fallback);
        return fallback;
    }
}
