"use client";

type AppState = "idle" | "funding" | "swarm_active" | "complete" | "error";

const STATE_CONFIG: Record<
  AppState,
  { label: string; color: string; bg: string; pulse?: boolean }
> = {
  idle: { label: "Ready", color: "#8888AA", bg: "rgba(136,136,170,0.1)" },
  funding: {
    label: "Funding Escrow",
    color: "#FFB800",
    bg: "rgba(255,184,0,0.1)",
    pulse: true,
  },
  swarm_active: {
    label: "Swarm Active",
    color: "#9945FF",
    bg: "rgba(153,69,255,0.1)",
    pulse: true,
  },
  complete: {
    label: "Complete",
    color: "#14F195",
    bg: "rgba(20,241,149,0.1)",
  },
  error: {
    label: "Error",
    color: "#FF3B5C",
    bg: "rgba(255,59,92,0.1)",
  },
};

export function StatusPill({ state }: { state: AppState }) {
  const config = STATE_CONFIG[state];
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
      style={{
        background: config.bg,
        color: config.color,
        border: `1px solid ${config.color}30`,
      }}
    >
      <span
        className={`w-2 h-2 rounded-full ${config.pulse ? "animate-pulse" : ""}`}
        style={{ background: config.color }}
      />
      {config.label}
    </div>
  );
}
