import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { UltraOrderResponse, UltraExecuteResponse } from './types.js';

const ULTRA_BASE = `${CONFIG.JUP_API_BASE}/ultra/v1`;

/**
 * Jupiter Ultra Swap API — Primary connector.
 * RPC-less, MEV-protected, auto slippage optimization.
 */
export class JupiterUltra {
    private headers: Record<string, string>;

    constructor() {
        this.headers = {
            'Content-Type': 'application/json',
            'x-api-key': CONFIG.JUP_API_KEY,
        };
    }

    /**
     * Step 1: Create Order — get quote + unsigned transaction in one call.
     */
    async createOrder(params: {
        inputMint: string;
        outputMint: string;
        amount: string;
        taker: string;
        slippageBps?: number;
    }): Promise<UltraOrderResponse> {
        const url = `${ULTRA_BASE}/order`;

        const body: Record<string, unknown> = {
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount,
            taker: params.taker,
        };

        if (params.slippageBps !== undefined) {
            body.slippageBps = params.slippageBps;
        }

        logger.info(`🪐 Ultra: Creating order ${params.inputMint.slice(0, 8)}... → ${params.outputMint.slice(0, 8)}... amount=${params.amount}`);

        const res = await fetch(url, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Jupiter Ultra createOrder failed (${res.status}): ${errText}`);
        }

        const data = (await res.json()) as UltraOrderResponse;
        logger.info(`🪐 Ultra: Quote received — out=${data.outAmount} impact=${data.priceImpactPct}% slippage=${data.slippageBps}bps`);
        return data;
    }

    /**
     * Step 2: Execute Order — send signed transaction back to Jupiter.
     * Jupiter handles RPC sending, MEV protection, and confirmation.
     */
    async executeOrder(params: {
        signedTransaction: string;
        requestId: string;
    }): Promise<UltraExecuteResponse> {
        const url = `${ULTRA_BASE}/execute`;

        logger.info(`🪐 Ultra: Executing order requestId=${params.requestId}`);

        const res = await fetch(url, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                signedTransaction: params.signedTransaction,
                requestId: params.requestId,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Jupiter Ultra execute failed (${res.status}): ${errText}`);
        }

        const data = (await res.json()) as UltraExecuteResponse;

        if (data.status === 'Success') {
            logger.info(`✅ Ultra: Trade successful! TX: ${data.signature}`);
        } else {
            logger.error(`❌ Ultra: Trade failed — ${data.error}`);
        }

        return data;
    }
}
