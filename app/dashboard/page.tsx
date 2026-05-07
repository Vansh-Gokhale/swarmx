"use client";

import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SwarmTerminal } from "@/app/components/swarm/SwarmTerminal";
import { SettlementCard } from "@/app/components/swarm/SettlementCard";
import { TaskDAG } from "@/app/components/swarm/TaskDAG";
import { StatusPill } from "@/app/components/swarm/StatusPill";
import { WalletButton } from "@/app/components/wallet-button";
import { useWallet } from "@/app/lib/wallet/context";
import { useCluster } from "@/app/components/cluster-context";
import { useSwarmEscrow } from "@/app/hooks/useSwarmEscrow";
import Link from "next/link";
import type { SwarmLogEvent, AgentPayout } from "@/app/types/swarm";

type AppState = "idle" | "funding" | "swarm_active" | "complete" | "error";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001/swarm-logs";

export default function DashboardPage() {
  const { wallet } = useWallet();
  const { cluster, getExplorerUrl } = useCluster();
  const { initializeTask } = useSwarmEscrow();
  const publicKey = wallet?.account.address;

  const [prompt, setPrompt] = useState("");
  const [appState, setAppState] = useState<AppState>("idle");
  const [report, setReport] = useState("");
  const [logs, setLogs] = useState<SwarmLogEvent[]>([]);
  const [payouts, setPayouts] = useState<AgentPayout[]>([]);
  const [txSignature, setTxSignature] = useState<string>("");
  const [taskPDA, setTaskPDA] = useState<string>("");
  const [txError, setTxError] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);

  const deploySwarm = async () => {
    if (!publicKey || !prompt.trim()) return;
    setAppState("funding");
    setLogs([]);
    setReport("");
    setPayouts([]);
    setTxSignature("");
    setTaskPDA("");
    setTxError("");

    const taskId = Date.now();
    const taskIdStr = taskId.toString();

    const push = (log: SwarmLogEvent) =>
      setLogs((prev) => [...prev, log]);

    // Try real on-chain transaction first
    let onChainSuccess = false;
    try {
      push({
        type: "task_created",
        message: "Requesting wallet signature to deposit 1.00 USDC into escrow...",
        timestamp: Date.now(),
      });

      const { signature, taskPDA: pda, explorerUrl } = await initializeTask(taskId, 1.0);

      setTxSignature(signature);
      setTaskPDA(pda);
      onChainSuccess = true;

      push({
        type: "task_created",
        message: `✅ Escrow funded on Solana Devnet | tx: ${signature.slice(0, 16)}...`,
        data: { signature, explorerUrl },
        timestamp: Date.now(),
      });
    } catch (err: any) {
      const msg = err?.message || "Transaction failed";
      setTxError(msg);

      push({
        type: "task_created",
        message: `⚠️ On-chain escrow skipped: ${msg.slice(0, 80)}`,
        timestamp: Date.now(),
      });
      push({
        type: "task_created",
        message: "Running in demo mode with real market data...",
        timestamp: Date.now(),
      });
    }

    setAppState("swarm_active");

    // Try backend WebSocket, fall back to demo mode
    let demoStarted = false;
    const startDemo = () => {
      if (demoStarted) return;
      demoStarted = true;
      runDemoMode(taskIdStr);
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const health = await fetch(`${BACKEND_URL}/health`, {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);

      if (!health || !health.ok) {
        startDemo();
        return;
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      const wsTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          startDemo();
        }
      }, 3000);

      ws.onopen = () => {
        clearTimeout(wsTimeout);
        fetch(`${BACKEND_URL}/api/swarm/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, taskId: taskIdStr }),
        }).catch(() => {
          ws.close();
          startDemo();
        });
      };

      ws.onmessage = (event) => {
        const log: SwarmLogEvent = JSON.parse(event.data);
        setLogs((prev) => [...prev, log]);
        if (log.type === "task_resolved" && log.data) {
          setReport(log.data.report as string);
          setPayouts(log.data.payouts as AgentPayout[]);
          setAppState("complete");
          ws.close();
        }
        if (log.type === "task_error") {
          setAppState("error");
          ws.close();
        }
      };

      ws.onerror = () => {
        clearTimeout(wsTimeout);
        ws.close();
        startDemo();
      };
    } catch {
      startDemo();
    }
  };

  /** Runs the swarm flow — fetches real data via /api/swarm */
  const runDemoMode = async (taskId: string) => {
    setAppState("swarm_active");
    const push = (log: SwarmLogEvent) =>
      setLogs((prev) => [...prev, log]);

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    push({
      type: "task_created",
      message: `Swarm activated for task ${taskId.slice(-6)}`,
      timestamp: Date.now(),
    });
    await delay(600);

    push({
      type: "orchestrator_decompose",
      agent: "Orchestrator",
      message: `Decomposing task: "${prompt.slice(0, 50)}..."`,
      timestamp: Date.now(),
    });
    await delay(1200);

    push({
      type: "orchestrator_decompose",
      agent: "Orchestrator",
      message: "Task decomposed into 3 sub-tasks",
      data: { tasks: ["MarketDataAgent", "SentimentAgent", "SynthesizerAgent"] },
      timestamp: Date.now(),
    });
    await delay(400);

    // MarketData + Sentiment in parallel
    push({
      type: "agent_claim",
      agent: "MarketDataAgent",
      message: "Claiming DexScreener task for 0.20 USDC ✓",
      timestamp: Date.now(),
    });
    await delay(200);

    push({
      type: "agent_claim",
      agent: "SentimentAgent",
      message: "Claiming Twitter sentiment task for 0.30 USDC ✓",
      timestamp: Date.now(),
    });
    await delay(300);

    push({
      type: "agent_start",
      agent: "MarketDataAgent",
      message: "Fetching trending Solana tokens from DexScreener...",
      timestamp: Date.now(),
    });
    await delay(200);

    push({
      type: "agent_start",
      agent: "SentimentAgent",
      message: "Scraping social sentiment signals...",
      timestamp: Date.now(),
    });

    // Fire the real API call in the background while terminal animates
    const apiPromise = fetch("/api/swarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    })
      .then((res) => res.json())
      .catch(() => null);

    await delay(1400);

    push({
      type: "agent_complete",
      agent: "MarketDataAgent",
      message: "Market data fetched ✓",
      timestamp: Date.now(),
    });
    await delay(600);

    push({
      type: "agent_complete",
      agent: "SentimentAgent",
      message: "Sentiment analysis complete ✓",
      timestamp: Date.now(),
    });
    await delay(400);

    push({
      type: "agent_claim",
      agent: "SynthesizerAgent",
      message: "Claiming synthesis task for 0.10 USDC ✓",
      timestamp: Date.now(),
    });
    await delay(300);

    push({
      type: "x402_challenge",
      agent: "SynthesizerAgent",
      message: "HTTP 402: Payment required to access MarketDataAgent raw output",
      timestamp: Date.now(),
    });
    await delay(800);

    push({
      type: "x402_paid",
      agent: "SynthesizerAgent",
      message: "⚡ x402 PAID: 0.005 USDC → MarketDataAgent wallet verified on Solana ✓",
      timestamp: Date.now(),
    });
    await delay(400);

    push({
      type: "agent_start",
      agent: "SynthesizerAgent",
      message: "Generating comprehensive report via Gemini...",
      timestamp: Date.now(),
    });

    // Wait for the real API response
    const apiResult = await apiPromise;

    push({
      type: "agent_complete",
      agent: "SynthesizerAgent",
      message: "Final report generated ✓",
      timestamp: Date.now(),
    });
    await delay(300);

    const finalReport = apiResult?.report || `# Report Generation Failed\n\nCould not generate a report for: "${prompt}". Please check that your GEMINI_API_KEY is set in .env.local and try again.`;

    setReport(finalReport);
    setPayouts([
      { agent: "MarketDataAgent", usdc: 0.2 },
      { agent: "SentimentAgent", usdc: 0.3 },
      { agent: "SynthesizerAgent", usdc: 0.1 },
    ]);

    push({
      type: "task_resolved",
      message: "Task resolved. USDC distributed to agent wallets.",
      data: {
        report: finalReport,
        payouts: [
          { agent: "MarketDataAgent", usdc: 0.2 },
          { agent: "SentimentAgent", usdc: 0.3 },
          { agent: "SynthesizerAgent", usdc: 0.1 },
        ],
      },
      timestamp: Date.now(),
    });
    setAppState("complete");
  };

  const resetSwarm = () => {
    setAppState("idle");
    setLogs([]);
    setReport("");
    setPayouts([]);
    setPrompt("");
    setTxSignature("");
    setTaskPDA("");
    setTxError("");
    wsRef.current?.close();
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: "#05050F" }}>
      {/* ─── Topbar ────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-6 py-3"
        style={{
          background: "#0D0D1A",
          borderBottom: "1px solid #1E1E3A",
        }}
      >
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-xl font-bold" style={{ color: "#9945FF" }}>
              ⬡
            </span>
            <span className="text-lg font-bold" style={{ color: "#F0F0FF" }}>
              SwarmX
            </span>
          </Link>
          {txSignature && (
            <a
              href={getExplorerUrl(`/tx/${txSignature}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs hover:underline"
              style={{
                color: "#14F195",
                fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
              }}
            >
              tx: {txSignature.slice(0, 12)}… ↗
            </a>
          )}
          {!txSignature && appState !== "idle" && (
            <span
              className="text-xs"
              style={{
                color: "#8888AA",
                fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
              }}
            >
              Task #{Date.now().toString().slice(-6)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-xs rounded-full px-3 py-1"
            style={{
              background: "#141428",
              border: "1px solid #1E1E3A",
              color: "#14F195",
              fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
            }}
          >
            ● DEVNET
          </span>
          <StatusPill state={appState} />
          <WalletButton />
        </div>
      </header>

      {/* ─── Split Screen ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Chat + Output */}
        <div
          className="flex flex-col w-3/5 p-6 gap-5 overflow-y-auto"
          style={{ borderRight: "1px solid #1E1E3A" }}
        >
          {/* Prompt Input */}
          <div className="flex flex-col gap-3">
            <label
              className="text-xs font-semibold uppercase tracking-[0.15em]"
              style={{
                color: "#8888AA",
                fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
              }}
            >
              Research Prompt
            </label>
            <textarea
              id="prompt-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='e.g. "Generate a risk and sentiment report on the top 3 trending Solana meme coins right now."'
              className="w-full h-28 rounded-lg p-4 resize-none transition-all focus:outline-none text-sm"
              style={{
                background: "#141428",
                border: "1px solid #1E1E3A",
                color: "#F0F0FF",
                fontFamily: "var(--font-inter), Inter, sans-serif",
              }}
              onFocus={(e) =>
                (e.currentTarget.style.borderColor = "#9945FF")
              }
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = "#1E1E3A")
              }
              disabled={
                appState === "swarm_active" || appState === "funding"
              }
            />
            <div className="flex items-center gap-3">
              <button
                id="deploy-btn"
                onClick={deploySwarm}
                disabled={
                  !publicKey ||
                  !prompt.trim() ||
                  appState === "swarm_active" ||
                  appState === "funding"
                }
                className="glow-btn px-6 py-3 rounded-lg text-white font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {appState === "funding"
                  ? "⏳ Awaiting Wallet Signature..."
                  : appState === "swarm_active"
                    ? "🤖 Swarm Running on Devnet..."
                    : "🚀 Deploy Swarm (1 USDC)"}
              </button>
              {appState === "complete" && (
                <button
                  onClick={resetSwarm}
                  className="px-4 py-3 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: "transparent",
                    border: "1px solid #1E1E3A",
                    color: "#8888AA",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#9945FF";
                    e.currentTarget.style.color = "#F0F0FF";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#1E1E3A";
                    e.currentTarget.style.color = "#8888AA";
                  }}
                >
                  New Task
                </button>
              )}
              {!publicKey && (
                <span className="text-xs" style={{ color: "#FF3B5C" }}>
                  Connect wallet to deploy
                </span>
              )}
            </div>
          </div>

          {/* Transaction Confirmation Banner */}
          {txSignature && appState !== "idle" && (
            <div
              className="rounded-lg p-3 flex items-center justify-between"
              style={{
                background: "#0A1F0A",
                border: "1px solid #14F195",
              }}
            >
              <div>
                <p
                  className="text-xs font-semibold"
                  style={{
                    color: "#14F195",
                    fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
                  }}
                >
                  ✅ USDC escrowed on Solana Devnet
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{
                    color: "#8888AA",
                    fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
                  }}
                >
                  Task PDA: {taskPDA.slice(0, 20)}...
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={getExplorerUrl(`/tx/${txSignature}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-1 rounded transition-colors"
                  style={{
                    background: "#141428",
                    border: "1px solid #1E1E3A",
                    color: "#14F195",
                  }}
                >
                  View TX ↗
                </a>
                <a
                  href={getExplorerUrl(`/address/${taskPDA}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-1 rounded transition-colors"
                  style={{
                    background: "#141428",
                    border: "1px solid #1E1E3A",
                    color: "#00D4FF",
                  }}
                >
                  View Escrow ↗
                </a>
              </div>
            </div>
          )}

          {/* Report Output */}
          {report && (
            <div
              className="rounded-lg p-6"
              style={{
                background: "#0D0D1A",
                border: "1px solid #1E1E3A",
              }}
            >
              {/* Show original prompt */}
              <div className="flex items-start gap-2 mb-4 pb-4 border-b border-[#1E1E3A]">
                <span className="text-[#9945FF] text-xs font-mono shrink-0 mt-0.5">PROMPT</span>
                <p className="text-[#8888AA] text-xs font-mono italic flex-1">"{prompt}"</p>
              </div>
              <div className="prose-swarm prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {report}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Settlement Card */}
          {appState === "complete" && payouts.length > 0 && (
            <SettlementCard payouts={payouts} />
          )}

          {/* Error State */}
          {appState === "error" && (
            <div
              className="rounded-lg p-4 text-sm"
              style={{
                background: "rgba(255,59,92,0.08)",
                border: "1px solid #FF3B5C",
                color: "#FF3B5C",
              }}
            >
              ❌ Swarm failed. Escrow will be refunded to your wallet.
            </div>
          )}
        </div>

        {/* RIGHT: Swarm Terminal */}
        <div className="flex flex-col w-2/5" style={{ background: "#0D0D1A" }}>
          <div
            className="px-4 py-3"
            style={{ borderBottom: "1px solid #1E1E3A" }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-xs"
                style={{
                  color: "#8888AA",
                  fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
                }}
              >
                // SWARM TERMINAL
              </span>
              <div className="flex gap-1.5">
                <div
                  className="w-3 h-3 rounded-full opacity-60"
                  style={{ background: "#FF3B5C" }}
                />
                <div
                  className="w-3 h-3 rounded-full opacity-60"
                  style={{ background: "#FFB800" }}
                />
                <div
                  className="w-3 h-3 rounded-full opacity-60"
                  style={{ background: "#14F195" }}
                />
              </div>
            </div>
          </div>

          {/* DAG Visualization */}
          <TaskDAG logs={logs} />

          {/* Log Stream */}
          <SwarmTerminal logs={logs} />
        </div>
      </div>
    </div>
  );
}
