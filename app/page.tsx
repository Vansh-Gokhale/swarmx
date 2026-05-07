'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from './lib/wallet/context';
import { WalletButton } from './components/wallet-button';
import { motion, AnimatePresence } from 'framer-motion';
import { useSwarmEscrow } from './hooks/useSwarmEscrow';

// ── Types ────────────────────────────────────────────────────────────────────

interface SwarmLogEvent {
  type: string;
  agent?: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

interface Payout { agent: string; usdc: number; }

type AppState = 'idle' | 'funding' | 'swarm_active' | 'complete' | 'error';

type NodeId = 'orchestrator' | 'market' | 'sentiment' | 'synthesizer';
type NodeState = 'idle' | 'thinking' | 'active' | 'complete' | 'error';

interface SwarmNode {
  id: NodeId;
  label: string;
  sublabel: string;
  color: string;
  glowColor: string;
  x: number;
  y: number;
}

// ── Node Graph Config ────────────────────────────────────────────────────────

const NODES: SwarmNode[] = [
  {
    id: 'orchestrator',
    label: 'ORCH',
    sublabel: 'Orchestrator',
    color: '#9945FF',
    glowColor: 'rgba(153,69,255,0.5)',
    x: 50, y: 18,
  },
  {
    id: 'market',
    label: 'MKTD',
    sublabel: 'Market Data',
    color: '#00D4FF',
    glowColor: 'rgba(0,212,255,0.5)',
    x: 18, y: 58,
  },
  {
    id: 'sentiment',
    label: 'SENT',
    sublabel: 'Sentiment',
    color: '#FFB800',
    glowColor: 'rgba(255,184,0,0.5)',
    x: 82, y: 58,
  },
  {
    id: 'synthesizer',
    label: 'SYNTH',
    sublabel: 'Synthesizer',
    color: '#14F195',
    glowColor: 'rgba(20,241,149,0.5)',
    x: 50, y: 85,
  },
];

const EDGES = [
  { from: 'orchestrator', to: 'market' },
  { from: 'orchestrator', to: 'sentiment' },
  { from: 'market',       to: 'synthesizer' },
  { from: 'sentiment',    to: 'synthesizer' },
];

// Map agent name strings → node IDs
function agentToNodeId(agent: string): NodeId | null {
  if (agent.includes('Orchestrat')) return 'orchestrator';
  if (agent.includes('Market'))     return 'market';
  if (agent.includes('Sentiment'))  return 'sentiment';
  if (agent.includes('Synthes'))    return 'synthesizer';
  return null;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function AppPage() {
  const { wallet, status } = useWallet();
  const publicKey = wallet?.account.address;
  const connected = status === 'connected';
  const { initializeTask } = useSwarmEscrow();

  const [prompt,    setPrompt]    = useState('');
  const [appState,  setAppState]  = useState<AppState>('idle');
  const [logs,      setLogs]      = useState<SwarmLogEvent[]>([]);
  const [payouts,   setPayouts]   = useState<Payout[]>([]);
  const [txSig,     setTxSig]     = useState('');
  const [taskPDA,   setTaskPDA]   = useState('');
  const [errorMsg,  setErrorMsg]  = useState('');
  const [report,    setReport]    = useState('');
  const [nodeStates, setNodeStates] = useState<Record<NodeId, NodeState>>({
    orchestrator: 'idle',
    market: 'idle',
    sentiment: 'idle',
    synthesizer: 'idle',
  });

  // LLM mode status
  const [llmMode, setLlmMode] = useState<'ollama' | 'gemini' | 'checking'>('checking');

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3009'}/health`)
      .then(r => r.json())
      .then(d => setLlmMode(d.llm?.primary || 'gemini'))
      .catch(() => setLlmMode('gemini'));
  }, []);

  // Browser stream state
  const [browserFrame,   setBrowserFrame]   = useState<string>('');
  const [browserVisible, setBrowserVisible] = useState(false);
  const [showReport,     setShowReport]     = useState(false);

  // Data packets animating along edges
  const [packets, setPackets] = useState<Array<{ id: number; from: NodeId; to: NodeId; progress: number }>>([]);
  const packetIdRef = useRef(0);

  const wsLogsRef   = useRef<WebSocket | null>(null);
  const wsScreenRef = useRef<WebSocket | null>(null);
  const logsEndRef  = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Animate data packets along edges
  const spawnPacket = useCallback((from: NodeId, to: NodeId) => {
    const id = ++packetIdRef.current;
    setPackets(p => [...p, { id, from, to, progress: 0 }]);
    let prog = 0;
    const iv = setInterval(() => {
      prog += 0.025;
      setPackets(p => p.map(pk => pk.id === id ? { ...pk, progress: prog } : pk));
      if (prog >= 1) {
        clearInterval(iv);
        setPackets(p => p.filter(pk => pk.id !== id));
      }
    }, 16);
  }, []);

  // Handle log events → update node states and spawn packets
  const handleLogEvent = useCallback((event: SwarmLogEvent) => {
    setLogs(prev => [...prev, event]);

    if (event.agent) {
      const nodeId = agentToNodeId(event.agent);
      if (nodeId) {
        setNodeStates(prev => ({
          ...prev,
          [nodeId]:
            event.type === 'agent_complete' || event.type === 'report_rendered' ? 'complete' :
            event.type === 'task_error' ? 'error' :
            event.type === 'agent_claim' || event.type === 'agent_start' ||
            event.type === 'browser_action' || event.type === 'browser_navigate' ? 'active' :
            event.type === 'orchestrator_decompose' ? 'thinking' :
            prev[nodeId],
        }));

        // Spawn packets when agents communicate
        if (event.type === 'agent_claim') {
          spawnPacket('orchestrator', nodeId);
        }
        if (event.type === 'x402_challenge' || event.type === 'x402_paid') {
          spawnPacket('market',    'synthesizer');
          spawnPacket('sentiment', 'synthesizer');
        }
        if (event.type === 'agent_complete' && nodeId !== 'synthesizer') {
          spawnPacket(nodeId, 'synthesizer');
        }
      }
    }

    if (event.type === 'task_created') {
      setNodeStates({ orchestrator: 'thinking', market: 'idle', sentiment: 'idle', synthesizer: 'idle' });
    }

    if (event.type === 'browser_launched') {
      setBrowserVisible(true);
      setShowReport(false);
    }

    if (event.type === 'report_rendered') {
      setShowReport(true);
    }

    if (event.type === 'task_resolved') {
      const data = event.data as any;
      setReport(data?.report || '');
      setPayouts(data?.payouts || []);
      setNodeStates({ orchestrator: 'complete', market: 'complete', sentiment: 'complete', synthesizer: 'complete' });
      setAppState('complete');
      // Close screen feed
      wsScreenRef.current?.close();
    }

    if (event.type === 'task_error') {
      setErrorMsg(event.message);
      setAppState('error');
      wsScreenRef.current?.close();
    }
  }, [spawnPacket]);

  // ── Deploy Swarm ───────────────────────────────────────────────────────────

  const deploySwarm = async () => {
    if (!publicKey || !prompt.trim()) return;
    setAppState('funding');
    setLogs([]);
    setReport('');
    setPayouts([]);
    setErrorMsg('');
    setTxSig('');
    setTaskPDA('');
    setBrowserFrame('');
    setBrowserVisible(false);
    setShowReport(false);
    setNodeStates({ orchestrator: 'idle', market: 'idle', sentiment: 'idle', synthesizer: 'idle' });

    const taskId = Date.now();

    try {
      // Fund escrow on Solana Devnet
      const { signature, taskPDA: pda } = await initializeTask(taskId, 1.0);
      setTxSig(signature);
      setTaskPDA(pda);
      setAppState('swarm_active');

      // Connect log WebSocket
      const wsLogs = new WebSocket(
        `${process.env.NEXT_PUBLIC_BACKEND_WS_URL || 'ws://localhost:3001'}/swarm-logs`
      );
      wsLogsRef.current = wsLogs;
      wsLogs.onmessage = e => {
        try { handleLogEvent(JSON.parse(e.data)); } catch {}
      };
      wsLogs.onerror = () => { setErrorMsg('WebSocket error'); setAppState('error'); };

      // Connect screen feed WebSocket
      const wsScreen = new WebSocket(
        `${process.env.NEXT_PUBLIC_BACKEND_WS_URL || 'ws://localhost:3001'}/screen-feed`
      );
      wsScreenRef.current = wsScreen;
      wsScreen.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'frame') setBrowserFrame(`data:image/jpeg;base64,${msg.data}`);
        } catch {}
      };

      // Trigger backend execution
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
      await fetch(`${backendUrl}/api/swarm/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, taskId: taskId.toString(), userWallet: publicKey.toString() }),
      });

    } catch (err: any) {
      setErrorMsg(err?.message || 'Unknown error');
      setAppState('error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') deploySwarm();
  };

  const isRunning = appState === 'swarm_active' || appState === 'funding';
  const canDeploy = connected && prompt.trim() && !isRunning;

  return (
    <div className="flex flex-col h-screen bg-[#03030A] text-[#F0F0FF] overflow-hidden">

      {/* ── TOPBAR ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#12122A] bg-[#05050F] z-20 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-[#9945FF] font-bold text-lg tracking-tight">⬡ SwarmX</span>
          {txSig && (
            <>
              <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                target="_blank" rel="noopener noreferrer"
                className="font-mono text-[10px] text-[#14F195] hover:underline">
                INIT TX: {txSig.slice(0,10)}... ↗
              </a>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#0A1A0A] border border-[#14F19533] px-3 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#14F195] animate-pulse" />
            <span className="text-[#14F195] font-mono text-[10px]">DEVNET</span>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-mono
            ${llmMode === 'ollama'
              ? 'bg-[#0A1A0A] border-[#14F19533] text-[#14F195]'
              : 'bg-[#1A0A2E] border-[#9945FF33] text-[#9945FF]'
            }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${llmMode === 'ollama' ? 'bg-[#14F195]' : 'bg-[#9945FF]'}`} />
            {llmMode === 'ollama' ? '⚡ LOCAL LLM' : '☁ CLOUD LLM'}
          </div>
          <WalletButton />
        </div>
      </header>

      {/* ── MAIN SPLIT ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ────────── LEFT: NODE GRAPH ─────────────────────────────────── */}
        <div className="w-[42%] flex flex-col border-r border-[#12122A] shrink-0">
          {/* Graph fills most of the left panel */}
          <div className="flex-1 relative min-h-0">
            <SwarmNodeGraph
              nodes={NODES}
              edges={EDGES}
              nodeStates={nodeStates}
              packets={packets}
              appState={appState}
            />
          </div>

          {/* Log strip at bottom of left panel */}
          <div className="h-48 border-t border-[#12122A] bg-[#05050F] flex flex-col">
            <div className="px-4 py-2 border-b border-[#12122A] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
              <span className="text-[#333366] text-[10px] font-mono uppercase tracking-widest">Agent Comms</span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5
              [&::-webkit-scrollbar]:w-[3px]
              [&::-webkit-scrollbar-thumb]:bg-[#9945FF44]">
              {logs.length === 0 && (
                <p className="text-[#222244] text-[11px] font-mono mt-4 text-center">
                  Awaiting swarm activation...
                </p>
              )}
              {logs.map((log, i) => (
                <LogLine key={i} log={log} />
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        {/* ────────── RIGHT: BROWSER / REPORT ─────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Browser viewport OR idle state */}
          <div className="flex-1 relative overflow-hidden bg-[#03030A]">
            <AnimatePresence mode="wait">

              {/* IDLE — prompt entry state */}
              {appState === 'idle' && (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-12"
                >
                  <div className="text-center mb-4">
                    <h1 className="text-3xl font-bold text-[#F0F0FF] mb-2">
                      Deploy an Agent Swarm
                    </h1>
                    <p className="text-[#555577] text-sm">
                      Agents will take control of a browser, collect real data, and synthesize a report.
                    </p>
                  </div>
                  {!connected && (
                    <div className="w-full max-w-lg bg-[#1A0A2E] border border-[#9945FF44] rounded-lg p-3 text-center text-xs text-[#9945FF]">
                      Connect your Phantom wallet (Devnet) to deploy
                    </div>
                  )}
                  <ExamplePrompts onSelect={p => setPrompt(p)} />
                </motion.div>
              )}

              {/* FUNDING — waiting for wallet sig */}
              {appState === 'funding' && (
                <motion.div
                  key="funding"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4"
                >
                  <div className="w-16 h-16 rounded-full border-2 border-[#9945FF] border-t-transparent animate-spin" />
                  <p className="text-[#9945FF] font-semibold">Waiting for wallet signature...</p>
                  <p className="text-[#555577] text-xs">Approve the transaction in Phantom</p>
                </motion.div>
              )}

              {/* BROWSER STREAM — live agent browsing */}
              {(appState === 'swarm_active' || appState === 'complete') && !showReport && (
                <motion.div
                  key="browser"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col"
                >
                  {/* Browser chrome bar */}
                  <div className="flex items-center gap-2 px-4 py-2 bg-[#0D0D1A] border-b border-[#1E1E3A] shrink-0">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-[#FF3B5C66]" />
                      <div className="w-3 h-3 rounded-full bg-[#FFB80066]" />
                      <div className="w-3 h-3 rounded-full bg-[#14F19566]" />
                    </div>
                    <div className="flex-1 bg-[#141428] rounded px-3 py-1 text-[10px] font-mono text-[#555577] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#14F195] animate-pulse shrink-0" />
                      <span>Agent-controlled browser — Solana Devnet</span>
                    </div>
                    <span className="text-[10px] font-mono text-[#333355] bg-[#FF3B5C22] px-2 py-0.5 rounded">
                      🤖 AGENT ACTIVE
                    </span>
                  </div>
                  {/* Live frame */}
                  <div className="flex-1 relative bg-[#08080F]">
                    {browserFrame ? (
                      <img
                        src={browserFrame}
                        alt="Agent browser"
                        className="w-full h-full object-contain"
                        style={{ imageRendering: 'crisp-edges' }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                          <div className="w-8 h-8 border-2 border-[#9945FF] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                          <p className="text-[#333355] font-mono text-xs">Launching browser agent...</p>
                        </div>
                      </div>
                    )}
                    {/* Agent HUD overlay */}
                    <AgentHud logs={logs} />
                  </div>
                </motion.div>
              )}

              {/* REPORT VIEW — final rendered report */}
              {showReport && report && (
                <motion.div
                  key="report"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 overflow-y-auto
                    [&::-webkit-scrollbar]:w-1
                    [&::-webkit-scrollbar-thumb]:bg-[#9945FF44]"
                >
                  <ReportView
                    report={report}
                    prompt={prompt}
                    payouts={payouts}
                    txSig={txSig}
                    taskPDA={taskPDA}
                    onReset={() => {
                      setAppState('idle');
                      setReport('');
                      setShowReport(false);
                      setBrowserFrame('');
                      setLogs([]);
                      setPrompt('');
                      setNodeStates({ orchestrator:'idle', market:'idle', sentiment:'idle', synthesizer:'idle' });
                    }}
                  />
                </motion.div>
              )}

              {/* ERROR */}
              {appState === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4"
                >
                  <div className="text-4xl">⚠️</div>
                  <p className="text-[#FF3B5C] font-semibold">Swarm Failed</p>
                  <p className="text-[#FF8888] text-sm font-mono max-w-sm text-center">{errorMsg}</p>
                  <button
                    onClick={() => { setAppState('idle'); setLogs([]); setErrorMsg(''); }}
                    className="px-4 py-2 border border-[#FF3B5C] text-[#FF3B5C] rounded-lg text-sm hover:bg-[#FF3B5C22] transition-colors"
                  >
                    Try Again
                  </button>
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {/* ── PROMPT BAR ─────────────────────────────────────────────── */}
          <div className="border-t border-[#12122A] bg-[#05050F] px-4 py-3 shrink-0">
            <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 transition-all duration-200
              ${isRunning
                ? 'border-[#9945FF66] bg-[#0D0D1A]'
                : 'border-[#1E1E3A] bg-[#0D0D1A] focus-within:border-[#9945FF]'
              }`}>
              <span className="text-[#9945FF] text-lg shrink-0">⬡</span>
              <input
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="What do you want to research? (⌘↵ to deploy)"
                disabled={isRunning}
                className="flex-1 bg-transparent text-[#F0F0FF] text-sm placeholder-[#333355]
                           outline-none disabled:opacity-50 font-sans"
              />
              {isRunning && (
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-4 h-4 border-2 border-[#9945FF] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[#9945FF] text-xs font-mono">RUNNING</span>
                </div>
              )}
              {!isRunning && (
                <button
                  onClick={deploySwarm}
                  disabled={!canDeploy}
                  className="shrink-0 px-4 py-1.5 bg-[#9945FF] text-white text-xs font-semibold
                             rounded-lg disabled:opacity-30 hover:bg-[#7B2FFF]
                             transition-colors hover:shadow-[0_0_16px_rgba(153,69,255,0.4)]"
                >
                  Deploy ⌘↵
                </button>
              )}
            </div>
            {appState === 'swarm_active' && (
              <p className="text-[#333355] text-[10px] font-mono mt-2 text-center">
                Agents are browsing the web — watching live above ↑
              </p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── SwarmNodeGraph ────────────────────────────────────────────────────────────
// The BIG cinematic node graph. Fills the entire left panel.

function SwarmNodeGraph({
  nodes, edges, nodeStates, packets, appState,
}: {
  nodes: SwarmNode[];
  edges: typeof EDGES;
  nodeStates: Record<NodeId, NodeState>;
  packets: Array<{ id: number; from: NodeId; to: NodeId; progress: number }>;
  appState: AppState;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);

  const getNode = (id: string) => nodes.find(n => n.id === id)!;

  // Convert percentage coords to SVG viewBox coords (0-100)
  const px = (pct: number) => pct;
  const py = (pct: number) => pct;

  // Interpolate packet position along edge
  function getPacketPos(from: NodeId, to: NodeId, progress: number) {
    const f = getNode(from);
    const t = getNode(to);
    return {
      x: f.x + (t.x - f.x) * progress,
      y: f.y + (t.y - f.y) * progress,
    };
  }

  const nodeRadius = 8; // in viewBox units

  return (
    <div ref={canvasRef} className="w-full h-full relative bg-[#03030A]">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(#1E1E3A 1px, transparent 1px), linear-gradient(90deg, #1E1E3A 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Radial glow in center when active */}
      {appState === 'swarm_active' && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 50% 50%, rgba(153,69,255,0.08) 0%, transparent 70%)',
          }}
        />
      )}

      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Glow filters per node color */}
          {nodes.map(n => (
            <filter key={n.id} id={`glow-${n.id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          ))}
          <filter id="glow-edge" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.3" />
          </filter>
          {/* Packet glow */}
          <filter id="glow-packet">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.0" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ── Edges ─────────────────────────────────────────────────── */}
        {edges.map(e => {
          const f = getNode(e.from);
          const t = getNode(e.to);
          const isActive =
            nodeStates[e.from as NodeId] === 'active' ||
            nodeStates[e.from as NodeId] === 'complete';
          return (
            <g key={`${e.from}-${e.to}`}>
              {/* Base edge */}
              <line
                x1={px(f.x)} y1={py(f.y)}
                x2={px(t.x)} y2={py(t.y)}
                stroke={isActive ? f.color : '#1A1A33'}
                strokeWidth={isActive ? '0.4' : '0.3'}
                strokeOpacity={isActive ? '0.6' : '1'}
                strokeDasharray={isActive ? 'none' : '1 1'}
              />
              {/* Glow copy when active */}
              {isActive && (
                <line
                  x1={px(f.x)} y1={py(f.y)}
                  x2={px(t.x)} y2={py(t.y)}
                  stroke={f.color}
                  strokeWidth="0.8"
                  strokeOpacity="0.15"
                  filter="url(#glow-edge)"
                />
              )}
            </g>
          );
        })}

        {/* ── Data Packets ──────────────────────────────────────────── */}
        {packets.map(pk => {
          const pos = getPacketPos(pk.from, pk.to, pk.progress);
          const fromNode = getNode(pk.from);
          return (
            <g key={pk.id} filter="url(#glow-packet)">
              <circle
                cx={px(pos.x)} cy={py(pos.y)} r="0.9"
                fill={fromNode.color}
                opacity={0.9}
              />
              <circle
                cx={px(pos.x)} cy={py(pos.y)} r="1.8"
                fill={fromNode.color}
                opacity={0.15}
              />
            </g>
          );
        })}

        {/* ── Nodes ─────────────────────────────────────────────────── */}
        {nodes.map(n => {
          const state = nodeStates[n.id];
          const isActive   = state === 'active' || state === 'thinking';
          const isComplete = state === 'complete';
          const isError    = state === 'error';

          const fillColor  = isError ? '#FF3B5C' : isComplete ? n.color : isActive ? n.color : '#0D0D1A';
          const ringColor  = isError ? '#FF3B5C' : n.color;

          return (
            <g key={n.id}>
              {/* Outer glow ring — pulses when active */}
              {(isActive || isComplete) && (
                <>
                  <circle
                    cx={px(n.x)} cy={py(n.y)}
                    r={nodeRadius + 3}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="0.5"
                    opacity={isActive ? '0.3' : '0.15'}
                  />
                  <circle
                    cx={px(n.x)} cy={py(n.y)}
                    r={nodeRadius + 5}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="0.3"
                    opacity={isActive ? '0.12' : '0.06'}
                  />
                </>
              )}

              {/* Main node circle */}
              <circle
                cx={px(n.x)} cy={py(n.y)}
                r={nodeRadius}
                fill={fillColor}
                fillOpacity={isActive || isComplete ? '1' : '0.9'}
                stroke={ringColor}
                strokeWidth={isActive ? '0.8' : '0.5'}
                filter={isActive || isComplete ? `url(#glow-${n.id})` : undefined}
              />

              {/* Inner dot when idle */}
              {state === 'idle' && (
                <circle cx={px(n.x)} cy={py(n.y)} r="2" fill={n.color} opacity="0.4" />
              )}

              {/* Checkmark when complete */}
              {isComplete && (
                <text
                  x={px(n.x)} y={py(n.y) + 2}
                  textAnchor="middle"
                  fontSize="6"
                  fill={n.id === 'synthesizer' ? '#03030A' : '#03030A'}
                  fontWeight="bold"
                >
                  ✓
                </text>
              )}

              {/* Label inside node */}
              {!isComplete && (
                <text
                  x={px(n.x)} y={py(n.y) + 1.5}
                  textAnchor="middle"
                  fontSize="3.2"
                  fontFamily="JetBrains Mono, monospace"
                  fill={isActive ? '#03030A' : n.color}
                  fontWeight="600"
                  opacity={isActive ? '1' : '0.8'}
                >
                  {n.label}
                </text>
              )}

              {/* Sub-label BELOW node */}
              <text
                x={px(n.x)} y={py(n.y) + nodeRadius + 4}
                textAnchor="middle"
                fontSize="2.8"
                fontFamily="Inter, sans-serif"
                fill={isActive || isComplete ? n.color : '#333355'}
              >
                {n.sublabel}
              </text>

              {/* Status line under sublabel */}
              <text
                x={px(n.x)} y={py(n.y) + nodeRadius + 7}
                textAnchor="middle"
                fontSize="2.2"
                fontFamily="JetBrains Mono, monospace"
                fill={
                  isError    ? '#FF3B5C' :
                  isComplete ? '#14F195' :
                  isActive   ? '#FFB800' : '#222244'
                }
              >
                {isError ? 'ERROR' : isComplete ? 'DONE' : isActive ? 'RUNNING' : 'STANDBY'}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Corner label */}
      <div className="absolute top-3 left-4 text-[#1A1A44] text-[9px] font-mono tracking-widest uppercase">
        Swarm Graph
      </div>
      {appState === 'swarm_active' && (
        <div className="absolute top-3 right-4 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF] animate-pulse" />
          <span className="text-[#9945FF] text-[9px] font-mono">ACTIVE</span>
        </div>
      )}
    </div>
  );
}

// ── Agent HUD overlay on browser viewport ─────────────────────────────────────

function AgentHud({ logs }: { logs: SwarmLogEvent[] }) {
  const lastLog = logs.filter(l => l.type === 'browser_action' || l.type === 'browser_navigate').slice(-1)[0];
  if (!lastLog) return null;

  const agentColors: Record<string, string> = {
    MarketDataAgent:  '#00D4FF',
    SentimentAgent:   '#FFB800',
    SynthesizerAgent: '#14F195',
    Orchestrator:     '#9945FF',
  };
  const color = lastLog.agent ? agentColors[lastLog.agent] || '#9945FF' : '#9945FF';

  return (
    <div className="absolute bottom-3 left-3 right-3 pointer-events-none">
      <div
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono"
        style={{
          background: 'rgba(3,3,10,0.85)',
          border: `1px solid ${color}44`,
          backdropFilter: 'blur(4px)',
        }}
      >
        <span style={{ color }} className="shrink-0">
          {lastLog.agent?.replace('Agent','').toUpperCase() || 'AGENT'}
        </span>
        <span className="text-[#8888AA] truncate">{lastLog.message}</span>
      </div>
    </div>
  );
}

// ── Single log line ──────────────────────────────────────────────────────────

function LogLine({ log }: { log: SwarmLogEvent }) {
  const AGENT_COLORS: Record<string, string> = {
    Orchestrator:     '#9945FF',
    MarketDataAgent:  '#00D4FF',
    SentimentAgent:   '#FFB800',
    SynthesizerAgent: '#14F195',
  };
  const textColor =
    log.type === 'task_resolved'  ? '#14F195' :
    log.type === 'task_error'     ? '#FF3B5C' :
    log.type === 'x402_paid'      ? '#00D4FF' :
    '#8888AA';

  return (
    <div className="flex items-start gap-1.5 py-0.5">
      <span className="text-[#222244] text-[9px] shrink-0 mt-0.5 font-mono">
        {new Date(log.timestamp).toTimeString().slice(0,8)}
      </span>
      {log.agent && (
        <span
          className="text-[9px] font-mono shrink-0 mt-0.5"
          style={{ color: AGENT_COLORS[log.agent] || '#9945FF' }}
        >
          [{log.agent.replace('Agent','').toUpperCase()}]
        </span>
      )}
      {typeof log.data?.provider === 'string' && (
        <span className={`text-[9px] font-mono shrink-0 mt-0.5 px-1.5 rounded
          ${log.data.provider === 'ollama'
            ? 'text-[#14F195] bg-[#14F19510]'
            : 'text-[#9945FF] bg-[#9945FF10]'
          }`}>
          {log.data.provider === 'ollama'
            ? `⚡ LOCAL:${String(log.data.model).split(':')[0]}`
            : '☁ CLOUD'}
        </span>
      )}
      {log.type === 'x402_paid' && (
        <span className="text-[9px] text-[#FF3B5C] shrink-0 mt-0.5">⚡</span>
      )}
      <span className={`text-[10px] font-mono leading-relaxed break-all`} style={{ color: textColor }}>
        {log.message}
      </span>
    </div>
  );
}

// ── Example prompts ──────────────────────────────────────────────────────────

const EXAMPLES = [
  'Generate a risk and sentiment report on the top 3 trending Solana meme coins',
  'Compare BONK vs WIF — which is a better trade right now?',
  'What is the current market sentiment for Solana DeFi tokens?',
  'Analyze POPCAT risk profile and social momentum',
];

function ExamplePrompts({ onSelect }: { onSelect: (p: string) => void }) {
  return (
    <div className="w-full max-w-lg">
      <p className="text-[#333355] text-xs font-mono mb-3 text-center">Example prompts</p>
      <div className="grid grid-cols-1 gap-2">
        {EXAMPLES.map(ex => (
          <button
            key={ex}
            onClick={() => onSelect(ex)}
            className="text-left px-4 py-2.5 bg-[#0D0D1A] border border-[#1E1E3A]
                       rounded-lg text-[#555577] text-xs hover:border-[#9945FF44]
                       hover:text-[#9945FF] transition-all font-mono"
          >
            "{ex}"
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Report View ───────────────────────────────────────────────────────────────

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function ReportView({
  report, prompt, payouts, txSig, taskPDA, onReset,
}: {
  report: string; prompt: string; payouts: Payout[];
  txSig: string; taskPDA: string; onReset: () => void;
}) {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-mono text-[#9945FF] bg-[#9945FF15] border border-[#9945FF33] px-2 py-0.5 rounded-full">
              ⬡ SwarmX Report
            </span>
            <span className="text-[10px] font-mono text-[#14F195] bg-[#14F19510] border border-[#14F19533] px-2 py-0.5 rounded-full">
              ✅ On-chain Settled
            </span>
          </div>
          <p className="text-[#555577] text-xs font-mono italic">"{prompt}"</p>
        </div>
        <button
          onClick={onReset}
          className="shrink-0 text-[11px] font-mono text-[#333355] hover:text-[#9945FF] transition-colors"
        >
          New Task ↩
        </button>
      </div>

      {/* Report content */}
      <div className="prose prose-invert prose-sm max-w-none mb-8
                      prose-headings:text-[#F0F0FF] prose-h2:border-l-2 prose-h2:border-[#9945FF] prose-h2:pl-3
                      prose-p:text-[#C0C0D0] prose-strong:text-[#14F195]
                      prose-code:text-[#00D4FF] prose-table:text-xs
                      prose-th:text-[#9945FF] prose-th:bg-[#141428]
                      prose-td:text-[#C0C0D0] prose-td:border-[#1E1E3A]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
      </div>

      {/* Settlement card */}
      {payouts.length > 0 && (
        <div className="bg-[#0A1A0A] border border-[#14F19533] rounded-xl p-5 mb-4">
          <p className="text-[#14F195] text-xs font-mono font-semibold mb-3">
            ✅ USDC Distributed · Solana Devnet
          </p>
          <div className="space-y-2 mb-3">
            {payouts.map(p => (
              <div key={p.agent} className="flex justify-between">
                <span className="text-[#555577] font-mono text-xs">{p.agent}</span>
                <span className="text-[#14F195] font-mono text-xs">{p.usdc.toFixed(2)} USDC</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            {txSig && (
              <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-mono text-[#9945FF] hover:underline">
                Init TX ↗
              </a>
            )}
            {taskPDA && (
              <a href={`https://explorer.solana.com/address/${taskPDA}?cluster=devnet`}
                target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-mono text-[#00D4FF] hover:underline">
                Escrow PDA ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
