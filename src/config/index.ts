import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(key: string): string {
    const val = process.env[key];
    if (!val) {
        throw new Error(`❌ Missing required env var: ${key}. Check your .env file.`);
    }
    return val;
}

function optionalEnv(key: string, defaultVal: string): string {
    return process.env[key] || defaultVal;
}

// Paper trading mode — wallet key not required
const isPaperTrading = optionalEnv('PAPER_TRADING', 'false') === 'true';

export const CONFIG = {
    // Mode
    PAPER_TRADING: isPaperTrading,
    PAPER_BALANCE_USD: parseFloat(optionalEnv('PAPER_BALANCE_USD', '100')),

    // Jupiter
    JUP_API_BASE: optionalEnv('JUP_API_BASE', 'https://api.jup.ag'),
    JUP_API_KEY: requireEnv('JUP_API_KEY'),

    // Solana RPC
    SOLANA_RPC_URL: optionalEnv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    SOLANA_RPC_FALLBACK: process.env['SOLANA_RPC_FALLBACK'] || '',

    // Wallet (not required in paper trading mode)
    WALLET_PRIVATE_KEY: isPaperTrading ? 'PAPER_MODE' : requireEnv('WALLET_PRIVATE_KEY'),

    // OpenRouter
    OPENROUTER_API_KEY: requireEnv('OPENROUTER_API_KEY'),
    OPENROUTER_MODEL: optionalEnv('OPENROUTER_MODEL', 'google/gemini-2.0-flash-001'),

    // ═══════════════════════════════════
    // RISK MANAGEMENT
    // ═══════════════════════════════════

    // Position sizing: % of total balance per trade (1% = conservative)
    POSITION_SIZE_PCT: parseFloat(optionalEnv('POSITION_SIZE_PCT', '1')),

    // Minimum Risk:Reward ratio (1:2 means risk $1 to gain $2)
    MIN_RISK_REWARD_RATIO: parseFloat(optionalEnv('MIN_RISK_REWARD_RATIO', '2.0')),

    // Max daily loss as % of starting balance (5% = kill switch)
    MAX_DAILY_LOSS_PCT: parseFloat(optionalEnv('MAX_DAILY_LOSS_PCT', '5')),

    DEFAULT_SLIPPAGE_BPS: parseInt(optionalEnv('DEFAULT_SLIPPAGE_BPS', '150')),
    MAX_PRICE_IMPACT_PCT: parseFloat(optionalEnv('MAX_PRICE_IMPACT_PCT', '3.0')),
    TRADE_COOLDOWN_MS: parseInt(optionalEnv('TRADE_COOLDOWN_MS', '10000')),

    // Intervals
    SCAN_INTERVAL_MS: parseInt(optionalEnv('SCAN_INTERVAL_MS', '10000')),
    MONITOR_INTERVAL_MS: parseInt(optionalEnv('MONITOR_INTERVAL_MS', '5000')),

    // Meme coin scanner
    MIN_LIQUIDITY_USD: parseFloat(optionalEnv('MIN_LIQUIDITY_USD', '5000')),
    MIN_VOLUME_24H_USD: parseFloat(optionalEnv('MIN_VOLUME_24H_USD', '20000')),
    MAX_TOKENS_WATCH: parseInt(optionalEnv('MAX_TOKENS_WATCH', '50')),

    // ═══════════════════════════════════
    // PHASE 1: SPEED & EXECUTION
    // ═══════════════════════════════════

    // Dynamic Priority Fees
    DYNAMIC_FEES_ENABLED: optionalEnv('DYNAMIC_FEES_ENABLED', 'true') === 'true',
    MAX_PRIORITY_FEE_LAMPORTS: parseInt(optionalEnv('MAX_PRIORITY_FEE_LAMPORTS', '5000000')),

    // Jito MEV Protection (live trading only)
    JITO_ENABLED: optionalEnv('JITO_ENABLED', 'false') === 'true',
    JITO_TIP_LAMPORTS: parseInt(optionalEnv('JITO_TIP_LAMPORTS', '10000')),

    // ═══════════════════════════════════
    // PHASE 3: SMART TRAILING STOP-LOSS
    // ═══════════════════════════════════

    // Enable trailing stop-loss (follows price up, sells on drop)
    TRAILING_SL_ENABLED: optionalEnv('TRAILING_SL_ENABLED', 'true') === 'true',

    // Activation: trailing SL kicks in after price rises X% above entry
    TRAILING_SL_ACTIVATION_PCT: parseFloat(optionalEnv('TRAILING_SL_ACTIVATION_PCT', '3')),

    // Trail distance: SL trails X% below the highest price reached
    TRAILING_SL_DISTANCE_PCT: parseFloat(optionalEnv('TRAILING_SL_DISTANCE_PCT', '5')),

    // Breakeven lock: move SL to entry price once X% profit is reached
    BREAKEVEN_LOCK_PCT: parseFloat(optionalEnv('BREAKEVEN_LOCK_PCT', '2')),
} as const;

/** Calculate position size in SOL based on % of balance */
export function calculatePositionSol(balanceSol: number): number {
    return balanceSol * (CONFIG.POSITION_SIZE_PCT / 100);
}

/** Calculate max daily loss in SOL based on % of balance */
export function calculateMaxDailyLossSol(balanceSol: number): number {
    return balanceSol * (CONFIG.MAX_DAILY_LOSS_PCT / 100);
}

export function validateConfig(): void {
    if (CONFIG.PAPER_TRADING) {
        console.log('');
        console.log('  📋 MODE: PAPER TRADING (DEMO)');
        console.log(`  💵 Virtual Balance: $${CONFIG.PAPER_BALANCE_USD}`);
        console.log('  ⚠️  Trades are SIMULATED — no real money used');
        console.log('');
    } else {
        console.log('  🔴 MODE: LIVE TRADING');
    }
    console.log(`  🪐 Jupiter API: ${CONFIG.JUP_API_BASE}`);
    console.log(`  🧠 AI Model: ${CONFIG.OPENROUTER_MODEL}`);
    console.log(`  📊 Position Size: ${CONFIG.POSITION_SIZE_PCT}% of balance per trade`);
    console.log(`  ⚖️  Min R:R Ratio: 1:${CONFIG.MIN_RISK_REWARD_RATIO}`);
    console.log(`  🛑 Max Daily Loss: ${CONFIG.MAX_DAILY_LOSS_PCT}% of balance`);
    console.log(`  🔍 Max Tokens to Watch: ${CONFIG.MAX_TOKENS_WATCH}`);
    console.log(`  ⏱️  Scan Interval: ${CONFIG.SCAN_INTERVAL_MS / 1000}s`);
    console.log(`  ⚡ Dynamic Fees: ${CONFIG.DYNAMIC_FEES_ENABLED ? 'ON' : 'OFF'}`);
    console.log(`  🛡️  Jito MEV: ${CONFIG.JITO_ENABLED ? 'ON' : 'OFF'}`);
    console.log(`  🔄 Trailing SL: ${CONFIG.TRAILING_SL_ENABLED ? `ON (activate: +${CONFIG.TRAILING_SL_ACTIVATION_PCT}%, trail: ${CONFIG.TRAILING_SL_DISTANCE_PCT}%)` : 'OFF'}`);
    console.log(`  🔒 Breakeven Lock: +${CONFIG.BREAKEVEN_LOCK_PCT}%`);
    console.log('');
}
