<div align="center">

# 🐾 SolClaw.ai

### AI-Powered Solana Meme Coin Trading Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-purple.svg)](https://solana.com/)
[![Jupiter](https://img.shields.io/badge/Jupiter-DEX-green.svg)](https://jup.ag/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![Built by](https://img.shields.io/badge/Built%20by-sofanaja44-ff6b35.svg)](https://github.com/sofanaja44)

<br/>

> **SolClaw.ai** is an autonomous AI trading bot that scans, analyzes, and trades Solana meme coins in real-time using AI-powered decision making, smart risk management, and real-time monitoring dashboard.

<br/>

```
  ╔═══════════════════════════════════════════════════════╗
  ║                                                       ║
  ║   🐾  S O L C L A W . A I                            ║
  ║                                                       ║
  ║   "Hunt Smart. Trade Smarter."                        ║
  ║                                                       ║
  ║   AI-Powered Solana Meme Coin Trading Engine          ║
  ║   Created with ❤️ by sofanaja44                       ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝
```

</div>

---

## ⚡ Key Features

<table>
<tr>
<td width="50%">

### 🧠 AI Trading Engine
- **Google Gemini 2.0 Flash** for real-time market analysis
- Autonomous BUY/SELL decisions with confidence scoring
- Multi-factor analysis: price momentum, volume, liquidity
- Configurable risk/reward ratios (minimum 1:2)

</td>
<td width="50%">

### 📊 Real-Time Dashboard
- **Web Dashboard** at `http://localhost:3000`
- Live position tracking with PnL updates
- Trade history with win/loss statistics
- WebSocket-powered instant updates

</td>
</tr>
<tr>
<td width="50%">

### 🛡️ Smart Risk Management
- **Trailing Stop-Loss** that follows price up & locks profits
- **Breakeven Lock** — SL moves to entry at +2% (zero-loss guarantee)
- Position sizing: 1% of balance per trade
- Daily loss limit protection (max 5%)
- Trade cooldown to prevent overtrading

</td>
<td width="50%">

### 📱 Telegram Alerts
- Real-time **BUY/SELL** notifications to your phone
- PnL tracking with every trade
- Bot status alerts (started/stopped/errors)
- Daily summary reports

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    🐾 SolClaw.ai Engine                     │
├─────────────┬───────────────┬───────────────┬───────────────┤
│   Scanner   │   AI Agent    │   Executor    │   Monitor     │
│  (Jupiter)  │  (Gemini AI)  │  (Trade Mgr)  │  (TP/SL/TSL) │
├─────────────┴───────────────┴───────────────┴───────────────┤
│                      Risk Manager                           │
│  Position Sizing │ Daily Loss Limit │ Trade Cooldown        │
├─────────────────────────────────────────────────────────────┤
│                    State Manager (SQLite)                    │
│  Positions │ Trade History │ Daily Stats │ PnL Tracking      │
├─────────────┬───────────────┬───────────────────────────────┤
│  Dashboard  │   Telegram    │   Winston Logger              │
│  (Web UI)   │   (Alerts)    │   (bot.log/trades.log)        │
└─────────────┴───────────────┴───────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **OpenRouter API Key** ([Get one](https://openrouter.ai/)) — for AI decisions
- **Jupiter API** (free, no key needed for basic usage)

### Installation

```bash
# Clone the repository
git clone https://github.com/sofanaja44/SolClaw.ai.git
cd SolClaw.ai

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
# Required: OPENROUTER_API_KEY
# Optional: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```

### Configuration

Edit `.env` file with your settings:

```env
# Trading Mode (start with paper!)
PAPER_TRADING=true
PAPER_BALANCE_USD=100

# AI Engine
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=google/gemini-2.0-flash-001

# Telegram Alerts (optional but recommended)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Run

```bash
# Start the bot
npx tsx src/index.ts

# Open dashboard
# → http://localhost:3000
```

---

## 📐 Trailing Stop-Loss — How It Works

SolClaw.ai features a **3-stage smart trailing stop-loss** system that maximizes profits:

```
Example: Buy token at $1.00 with SL -5%, TP +10%

Stage 1: FIXED SL
  Price: $1.00  →  SL = $0.95 (static -5%)
  
Stage 2: BREAKEVEN LOCK (at +2%)
  Price: $1.02  →  SL moves to $1.00 (entry price)
  ✅ Worst case: $0 loss guaranteed!

Stage 3: TRAILING ACTIVATED (at +3%)  
  Price: $1.03  →  SL = $0.9785 (trails 5% below peak)
  Price: $1.10  →  SL = $1.045  (profit locked! 🔒)
  Price: $1.04  →  SL ($1.045) hit → SELL at +4.5% profit! 💰

Without Trailing: price drops to $0.95 → SELL at -5% LOSS 📉
```

| Stage | Trigger | Action |
|-------|---------|--------|
| 🔴 Fixed SL | On entry | Static SL at -5% below entry |
| 🔒 Breakeven | +2% profit | SL → entry price (zero-loss) |
| 🔄 Trailing | +3% profit | SL follows 5% below peak price |

---

## 📂 Project Structure

```
SolClaw.ai/
├── src/
│   ├── ai/
│   │   ├── agent.ts          # AI trading agent (Gemini integration)
│   │   └── prompts.ts        # System prompts for AI decisions
│   ├── config/
│   │   ├── index.ts          # Configuration & env variables
│   │   └── tokens.ts         # Token registry & core tokens
│   ├── engine/
│   │   ├── executor.ts       # Trade execution (BUY/SELL)
│   │   ├── monitor.ts        # Position monitor + trailing SL
│   │   └── scanner.ts        # Market scanner (Jupiter)
│   ├── jupiter/
│   │   ├── index.ts          # Jupiter connector
│   │   ├── legacy.ts         # Jupiter Legacy API (v1)
│   │   ├── price.ts          # Price fetcher with caching
│   │   ├── types.ts          # TypeScript interfaces
│   │   └── ultra.ts          # Jupiter Ultra API
│   ├── risk/
│   │   └── manager.ts        # Risk management engine
│   ├── server/
│   │   ├── dashboard.html    # Web dashboard UI
│   │   └── index.ts          # Express + WebSocket server
│   ├── state/
│   │   └── manager.ts        # SQLite state & trade history
│   ├── utils/
│   │   ├── fees.ts           # Dynamic priority fees
│   │   ├── jito.ts           # Jito MEV protection
│   │   ├── logger.ts         # Winston logger (multi-file)
│   │   └── telegram.ts       # Telegram alert bot
│   ├── wallet/
│   │   └── index.ts          # Solana wallet integration
│   └── index.ts              # Main entry point
├── .env.example              # Environment template
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## ⚙️ Configuration Reference

### Trading Parameters

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPER_TRADING` | `true` | Paper trading mode (no real trades) |
| `PAPER_BALANCE_USD` | `100` | Starting balance for paper trading |
| `POSITION_SIZE_PCT` | `1` | % of balance per trade |
| `MIN_RISK_REWARD_RATIO` | `2.0` | Minimum R:R ratio required |
| `MAX_DAILY_LOSS_PCT` | `5` | Max daily loss before kill switch |
| `TRADE_COOLDOWN_MS` | `10000` | Cooldown between trades (ms) |

### Phase 1: Speed & Execution

| Variable | Default | Description |
|----------|---------|-------------|
| `DYNAMIC_FEES_ENABLED` | `true` | Auto-adjust priority fees |
| `MAX_PRIORITY_FEE_LAMPORTS` | `5000000` | Max fee cap |
| `JITO_ENABLED` | `false` | Jito MEV protection (live only) |
| `JITO_TIP_LAMPORTS` | `10000` | Jito tip amount |

### Phase 2: Alerts & Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | — | Your Telegram chat ID |

### Phase 3: Trailing Stop-Loss

| Variable | Default | Description |
|----------|---------|-------------|
| `TRAILING_SL_ENABLED` | `true` | Enable trailing stop-loss |
| `TRAILING_SL_ACTIVATION_PCT` | `3` | Activate after +X% gain |
| `TRAILING_SL_DISTANCE_PCT` | `5` | Trail X% below peak |
| `BREAKEVEN_LOCK_PCT` | `2` | Lock breakeven at +X% |

---

## 📱 Telegram Setup

1. Open Telegram → search **@BotFather**
2. Send `/newbot` → follow instructions → get your **token**
3. Send any message to your new bot
4. Open: `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Find `chat.id` in the response
6. Add both to your `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=123456:ABCdefGhIjKlmNoPqRsTuVwXyZ
   TELEGRAM_CHAT_ID=123456789
   ```

---

## 📊 Logging System

SolClaw.ai produces 3 separate log files:

| File | Content | Format | Rotation |
|------|---------|--------|----------|
| `bot.log` | All bot activity | Text | 5MB × 5 files |
| `errors.log` | Errors only | Text | 2MB × 3 files |
| `trades.log` | Trade events | JSON | 2MB × 5 files |

---

## ⚠️ Disclaimer

> **This software is for educational purposes only.** Trading cryptocurrencies involves significant risk. Past performance does not guarantee future results. Use at your own risk. Start with paper trading mode (`PAPER_TRADING=true`) to test before using real funds.

---

## 🛠️ Tech Stack

<div align="center">

| Technology | Purpose |
|:----------:|:--------|
| ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white) | Core language |
| ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white) | Runtime |
| ![Solana](https://img.shields.io/badge/Solana-9945FF?style=flat&logo=solana&logoColor=white) | Blockchain |
| ![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white) | Database |
| ![Express](https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white) | Dashboard server |
| ![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=flat&logoColor=white) | Real-time updates |
| ![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=flat&logo=telegram&logoColor=white) | Alerts |

</div>

---

<div align="center">

## 👨‍💻 Author

<img src="https://github.com/sofanaja44.png" width="100" style="border-radius: 50%;" alt="sofanaja44"/>

### **sofanaja44**

*Creator & Lead Developer of SolClaw.ai*

[![GitHub](https://img.shields.io/badge/GitHub-sofanaja44-181717?style=for-the-badge&logo=github)](https://github.com/sofanaja44)

---

<sub>

```
╔═══════════════════════════════════════════╗
║                                           ║
║   🐾 SolClaw.ai                          ║
║   Built with passion by sofanaja44        ║
║                                           ║
║   "The claw that catches the alpha"       ║
║                                           ║
║   © 2024-2026 sofanaja44                  ║
║   All rights reserved.                    ║
║                                           ║
╚═══════════════════════════════════════════╝
```

</sub>

⭐ **Star this repo if SolClaw.ai helped you!** ⭐

</div>
