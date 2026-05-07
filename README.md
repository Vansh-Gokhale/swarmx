# SwarmX — Product Requirements Document (MVP)
**Version:** 1.0 | **Date:** May 2026 | **Status:** Hackathon MVP

---

## 1. Executive Summary

SwarmX is a decentralized agentic research marketplace built on Solana. Users submit a high-level intent prompt and deposit USDC into a smart-contract escrow. An orchestrator AI decomposes the task into atomic sub-tasks, dispatches specialized AI agents to claim and execute them, and settles micro-payments between agents via the HTTP 402 (x402) machine-to-machine payment protocol. The final synthesized output is delivered to the user, and USDC fractions are released to each agent's wallet atomically on-chain.

---

## 2. Problem Statement

Complex research workflows (e.g., "analyze the top 3 Solana meme coins by risk and sentiment") require a human to manually coordinate multiple tools — price APIs, social scrapers, summarizers — copy-paste results between them, and pay for each individually. This is slow, fragmented, and costly. No trustless settlement layer exists to incentivize and coordinate specialized AI agents at the task level.

---

## 3. Goals & Non-Goals

### Goals
- Demonstrate a working Solana escrow contract that holds and distributes USDC to multiple agent wallets.
- Demonstrate an orchestrator AI breaking a user prompt into JSON sub-tasks assigned to named tool-agents.
- Demonstrate x402 machine-to-machine micro-payments between agents (Agent C pays Agent A for raw data).
- Deliver a polished Next.js frontend with live swarm terminal logs and wallet integration.
- Win the hackathon with a 3-minute live demo.

### Non-Goals (Strictly Out of Scope for MVP)
- Decentralized node network — all agents run on one server.
- Custom or fine-tuned LLMs — OpenAI GPT-4o or Claude Sonnet via API only.
- Dispute resolution or agent failure recovery beyond simple escrow refund.
- User-uploaded custom plugins or agent definitions.
- Multi-tenant agent registry with permissionless onboarding.

---

## 4. Users & Personas

| Persona | Description | Need |
|---|---|---|
| **The Degen Researcher** | Crypto-native user who needs rapid alpha on trending tokens | Fast, automated multi-source reports |
| **The Hackathon Judge** | Technical evaluator watching the live demo | Clear proof of Solana settlement + AI agent coordination |
| **The Protocol Investor** | Evaluating SwarmX as an investable platform primitive | Credible architecture, scalable model |

---

## 5. Functional Requirements

### 5.1 Smart Contract — `swarmx_escrow` (Anchor/Rust, Solana Devnet)

| Instruction | Inputs | Behavior |
|---|---|---|
| `initialize_task` | `task_id: u64`, `amount: u64` | Creates a PDA keyed by `task_id`. Transfers `amount` USDC (SPL token) from user wallet to PDA. Emits `TaskCreated` event. |
| `register_agent` | `agent_pubkey: Pubkey`, `agent_name: String` | Stores agent metadata on-chain. Only pre-approved agents in MVP. |
| `resolve_task` | `task_id: u64`, `payouts: Vec<(Pubkey, u64)>` | Only callable by Orchestrator wallet (the authority). Distributes USDC proportionally to agent wallets. Closes PDA. Emits `TaskResolved` event. |
| `refund_task` | `task_id: u64` | Returns full USDC to user. Callable by Orchestrator on failure. |

**Constraints:**
- USDC mint: Devnet USDC SPL token address.
- PDA seed: `["swarmx", task_id.to_le_bytes()]`.
- All payouts in `resolve_task` must sum to exactly `amount` (enforced in contract).
- Anchor IDL exported and committed to `/anchor/target/idl/swarmx_escrow.json`.

---

### 5.2 Agentic Backend (Node.js/TypeScript)

#### 5.2.1 Orchestrator Agent
- **Model:** Claude Sonnet 4 or GPT-4o via API.
- **System Prompt:** Strict JSON-output instruction to decompose user prompt into an array of `{ task_id, agent_name, description, data_dependencies, estimated_fee_usdc }` objects.
- **Output Contract:**
```json
[
  { "task_id": "A", "agent": "MarketDataAgent", "tool": "dexscreener", "fee": 0.20 },
  { "task_id": "B", "agent": "SentimentAgent", "tool": "twitter_scraper", "fee": 0.30 },
  { "task_id": "C", "agent": "SynthesizerAgent", "tool": "synthesizer", "fee": 0.10, "depends_on": ["A","B"] }
]
```

#### 5.2.2 Tool Agents (Hardcoded MVP Set)

| Agent | Tool | API / Source | Output |
|---|---|---|---|
| `MarketDataAgent` | `dexscreener` | DexScreener REST API | JSON: price, volume, liquidity, 24h change |
| `SentimentAgent` | `twitter_scraper` | Apify Twitter scraper or mock | JSON: tweet count, sentiment score, top keywords |
| `SynthesizerAgent` | `synthesizer` | Internal Claude call | Markdown report combining A + B data |

#### 5.2.3 x402 Payment Middleware (Express Router)
- When `SynthesizerAgent` requests `MarketDataAgent`'s raw JSON output, the request hits the x402 router.
- Router returns `HTTP 402 Payment Required` with a payment header specifying `amount`, `recipient_wallet`, `chain: solana-devnet`.
- `SynthesizerAgent` signs and submits a Solana micro-transaction (0.001–0.01 USDC).
- Router verifies the transaction signature on-chain, then releases the raw data.
- All x402 exchanges logged to a WebSocket broadcast channel for the UI terminal.

#### 5.2.4 WebSocket Log Server
- Broadcasts structured log events: `{ type: "agent_claim" | "x402_challenge" | "x402_paid" | "agent_complete" | "task_resolved", payload: {...} }`.
- Frontend swarm terminal subscribes to `ws://localhost:3001/swarm-logs`.

---

### 5.3 Frontend (Next.js 14 + Tailwind + Solana Wallet Adapter)

#### Pages
| Route | Purpose |
|---|---|
| `/` | Hero/landing page |
| `/app` | Main split-screen dashboard |

#### `/app` Layout — Split Screen
- **Left Panel (60%):** Chat interface. User types prompt → clicks "Deploy Swarm" → sees final Markdown report rendered.
- **Right Panel (40%):** "Swarm Terminal" — live scrolling log feed with agent icons, timestamps, x402 payment badges, and a task DAG visualization.

#### Wallet Flow
1. User connects Phantom/Backpack wallet via `@solana/wallet-adapter-react`.
2. On "Deploy Swarm", frontend calls `initialize_task` instruction via `@coral-xyz/anchor`.
3. User approves transaction in wallet popup.
4. Transaction confirmed → backend picks up `TaskCreated` event and begins orchestration.
5. On final `TaskResolved` event, frontend shows green settlement banner with per-agent payout breakdown.

#### Key UI States
| State | Visual |
|---|---|
| `idle` | Prompt input + "Deploy Swarm" CTA |
| `funding` | Wallet confirmation spinner |
| `swarm_active` | Terminal animating, agent badges pulsing |
| `x402_event` | Red "402 Payment" flash on terminal row |
| `complete` | Report rendered + green settlement card |
| `error` | Red banner + "Escrow refunded" confirmation |

---

## 6. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Demo latency (full run) | < 45 seconds end-to-end |
| Solana tx confirmation | Devnet, ~400ms |
| Agent log streaming latency | < 500ms from event to UI |
| Frontend load time | < 2s |
| Uptime during demo | 100% (single DigitalOcean droplet, no failover needed) |

---

## 7. Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Rust, Anchor Framework, Solana Devnet |
| Token Standard | SPL Token (USDC devnet mint) |
| Backend | Node.js 20, TypeScript, Express, LangChain.js |
| LLM | Anthropic Claude Sonnet 4 / OpenAI GPT-4o |
| x402 Protocol | Custom Express middleware |
| Frontend | Next.js 14, Tailwind CSS, shadcn/ui |
| Wallet | @solana/wallet-adapter-react, Phantom |
| Anchor Client | @coral-xyz/anchor |
| WebSockets | ws (server), native browser WebSocket (client) |
| Data APIs | DexScreener REST, Apify (Twitter), or mocked |
| Deployment | DigitalOcean Droplet (Ubuntu 22.04) |

---

## 8. Data Flow Diagram

```
User Prompt
    │
    ▼
[Frontend] ──sign tx──► [Solana: initialize_task PDA]
    │                           │ TaskCreated event
    ▼                           ▼
[Backend: Orchestrator Agent] ◄──────────────────
    │ JSON task decomposition
    ├──► [MarketDataAgent] ──► DexScreener API ──► raw JSON
    ├──► [SentimentAgent]  ──► Twitter Scraper ──► sentiment JSON
    │
    │   [x402 Router]
    │   SynthesizerAgent ──HTTP GET──► x402 Router ──402──► SynthesizerAgent pays micro-tx
    │                                                 ──► releases raw data
    │
    └──► [SynthesizerAgent] ──► Claude API ──► Markdown Report
    │
    ▼
[Backend: Orchestrator] ──► [Solana: resolve_task] ──► distributes USDC to agent wallets
    │
    ▼
[Frontend] renders report + settlement card
```

---

## 9. Milestones & Build Order

| # | Milestone | Owner | Deliverable |
|---|---|---|---|
| 1 | Anchor program written + deployed to Devnet | Builder 1 | Program ID, IDL JSON |
| 2 | Orchestrator + mocked agents running locally | Builder 2 | Working JSON decomposition |
| 3 | x402 middleware challenge/verify loop working | Builder 3 | HTTP 402 flow logs |
| 4 | Real APIs plugged in (DexScreener + Twitter) | Builder 2 | Live data flowing |
| 5 | Frontend shell + wallet adapter + escrow call | Builder 4 | Funded escrow on Devnet |
| 6 | WebSocket logs streaming to UI terminal | Builder 4 | Live terminal updates |
| 7 | Full end-to-end happy path | All | Demo ready |
| 8 | Polish UI, rehearse 3-min pitch | All | Final build |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Devnet congestion slows demo | Pre-fund escrow before going on stage |
| Twitter API rate limits | Mock Twitter data as fallback |
| LLM orchestration produces invalid JSON | Add strict Zod schema validation + retry |
| Wallet adapter UX confuses judges | Demo with pre-configured Phantom, skip confirmation screen in screen recording fallback |
| x402 micro-tx fails | Hard-code mock x402 exchange in fallback mode |

---

## 11. Success Criteria

- [ ] 1 USDC deposited into escrow on Devnet via UI in < 5 seconds.
- [ ] Orchestrator correctly decomposes prompt into 3 agent tasks.
- [ ] At least 1 x402 machine-to-machine payment visible in terminal logs.
- [ ] Final Markdown report rendered in left panel within 45 seconds.
- [ ] Escrow USDC distributed to 3 agent wallets visible on Solana Explorer.
- [ ] Zero crashes during 3-minute live demo.
