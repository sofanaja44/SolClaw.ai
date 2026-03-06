// ============================================
// Jupiter API Types
// ============================================

/** Jupiter Ultra API — Create Order Response */
export interface UltraOrderResponse {
    requestId: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    priceImpactPct: string;
    routePlan: RoutePlanStep[];
    transaction: string; // base64 unsigned tx
    lastValidBlockHeight: number;
    prioritizationFeeLamports: number;
    dynamicSlippageReport?: {
        slippageBps: number;
        otherAmount: string;
        simulatedIncurredSlippageBps: number;
        amplificationRatio: string;
    };
}

/** Jupiter Ultra API — Execute Response */
export interface UltraExecuteResponse {
    signature: string;
    status: 'Success' | 'Failed';
    error?: string;
    inputAmountResult?: string;
    outputAmountResult?: string;
}

/** Jupiter Legacy Quote Response */
export interface LegacyQuoteResponse {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    priceImpactPct: string;
    routePlan: RoutePlanStep[];
    contextSlot: number;
    timeTaken: number;
}

/** Jupiter Legacy Swap Response */
export interface LegacySwapResponse {
    swapTransaction: string; // base64
    lastValidBlockHeight: number;
    prioritizationFeeLamports?: number;
    computeUnitLimit?: number;
    dynamicSlippageReport?: {
        slippageBps: number;
        otherAmount: string;
        simulatedIncurredSlippageBps: number;
    };
}

export interface RoutePlanStep {
    swapInfo: {
        ammKey: string;
        label: string;
        inputMint: string;
        outputMint: string;
        inAmount: string;
        outAmount: string;
        feeAmount: string;
        feeMint: string;
    };
    percent: number;
}

/** Jupiter Price API Response */
export interface PriceResponse {
    data: Record<string, {
        id: string;
        type: string;
        price: string;
    }>;
    timeTaken: number;
}

// ============================================
// Bot Internal Types
// ============================================

export interface TradeSignal {
    action: 'BUY' | 'SELL' | 'HOLD';
    token: string;
    mint: string;
    confidence: number; // 0-100
    reasoning: string;
    suggestedAmountSol: number;
}

export interface TPSLResult {
    tp: number;       // take-profit price
    sl: number;       // stop-loss price
    riskRewardRatio: number;
    reasoning: string;
}

export interface Position {
    id: string;
    token: string;
    mint: string;
    side: 'LONG';
    entryPrice: number;
    currentPrice: number;
    amount: number;       // token amount
    amountSol: number;    // SOL value at entry
    tp: number;
    sl: number;
    riskRewardRatio: number;
    openedAt: number;     // timestamp
    reasoning: string;
    txHash: string;
    // Phase 3: Trailing Stop-Loss
    highestPrice?: number;      // highest price since entry (for trailing SL)
    trailingActive?: boolean;   // true once price exceeds breakeven threshold
    originalSl?: number;        // backup of the initial SL before trailing kicks in
    // Phase 4: Partial Take-Profit
    partialTpStage?: number;    // 0=none, 1=first partial sold, 2=second partial sold
    originalAmount?: number;    // original token amount at entry (before partial sells)
    originalAmountSol?: number; // original SOL amount at entry
}

export interface TradeRecord {
    id: number;
    timestamp: string;
    type: 'BUY' | 'SELL';
    inputMint: string;
    outputMint: string;
    inputAmount: string;
    outputAmount: string;
    priceImpactPct: number;
    slippageBps: number;
    txHash: string;
    status: 'SUCCESS' | 'FAILED';
    errorReason: string;
    aiReasoning: string;
    tp: number;
    sl: number;
    pnl: number;
    tokenName: string;
}

export interface BotState {
    balanceSol: number;
    balanceUsdc: number;
    tokenBalances: Record<string, number>;
    positions: Position[];
    dailyPnL: number;
    totalPnL: number;
    consecutiveFailures: number;
    isRunning: boolean;
    lastTradeTime: number;
    tradesCount: number;
    killSwitchActive: boolean;
}

export interface MarketSnapshot {
    timestamp: number;
    prices: Record<string, number>;    // mint → USD price
    solPrice: number;
    watchlist: WatchlistToken[];
}

export interface WatchlistToken {
    mint: string;
    symbol: string;
    name: string;
    price: number;
    priceChange1h: number;
    priceChange24h: number;
    volume24h: number;
    liquidity: number;
    marketCap: number;
}

export interface RiskCheckResult {
    allowed: boolean;
    reason: string;
    adjustedParams?: {
        slippageBps?: number;
        amount?: string;
    };
}

export interface CloseDecision {
    shouldClose: boolean;
    reason: string;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH';
}
