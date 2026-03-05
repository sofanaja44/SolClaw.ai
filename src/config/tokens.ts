export interface TokenInfo {
    mint: string;
    decimals: number;
    symbol: string;
    name: string;
}

// Core tokens (hardcoded)
export const CORE_TOKENS: Record<string, TokenInfo> = {
    SOL: {
        mint: 'So11111111111111111111111111111111111111112',
        decimals: 9,
        symbol: 'SOL',
        name: 'Solana',
    },
    USDC: {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
    },
    USDT: {
        mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        decimals: 6,
        symbol: 'USDT',
        name: 'Tether USD',
    },
};

// Tracked meme coins — dynamically populated by scanner
export class TokenRegistry {
    private tokens: Map<string, TokenInfo> = new Map();

    constructor() {
        // Load core tokens
        for (const token of Object.values(CORE_TOKENS)) {
            this.tokens.set(token.mint, token);
        }
    }

    get(mint: string): TokenInfo | undefined {
        return this.tokens.get(mint);
    }

    add(token: TokenInfo): void {
        this.tokens.set(token.mint, token);
    }

    remove(mint: string): void {
        // Don't remove core tokens
        const core = Object.values(CORE_TOKENS).find((t) => t.mint === mint);
        if (!core) {
            this.tokens.delete(mint);
        }
    }

    getAll(): TokenInfo[] {
        return Array.from(this.tokens.values());
    }

    getMemeCoins(): TokenInfo[] {
        const coreMints = new Set(Object.values(CORE_TOKENS).map((t) => t.mint));
        return this.getAll().filter((t) => !coreMints.has(t.mint));
    }

    size(): number {
        return this.tokens.size;
    }

    /** Convert human-readable amount to raw lamports/base units */
    toRawAmount(mint: string, amount: number): string {
        const token = this.get(mint);
        if (!token) throw new Error(`Token not found: ${mint}`);
        return Math.floor(amount * Math.pow(10, token.decimals)).toString();
    }

    /** Convert raw lamports/base units to human-readable */
    fromRawAmount(mint: string, rawAmount: string): number {
        const token = this.get(mint);
        if (!token) throw new Error(`Token not found: ${mint}`);
        return parseInt(rawAmount) / Math.pow(10, token.decimals);
    }
}
