"use client";

import { useMemo } from "react";
import { SwarmLogEvent } from "@/app/types/swarm";

const NODES = [
  { id: "orch", label: "ORCH", x: 50, y: 30 },
  { id: "market", label: "MARKET", x: 20, y: 100 },
  { id: "sent", label: "SENT", x: 80, y: 100 },
  { id: "synth", label: "SYNTH", x: 50, y: 170 },
];

const EDGES = [
  { from: "orch", to: "market" },
  { from: "orch", to: "sent" },
  { from: "market", to: "synth" },
  { from: "sent", to: "synth" },
];

type NodeState = "idle" | "active" | "complete";

export function TaskDAG({ logs }: { logs: SwarmLogEvent[] }) {
  const nodeStates = useMemo<Record<string, NodeState>>(() => {
    const states: Record<string, NodeState> = {};
    logs.forEach((log) => {
      if (!log.agent) return;
      const id =
        log.agent === "Orchestrator"
          ? "orch"
          : log.agent === "MarketDataAgent"
            ? "market"
            : log.agent === "SentimentAgent"
              ? "sent"
              : "synth";
      if (
        log.type === "agent_complete" ||
        log.type === "task_resolved" ||
        log.type === "orchestrator_decompose"
      ) {
        states[id] = "complete";
      } else if (log.type === "agent_claim" || log.type === "agent_start") {
        if (states[id] !== "complete") states[id] = "active";
      }
    });
    return states;
  }, [logs]);

  const nodeColor = (id: string) => {
    const s = nodeStates[id] || "idle";
    return s === "complete" ? "#14F195" : s === "active" ? "#FFB800" : "#1E1E3A";
  };

  const nodeGlow = (id: string) => {
    const s = nodeStates[id] || "idle";
    if (s === "active")
      return "drop-shadow(0 0 6px rgba(255,184,0,0.5))";
    if (s === "complete")
      return "drop-shadow(0 0 6px rgba(20,241,149,0.4))";
    return "none";
  };

  return (
    <div
      className="px-4 py-3"
      style={{ borderBottom: "1px solid #1E1E3A" }}
    >
      <svg viewBox="0 0 100 200" className="w-full" style={{ height: 80 }}>
        {/* Edges */}
        {EDGES.map((e) => {
          const from = NODES.find((n) => n.id === e.from)!;
          const to = NODES.find((n) => n.id === e.to)!;
          const edgeActive =
            nodeStates[e.from] === "complete" || nodeStates[e.from] === "active";
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={edgeActive ? "#9945FF" : "#1E1E3A"}
              strokeWidth="1"
              strokeDasharray={edgeActive ? "none" : "4 2"}
              style={{ transition: "stroke 0.3s" }}
            />
          );
        })}
        {/* Nodes */}
        {NODES.map((n) => (
          <g key={n.id} style={{ filter: nodeGlow(n.id) }}>
            <circle
              cx={n.x}
              cy={n.y}
              r="14"
              fill={nodeColor(n.id)}
              style={{ transition: "fill 0.3s" }}
            />
            <text
              x={n.x}
              y={n.y + 4}
              textAnchor="middle"
              fontSize="5"
              fill="#05050F"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight="600"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
