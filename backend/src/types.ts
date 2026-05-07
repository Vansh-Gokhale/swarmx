export type AgentName = 'Orchestrator' | 'MarketDataAgent' | 'SentimentAgent' | 'SynthesizerAgent';

export type LogEventType =
  | 'task_created'
  | 'orchestrator_decompose'
  | 'agent_claim'
  | 'agent_start'
  | 'x402_challenge'
  | 'x402_paid'
  | 'agent_complete'
  | 'task_resolved'
  | 'task_error'
  | 'browser_action'
  | 'browser_navigate'
  | 'browser_launched'
  | 'report_rendered';

export interface SwarmLogEvent {
  type: LogEventType;
  agent?: AgentName;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface SubTask {
  task_id: string;
  agent: AgentName;
  tool: string;
  description: string;
  query: string;
  fee_usdc: number;
  depends_on?: string[];
}

export interface AgentResult {
  task_id: string;
  agent: AgentName;
  data: unknown;
  fee_usdc: number;
}
