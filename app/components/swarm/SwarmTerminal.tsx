"use client";

import { useEffect, useRef, Fragment } from "react";
import { SwarmLogEvent } from "@/app/types/swarm";

const AGENT_COLORS: Record<string, { bg: string; text: string }> = {
  Orchestrator: { bg: "#9945FF", text: "#FFFFFF" },
  MarketDataAgent: { bg: "#00D4FF", text: "#000000" },
  SentimentAgent: { bg: "#FFB800", text: "#000000" },
  SynthesizerAgent: { bg: "#14F195", text: "#000000" },
};

function agentBadgeLabel(agent: string): string {
  return agent.replace("Agent", "").toUpperCase();
}

export function SwarmTerminal({ logs }: { logs: SwarmLogEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="flex-1 overflow-y-auto terminal-scroll p-4 space-y-1" style={{ fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace" }}>
      {logs.length === 0 && (
        <div className="text-center mt-8" style={{ color: "#8888AA" }}>
          <div className="text-3xl mb-3">⬡</div>
          <p className="text-sm">Deploy a swarm to see live agent logs...</p>
        </div>
      )}
      {logs.map((log, i) => (
        <Fragment key={i}>
          <div
            className={`flex items-start gap-2 py-1.5 px-2 rounded transition-all ${
              log.type === "x402_paid" ? "x402-flash" : ""
            }`}
            style={
              log.type === "x402_challenge"
                ? { borderLeft: "2px solid #FF3B5C" }
                : undefined
            }
          >
            {/* Timestamp */}
            <span
              className="text-[10px] mt-0.5 shrink-0 tabular-nums"
              style={{ color: "#555" }}
            >
              {new Date(log.timestamp).toISOString().slice(11, 19)}
            </span>

            {/* Agent badge */}
            {log.agent && (
              <span
                className="text-[10px] px-2 py-0.5 rounded font-semibold shrink-0"
                style={{
                  background: AGENT_COLORS[log.agent]?.bg || "#1E1E3A",
                  color: AGENT_COLORS[log.agent]?.text || "#F0F0FF",
                }}
              >
                {agentBadgeLabel(log.agent)}
              </span>
            )}

            {/* 402 badge */}
            {log.type === "x402_paid" && (
              <span
                className="text-[10px] px-2 py-0.5 rounded font-semibold shrink-0"
                style={{ background: "#FF3B5C", color: "#FFFFFF" }}
              >
                ⚡ 402
              </span>
            )}

            {/* Message */}
            <span
              className="text-xs leading-relaxed"
              style={{
                color:
                  log.type === "task_resolved"
                    ? "#14F195"
                    : log.type === "task_error"
                      ? "#FF3B5C"
                      : log.type === "x402_paid"
                        ? "#00D4FF"
                        : "#CCCCDD",
              }}
            >
              {log.message}
            </span>
          </div>
          {/* Show task decomposition for orchestrator events */}
          {log.type === 'orchestrator_decompose' && Array.isArray(log.data?.tasks) ? (
            <div className="mt-1 ml-16 space-y-0.5">
              {(log.data!.tasks as any[]).map((t: any) => (
                <div key={t.task_id} className="text-[#555577] text-[10px] font-mono">
                  [{t.task_id}] {t.agent} → "{t.query || t.description.slice(0, 50)}"
                </div>
              ))}
            </div>
          ) : null}
        </Fragment>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
