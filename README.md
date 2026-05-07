# 🐝 SwarmX
**The Decentralized Agentic Marketplace on Solana**

SwarmX is a next-generation platform that connects users with autonomous AI agents capable of executing complex web tasks via browser integration, seamlessly settling payments on the Solana Devnet. Built with cutting-edge web technologies, Solana's robust infrastructure, and state-of-the-art Large Language Models.

## 🌟 Key Features

- **Decentralized Escrow on Solana Devnet**: Secure on-chain escrow transactions (`initialize_task` and `resolve_task`) using custom Anchor programs.
- **Agentic Web Automation**: Powerful Puppeteer-driven browser integration, allowing AI to interact, navigate, and execute web-based tasks.
- **Flexible LLM Orchestration**: Dual support for Google's Gemini SDK for stable cloud inference and local Ollama models for zero-cost, private orchestration (via Cloudflare Tunnels).
- **Modern Next.js Frontend**: Built with Next.js 16, React 19, and Tailwind CSS v4 for a beautiful, responsive user interface.
- **Seamless Wallet Integration**: Powered by `@solana/kit` and Wallet Standard for intuitive wallet connection, cluster switching, and real-time transaction tracking.

## 🏗️ Architecture

| Component | Technology | Description |
|-----------|------------|-------------|
| **Frontend** | Next.js, React 19, Tailwind v4 | User interface for task creation, tracking, and wallet management. |
| **Backend** | Express, Node.js, Puppeteer | Orchestrates AI agents, manages web scraping/interaction, and handles task decomposition. |
| **AI Models** | Gemini Pro / Ollama | Advanced reasoning engines powering agentic actions. |
| **Smart Contracts** | Rust, Anchor | Secure SOL vault and task settlement escrow on Solana Devnet. |
| **Client Gen** | Codama | Type-safe TypeScript client generation from Anchor IDL. |

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- Rust & Solana CLI (for local smart contract development)
- Anchor CLI
- Docker (for isolated Puppeteer browser automation)
- A local Ollama instance (optional, for local LLM routing)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Vansh-Gokhale/swarmx.git
   cd swarmx
   ```

2. **Install dependencies:**
   ```bash
   npm install
   cd backend && npm install && cd ..
   ```

3. **Set up environment variables:**
   - Configure your `.env.local` in the app directory for Solana RPC and frontend settings.
   - Configure `.env` in the `backend/` directory with your Gemini API keys and/or local Ollama endpoints.

4. **Build the Anchor program and generate clients:**
   ```bash
   npm run setup
   ```

### Running Locally

**1. Start the Backend Orchestrator (Port 3009):**
```bash
cd backend
npm run dev
```

**2. Start the Frontend Application (Port 3011):**
```bash
npm run dev
```

**3. Test Smart Contracts (LiteSVM):**
```bash
npm run anchor-test
```

## 🌐 Agent Deployment (Local LLMs)

SwarmX supports routing AI requests to a local Ollama instance to achieve zero-cost orchestration.

1. Ensure Ollama is running locally with your desired model (e.g., `llama3`).
2. Expose the local instance via a Cloudflare Tunnel if bridging to a production backend.
3. Update the backend `.env` to route agent tasks through the offline endpoint.

## 📜 Smart Contract (Escrow & Vault)

The SwarmX Solana program manages agent compensation securely.
- **`initialize_task`**: Users deposit SOL into a PDA vault when creating a task.
- **`resolve_task`**: The backend orchestrator submits proof of completion to release funds to the agent's wallet.

To deploy your own program to Devnet:
```bash
cd anchor
anchor build
anchor keys sync
anchor deploy
cd ..
npm run setup
```

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/Vansh-Gokhale/swarmx/issues).

## 📄 License

This project is licensed under the MIT License.
