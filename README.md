
# MFG Automation: WhatsApp & Telegram Enterprise Bot Hub 🚀

A high-performance, production-ready dual-platform automation hub combining an enterprise WhatsApp marketing engine with an AI-driven Telegram Userbot. Engineered for high-volume message routing, smart AI mirroring, CRM data filtering, and seamless SMM panel orchestration. Built for 24/7 cloud stability and rapid deployment via Railway.

---

## 🛠️ Complete Feature Matrix

### 🟢 WhatsApp Automation Engine
*   **Massive Contact Filtering**: Optimized algorithms built to ingest, validate, and group databases of over 9,000+ entries, instantly filtering and segmenting targeted demographics (e.g., Nigerian mobile formats).
*   **High-Volume Campaign Broadcasts**: Automated queue-based message broadcasting system designed to push updates safely while mimicking human pacing to avoid platform rate limits.
*   **Session Persistence**: Headless multi-device connection management keeping your automation active without constant QR re-authentication.
*   **Media Support**: Native handling for dynamic text, automated link delivery, and attachment rendering for document and image placement.

### 🔵 Telegram Userbot & Mirror AI
*   **Contextual Mirror AI Engine**: Real-time integration with the Groq API framework providing lightning-fast, ultra-low latency response structures that adapt to ongoing conversations natively.
*   **Multi-Account Session Layer**: Managed via GramJS (`telegram`) utilizing custom `StringSession` storage layers to support secure connection persistence across reboots.
*   **Targeted Broadcast Rails**: Automated campaign utilities to broadcast marketing funnels, links, and media directly to custom user lists, groups, or channels.
*   **Dynamic Command Framework**: Flexible structural parsing for direct admin execution commands, system reboots, and status checks.

### 🔌 SMM Panel Integration & Core API
*   **Direct API Orchestration**: Integrated external hooks allowing the bot to interact with Social Media Marketing (SMM) provider endpoints seamlessly.
*   **Automated Order Placement**: Instant programmatic processing for social growth services triggered straight from platform interactions.
*   **Dual-Engine Server**: An Express.js backend backend that serves real-time API routes while concurrently managing the persistent MTProto and WhatsApp client event loops.
*   **Resilient NIXPACKS Environment**: Pre-configured build pipelines ensuring all system binaries, dependencies, and execution contexts deploy perfectly in cloud environments.

---

## 📦 Tech Stack

*   **Runtime**: Node.js (v20+)
*   **Web Framework**: Express.js (CORS enabled)
*   **Telegram Protocol**: MTProto via `telegram` (GramJS) & `input`
*   **WhatsApp Protocol**: `whatsapp-web.js`
*   **AI Infrastructure**: Groq API Engine
*   **Log Management**: Pino High-Performance Logger
*   **Deployment Configuration**: NIXPACKS / Railway

---

## 🚀 Getting Started

### 1. Environment Configuration
Create a secure `.env` file in your root directory (never commit this file to GitHub):

```env
# System Configuration
PORT=3000
DATA_DIR=./data

# Telegram API Credentials
TG_API_ID=your_telegram_api_id
TG_API_HASH=your_telegram_api_hash
TG_SESSION_STRING=your_saved_string_session

# AI & Third-Party APIs
GROQ_API_KEY=your_groq_api_key
SMM_API_KEY=your_smm_panel_api_key

# Bot Preferences
BOT_NAME=mfg_bot
OWNER_PHONE=your_primary_phone

```
### 2. Local Setup & Execution
```bash
# Clone the repository structure
git clone [https://github.com/yourusername/your-repo-name.git](https://github.com/yourusername/your-repo-name.git)
cd your-repo-name

# Install all production and system dependencies
npm install

# Run the development environment
npm run dev

```
## ☁️ Enterprise Cloud Deployment
### Deploying directly to Railway
This repository features an optimized infrastructure profile utilizing railway.toml.
 1. Connect your GitHub repository to your **Railway.app** dashboard.
 2. In the **Variables** tab of your Railway service, inject your required environment credentials (TG_API_ID, TG_API_HASH, GROQ_API_KEY, etc.).
 3. Railway will immediately invoke the NIXPACKS builder, install Node.js v20+, allocate your service PORT, and deploy your automation server with an automatic failure restart policy.
## 🔒 License
Private / Proprietary. Designed, built, and maintained by **teddymfg** / **mfg_bot**.
```

```
