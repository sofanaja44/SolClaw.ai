import { JupiterUltra } from './ultra.js';
import { JupiterLegacy } from './legacy.js';
import { JupiterPrice } from './price.js';
import { WalletManager } from '../wallet/index.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { UltraOrderResponse } from './types.js';

/**
 * Unified Jupiter connector.
 * Tries Ultra API first → falls back to Legacy API.
 * In paper trading mode: gets real quotes but simulates execution.
 */
export class JupiterConnector {
    private ultra: JupiterUltra;
    private legacy: JupiterLegacy;
    public price: JupiterPrice;
    private wallet: WalletManager;

    constructor(wallet: WalletManager) {
        this.ultra = new JupiterUltra();
        this.legacy = new JupiterLegacy();
        this.price = new JupiterPrice();
        this.wallet = wallet;
    }

    /**
     * Execute a full swap: Quote → Sign → Execute.
     * In paper mode: gets real quote, simulates execution.
     */
    async executeSwap(params: {
        inputMint: string;
        outputMint: string;
        amount: string;
        slippageBps?: number;
    }): Promise<{
        success: boolean;
        txHash: string;
        inAmount: string;
        outAmount: string;
        priceImpactPct: string;
        slippageBps: number;
        error?: string;
        method: 'ultra' | 'legacy' | 'paper';
    }> {
        // Paper trading mode — get real quote, simulate execution
        if (CONFIG.PAPER_TRADING) {
            return await this.executeViaPaper(params);
        }

        let ultraError: unknown;

        // Try Ultra API first
        try {
            return await this.executeViaUltra(params);
        } catch (err) {
            ultraError = err;
            logger.warn(`⚠️ Ultra API failed, falling back to Legacy: ${err}`);
        }

        // Fallback to Legacy API
        try {
            return await this.executeViaLegacy(params);
        } catch (legacyErr) {
            logger.error(`❌ Both Ultra and Legacy failed: ${legacyErr}`);
            return {
                success: false,
                txHash: '',
                inAmount: params.amount,
                outAmount: '0',
                priceImpactPct: '0',
                slippageBps: params.slippageBps || 150,
                error: `Ultra: ${ultraError}, Legacy: ${legacyErr}`,
                method: 'legacy',
            };
        }
    }

    /**
     * Get quote only (no execution) — uses real Jupiter data.
     */
    async getQuote(params: {
        inputMint: string;
        outputMint: string;
        amount: string;
        slippageBps?: number;
    }): Promise<UltraOrderResponse | null> {
        // In paper mode, use legacy quote API (doesn't need taker signing)
        if (CONFIG.PAPER_TRADING) {
            try {
                const quote = await this.legacy.getQuote({
                    inputMint: params.inputMint,
                    outputMint: params.outputMint,
                    amount: params.amount,
                    slippageBps: params.slippageBps || CONFIG.DEFAULT_SLIPPAGE_BPS,
                });
                // Convert legacy quote to UltraOrderResponse shape
                return {
                    requestId: `paper_${Date.now()}`,
                    inputMint: quote.inputMint,
                    outputMint: quote.outputMint,
                    inAmount: quote.inAmount,
                    outAmount: quote.outAmount,
                    otherAmountThreshold: quote.otherAmountThreshold,
                    swapMode: quote.swapMode,
                    slippageBps: quote.slippageBps,
                    priceImpactPct: quote.priceImpactPct,
                    routePlan: quote.routePlan,
                    transaction: '', // No tx in paper mode
                    lastValidBlockHeight: 0,
                    prioritizationFeeLamports: 0,
                };
            } catch (err) {
                logger.warn(`⚠️ Quote failed: ${err}`);
                return null;
            }
        }

        try {
            return await this.ultra.createOrder({
                inputMint: params.inputMint,
                outputMint: params.outputMint,
                amount: params.amount,
                taker: this.wallet.publicKey,
                slippageBps: params.slippageBps,
            });
        } catch (err) {
            logger.warn(`⚠️ Quote failed: ${err}`);
            return null;
        }
    }

    /**
     * Paper trading execution — real quotes, simulated tx.
     */
    private async executeViaPaper(params: {
        inputMint: string;
        outputMint: string;
        amount: string;
        slippageBps?: number;
    }): Promise<{
        success: boolean;
        txHash: string;
        inAmount: string;
        outAmount: string;
        priceImpactPct: string;
        slippageBps: number;
        method: 'paper';
    }> {
        try {
            // Get REAL quote from Jupiter for accurate pricing
            const quote = await this.legacy.getQuote({
                inputMint: params.inputMint,
                outputMint: params.outputMint,
                amount: params.amount,
                slippageBps: params.slippageBps || CONFIG.DEFAULT_SLIPPAGE_BPS,
            });

            const fakeTxId = `PAPER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            logger.info(`📋 PAPER TRADE executed: ${fakeTxId}`);
            logger.info(`   In: ${quote.inAmount} → Out: ${quote.outAmount} (impact: ${quote.priceImpactPct}%)`);

            return {
                success: true,
                txHash: fakeTxId,
                inAmount: quote.inAmount,
                outAmount: quote.outAmount,
                priceImpactPct: quote.priceImpactPct,
                slippageBps: quote.slippageBps,
                method: 'paper',
            };
        } catch (err) {
            logger.error(`❌ Paper trade quote failed: ${err}`);
            return {
                success: false,
                txHash: '',
                inAmount: params.amount,
                outAmount: '0',
                priceImpactPct: '0',
                slippageBps: params.slippageBps || 150,
                method: 'paper',
            };
        }
    }

    private async executeViaUltra(params: {
        inputMint: string;
        outputMint: string;
        amount: string;
        slippageBps?: number;
    }): Promise<{
        success: boolean;
        txHash: string;
        inAmount: string;
        outAmount: string;
        priceImpactPct: string;
        slippageBps: number;
        method: 'ultra';
    }> {
        const order = await this.ultra.createOrder({
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount,
            taker: this.wallet.publicKey,
            slippageBps: params.slippageBps,
        });

        const signedTx = this.wallet.signTransaction(order.transaction);

        const result = await this.ultra.executeOrder({
            signedTransaction: signedTx,
            requestId: order.requestId,
        });

        return {
            success: result.status === 'Success',
            txHash: result.signature || '',
            inAmount: order.inAmount,
            outAmount: result.outputAmountResult || order.outAmount,
            priceImpactPct: order.priceImpactPct,
            slippageBps: order.slippageBps,
            method: 'ultra',
        };
    }

    private async executeViaLegacy(params: {
        inputMint: string;
        outputMint: string;
        amount: string;
        slippageBps?: number;
    }): Promise<{
        success: boolean;
        txHash: string;
        inAmount: string;
        outAmount: string;
        priceImpactPct: string;
        slippageBps: number;
        method: 'legacy';
    }> {
        const slippage = params.slippageBps || 150;

        const quote = await this.legacy.getQuote({
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount,
            slippageBps: slippage,
        });

        // Dynamic priority fees for faster inclusion
        const { getDynamicPriorityFee, buildPriorityFeeConfig } = await import('../utils/fees.js');
        const dynamicFee = CONFIG.DYNAMIC_FEES_ENABLED
            ? await getDynamicPriorityFee(this.wallet.getConnection())
            : 1000000;

        const swapTx = await this.legacy.buildSwapTx({
            quoteResponse: quote,
            userPublicKey: this.wallet.publicKey,
            dynamicComputeUnitLimit: true,
            dynamicSlippage: true,
            prioritizationFeeLamports: buildPriorityFeeConfig(dynamicFee),
        });

        // Try Jito MEV protection first (live only)
        let txid: string;
        if (CONFIG.JITO_ENABLED) {
            const { sendViaJito } = await import('../utils/jito.js');
            const signedTx = this.wallet.signTransaction(swapTx.swapTransaction);
            const jitoResult = await sendViaJito(signedTx);
            if (jitoResult.success) {
                txid = jitoResult.bundleId || `jito_${Date.now()}`;
                logger.info(`🛡️ TX sent via Jito (MEV protected): ${txid}`);
            } else {
                // Fallback to direct send
                logger.warn(`⚠️ Jito failed, sending directly: ${jitoResult.error}`);
                txid = await this.wallet.signAndSend(swapTx.swapTransaction);
            }
        } else {
            txid = await this.wallet.signAndSend(swapTx.swapTransaction);
        }

        const confirmed = await this.wallet.confirmTransaction(txid, swapTx.lastValidBlockHeight);

        return {
            success: confirmed,
            txHash: txid,
            inAmount: quote.inAmount,
            outAmount: quote.outAmount,
            priceImpactPct: quote.priceImpactPct,
            slippageBps: quote.slippageBps,
            method: 'legacy',
        };
    }
}
