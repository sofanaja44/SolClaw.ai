import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { LegacyQuoteResponse, LegacySwapResponse } from './types.js';

const SWAP_BASE = `${CONFIG.JUP_API_BASE}/swap/v1`;

/**
 * Jupiter Legacy Swap API — Fallback connector.
 * Requires own RPC for sending transactions.
 */
export class JupiterLegacy {
    private headers: Record<string, string>;

    constructor() {
        this.headers = {
            'Content-Type': 'application/json',
            'x-api-key': CONFIG.JUP_API_KEY,
        };
    }

    /**
     * Get quote (best route & price).
     */
    async getQuote(params: {
        inputMint: string;
        outputMint: string;
        amount: string;
        slippageBps: number;
        swapMode?: string;
    }): Promise<LegacyQuoteResponse> {
        const searchParams = new URLSearchParams({
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount,
            slippageBps: params.slippageBps.toString(),
            swapMode: params.swapMode || 'ExactIn',
        });

        const url = `${SWAP_BASE}/quote?${searchParams.toString()}`;
        logger.info(`🪐 Legacy: Getting quote...`);
        logger.info(`   📎 URL: ${url.substring(0, 150)}...`);

        const res = await fetch(url, { headers: this.headers });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Jupiter Legacy getQuote failed (${res.status}): ${errText}`);
        }

        return (await res.json()) as LegacyQuoteResponse;
    }

    /**
     * Build swap transaction from quote.
     */
    async buildSwapTx(params: {
        quoteResponse: LegacyQuoteResponse;
        userPublicKey: string;
        dynamicComputeUnitLimit?: boolean;
        dynamicSlippage?: boolean;
        prioritizationFeeLamports?: number | { priorityLevelWithMaxLamports: { maxLamports: number; priorityLevel: string } };
    }): Promise<LegacySwapResponse> {
        const url = `${SWAP_BASE}/swap`;

        const body: Record<string, unknown> = {
            quoteResponse: params.quoteResponse,
            userPublicKey: params.userPublicKey,
            dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
            dynamicSlippage: params.dynamicSlippage ?? true,
        };

        if (params.prioritizationFeeLamports) {
            body.prioritizationFeeLamports = params.prioritizationFeeLamports;
        }

        logger.info(`🪐 Legacy: Building swap transaction...`);

        const res = await fetch(url, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Jupiter Legacy buildSwapTx failed (${res.status}): ${errText}`);
        }

        return (await res.json()) as LegacySwapResponse;
    }
}
