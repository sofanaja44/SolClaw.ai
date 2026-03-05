import {
    Connection,
    Keypair,
    VersionedTransaction,
    LAMPORTS_PER_SOL,
    PublicKey,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

export class WalletManager {
    private keypair: Keypair | null = null;
    private connection: Connection;
    public publicKey: string;
    private isPaper: boolean;

    constructor() {
        this.isPaper = CONFIG.PAPER_TRADING;
        this.connection = new Connection(CONFIG.SOLANA_RPC_URL, 'confirmed');

        if (this.isPaper) {
            // Paper trading — generate random keypair (not used for real txs)
            this.keypair = Keypair.generate();
            this.publicKey = this.keypair.publicKey.toBase58();
            logger.info(`📋 Paper wallet: ${this.publicKey} (virtual)`);
        } else {
            // Live trading — load real keypair
            const secretKey = bs58.decode(CONFIG.WALLET_PRIVATE_KEY);
            this.keypair = Keypair.fromSecretKey(secretKey);
            this.publicKey = this.keypair.publicKey.toBase58();
            logger.info(`🔑 Live wallet: ${this.publicKey}`);
        }
    }

    async getBalanceSOL(): Promise<number> {
        if (this.isPaper) return 0; // Paper balance managed by StateManager

        try {
            const lamports = await this.connection.getBalance(this.keypair!.publicKey);
            return lamports / LAMPORTS_PER_SOL;
        } catch (err) {
            if (CONFIG.SOLANA_RPC_FALLBACK) {
                const fallback = new Connection(CONFIG.SOLANA_RPC_FALLBACK, 'confirmed');
                const lamports = await fallback.getBalance(this.keypair!.publicKey);
                return lamports / LAMPORTS_PER_SOL;
            }
            throw err;
        }
    }

    async getTokenBalance(mintAddress: string): Promise<number> {
        if (this.isPaper) return 0; // Paper balance managed by StateManager

        try {
            const mint = new PublicKey(mintAddress);
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                this.keypair!.publicKey,
                { mint }
            );
            if (tokenAccounts.value.length === 0) return 0;
            return tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
        } catch {
            return 0;
        }
    }

    signTransaction(txBase64: string): string {
        if (this.isPaper) return txBase64; // No signing in paper mode

        const txBuffer = Buffer.from(txBase64, 'base64');
        const tx = VersionedTransaction.deserialize(txBuffer);
        tx.sign([this.keypair!]);
        const signedBytes = tx.serialize();
        return Buffer.from(signedBytes).toString('base64');
    }

    async signAndSend(txBase64: string): Promise<string> {
        if (this.isPaper) return `paper_${Date.now()}`; // Fake txid

        const txBuffer = Buffer.from(txBase64, 'base64');
        const tx = VersionedTransaction.deserialize(txBuffer);
        tx.sign([this.keypair!]);

        const rawTx = tx.serialize();
        const txid = await this.connection.sendRawTransaction(rawTx, {
            skipPreflight: true,
            maxRetries: 3,
        });

        logger.info(`📤 TX sent: ${txid}`);
        return txid;
    }

    async confirmTransaction(txid: string, lastValidBlockHeight: number): Promise<boolean> {
        if (this.isPaper) return true; // Always confirmed in paper mode

        try {
            const latestBlockhash = await this.connection.getLatestBlockhash();
            const confirmation = await this.connection.confirmTransaction(
                {
                    signature: txid,
                    blockhash: latestBlockhash.blockhash,
                    lastValidBlockHeight,
                },
                'confirmed'
            );
            return !confirmation.value.err;
        } catch (err) {
            logger.error(`❌ TX confirmation failed: ${txid}`, err);
            return false;
        }
    }

    getConnection(): Connection {
        return this.connection;
    }
}
