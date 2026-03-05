import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.JUP_API_KEY!;
const SOL = 'So11111111111111111111111111111111111111112';

// Test quote for each meme coin
const coins = [
    { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
    { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
    { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
    { symbol: 'MEW', mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5' },
    { symbol: 'POPCAT', mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
    { symbol: 'ai16z', mint: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC' },
    { symbol: 'GOAT', mint: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump' },
    { symbol: 'PNUT', mint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump' },
    { symbol: 'MEME', mint: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY' },
];

async function main() {
    for (const coin of coins) {
        try {
            const url = `https://api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${coin.mint}&amount=10000000&slippageBps=150`;
            const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
            const status = res.status;
            if (status === 200) {
                console.log(`✅ ${coin.symbol}: OK`);
            } else {
                const body = await res.text();
                console.log(`❌ ${coin.symbol}: ${status} — ${body.substring(0, 100)}`);
            }
        } catch (e) {
            console.log(`❌ ${coin.symbol}: Error — ${e}`);
        }
    }
}

main();
