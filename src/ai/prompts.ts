export const TRADING_SYSTEM_PROMPT = `You are an expert meme coin trading analyst on Solana. Your job is to analyze market data and make trading decisions.

## Your Role
- Analyze price movements, volume, and liquidity of meme coins
- Identify entry opportunities with high potential
- Calculate optimal Take Profit (TP) and Stop Loss (SL) levels
- Always prioritize risk management

## STRICT RISK MANAGEMENT RULES
1. Position size is ALWAYS 1% of total balance — you do NOT choose the amount
2. Minimum Risk:Reward ratio is 1:2 — NEVER recommend trades below this
3. SL should be -5% to -10% from entry for meme coins
4. TP MUST be at least 2x the SL percentage (e.g., if SL = -5%, TP >= +10%)
5. NEVER open a position if one already exists for that token
6. Maximum open positions: 5 at any time
7. If uncertain, recommend HOLD — no trade is better than a bad trade
8. Prefer tokens with strong 24h movement (>3%) and sufficient liquidity

## IMPORTANT
- The bot automatically sizes positions at 1% of balance
- You just need to specify the TOKEN, TP%, SL%, and your reasoning
- The amount_sol field is IGNORED as the bot calculates it automatically
- Focus on finding the BEST opportunity from the watchlist, not necessarily the first one

## Output Format
When calling functions, always provide:
- Clear reasoning for your decision
- Confidence level (0-100)
- TP percentage (minimum 10% for meme coins)
- SL percentage (maximum 10% for meme coins)
`;

export const TRADE_ANALYSIS_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'execute_buy',
            description: 'Execute a BUY trade for a meme coin. The bot will automatically use 1% of balance. Only call when you identify a high-probability opportunity.',
            parameters: {
                type: 'object',
                properties: {
                    token_symbol: {
                        type: 'string',
                        description: 'Token symbol (e.g., BONK, WIF, PNUT)',
                    },
                    token_mint: {
                        type: 'string',
                        description: 'Full Solana token mint address from the watchlist data',
                    },
                    amount_sol: {
                        type: 'number',
                        description: 'Ignored — bot auto-calculates at 1% of balance. Put 0.',
                    },
                    confidence: {
                        type: 'number',
                        description: 'Your confidence level (0-100). Only trade above 65.',
                    },
                    reasoning: {
                        type: 'string',
                        description: 'Brief explanation of why this is a good trade',
                    },
                    tp_percentage: {
                        type: 'number',
                        description: 'Take profit percentage from entry (e.g., 15 = +15%). Must be >= 2x SL.',
                    },
                    sl_percentage: {
                        type: 'number',
                        description: 'Stop loss percentage from entry (e.g., 5 = -5%). Maximum 10%.',
                    },
                },
                required: ['token_symbol', 'token_mint', 'amount_sol', 'confidence', 'reasoning', 'tp_percentage', 'sl_percentage'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'close_position',
            description: 'Close an existing position. Call when TP/SL is hit or conditions have changed.',
            parameters: {
                type: 'object',
                properties: {
                    token_mint: {
                        type: 'string',
                        description: 'Token mint address of the position to close',
                    },
                    reasoning: {
                        type: 'string',
                        description: 'Reason for closing the position',
                    },
                },
                required: ['token_mint', 'reasoning'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'hold',
            description: 'No trade action. Call when market conditions are not favorable or risk is too high.',
            parameters: {
                type: 'object',
                properties: {
                    reasoning: {
                        type: 'string',
                        description: 'Reason for holding (not trading)',
                    },
                },
                required: ['reasoning'],
            },
        },
    },
];
