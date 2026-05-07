"use client";

import { motion } from "framer-motion";

interface Payout {
  agent: string;
  usdc: number;
}

export function SettlementCard({ payouts }: { payouts: Payout[] }) {
  const total = payouts.reduce((sum, p) => sum + p.usdc, 0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-xl p-6"
      style={{
        background: "#141428",
        border: "1px solid #14F195",
        boxShadow: "0 0 20px rgba(20,241,149,0.15)",
      }}
    >
      <div className="flex items-center gap-2 mb-5">
        <span className="text-lg">✅</span>
        <h3 className="font-semibold" style={{ color: "#F0F0FF" }}>
          Task Resolved · Solana Devnet
        </h3>
      </div>
      <div className="space-y-3">
        {payouts.map((p) => (
          <div key={p.agent} className="flex items-center justify-between">
            <span
              className="text-sm"
              style={{
                color: "#8888AA",
                fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
              }}
            >
              {p.agent}
            </span>
            <span
              className="text-sm font-semibold"
              style={{
                color: "#14F195",
                fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
              }}
            >
              {p.usdc.toFixed(2)} USDC →
            </span>
          </div>
        ))}
      </div>
      <div
        className="flex items-center justify-between mt-4 pt-4"
        style={{ borderTop: "1px solid #1E1E3A" }}
      >
        <span
          className="text-xs uppercase tracking-wider"
          style={{ color: "#8888AA" }}
        >
          Total Distributed
        </span>
        <span
          className="text-base font-bold"
          style={{
            color: "#14F195",
            fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
          }}
        >
          {total.toFixed(2)} USDC
        </span>
      </div>
      <p
        className="text-xs mt-3"
        style={{ color: "#555" }}
      >
        USDC distributed atomically via swarmx_escrow program
      </p>
    </motion.div>
  );
}
