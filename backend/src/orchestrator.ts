import { callLLM } from './llm/client';
import { extractJSON, JSON_ENFORCEMENT } from './llm/utils';
import { z } from 'zod';
import { SubTask, SwarmLogEvent, AgentName } from './types';

const SubTaskSchema = z.array(z.object({
  task_id:     z.string(),
  agent:       z.enum(['MarketDataAgent', 'SentimentAgent', 'SynthesizerAgent']),
  tool:        z.string(),
  description: z.string(),
  query:       z.string(),
  fee_usdc:    z.number(),
  depends_on:  z.array(z.string()).optional(),
}));

export type OrchestratorPlan = z.infer<typeof SubTaskSchema>;

const ORCHESTRATOR_SYSTEM = `You are the SwarmX Orchestrator Agent. Your job is to read a user research prompt and produce a JSON execution plan for a swarm of specialized AI agents.

Available agents:
- MarketDataAgent: fetches live token price, volume, liquidity, and market cap from DexScreener. Give it a specific token name or search query.
- SentimentAgent: analyzes social media sentiment and trending signals. Give it specific token names or topics to analyze.
- SynthesizerAgent: combines ALL data from the other agents into a final report. Always depends_on ["A","B"]. Its description must specify the exact report format requested by the user.

Rules:
1. Read the user prompt CAREFULLY. Extract specific token names, topics, or entities mentioned.
2. If the user mentions specific tokens (e.g. "BONK", "WIF", "POPCAT"), the MarketDataAgent query must target THOSE exact tokens.
3. If the user asks for a "risk report", the Synthesizer must produce a risk-focused report.
4. If the user asks for "price comparison", focus on price data.
5. If the user asks about something NOT crypto-related (e.g. "summarize this article", "write me code"), still route it — put the full task in the SynthesizerAgent description and give MarketData/Sentiment minimal tasks.
6. The "query" field is what the agent will literally search for — make it specific and derived from the user's prompt.
7. Always return EXACTLY 3 tasks with task_ids "A", "B", "C".
8. Return ONLY valid JSON. No markdown, no explanation, no backticks.

Example for prompt "analyze BONK and WIF risk":
[
  {"task_id":"A","agent":"MarketDataAgent","tool":"dexscreener","description":"Fetch OHLCV and liquidity data for BONK and WIF on Solana","query":"BONK WIF solana","fee_usdc":0.20},
  {"task_id":"B","agent":"SentimentAgent","tool":"sentiment_scraper","description":"Analyze Twitter/X sentiment and trending score for BONK and WIF","query":"BONK WIF sentiment solana","fee_usdc":0.30},
  {"task_id":"C","agent":"SynthesizerAgent","tool":"synthesizer","description":"Generate a structured risk assessment report for BONK and WIF including volatility, liquidity risk, and social sentiment risk score","query":"","fee_usdc":0.10,"depends_on":["A","B"]}
]
${JSON_ENFORCEMENT}`;

export async function decomposeTask(
  userPrompt: string,
  broadcast: (e: SwarmLogEvent) => void
): Promise<OrchestratorPlan> {
  broadcast({
    type: 'orchestrator_decompose',
    agent: 'Orchestrator',
    message: `Reading prompt: "${userPrompt.slice(0, 80)}${userPrompt.length > 80 ? '...' : ''}"`,
    timestamp: Date.now(),
  });

  const result = await callLLM('orchestrator', [
    { role: 'system', content: ORCHESTRATOR_SYSTEM },
    { role: 'user',   content: userPrompt },
  ], { maxTokens: 800 });

  broadcast({
    type: 'orchestrator_decompose',
    agent: 'Orchestrator',
    message: `[${result.provider.toUpperCase()} · ${result.model} · ${result.latency_ms}ms] Decomposing...`,
    data: { provider: result.provider, model: result.model },
    timestamp: Date.now(),
  });

  const cleaned = extractJSON(result.text);

  let tasks: OrchestratorPlan;
  try {
    tasks = SubTaskSchema.parse(JSON.parse(cleaned));
  } catch {
    // Local models sometimes add commentary — try to extract JSON array
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        tasks = SubTaskSchema.parse(JSON.parse(match[0]));
      } catch {
        // Fallback plan
        tasks = [
          { task_id: 'A', agent: 'MarketDataAgent',  tool: 'dexscreener',      description: `Fetch market data relevant to: ${userPrompt}`, query: userPrompt.slice(0, 100), fee_usdc: 0.20 },
          { task_id: 'B', agent: 'SentimentAgent',   tool: 'sentiment_scraper', description: `Analyze sentiment for: ${userPrompt}`,          query: userPrompt.slice(0, 100), fee_usdc: 0.30 },
          { task_id: 'C', agent: 'SynthesizerAgent', tool: 'synthesizer',       description: `Synthesize a full report for: ${userPrompt}`,   query: '',                       fee_usdc: 0.10, depends_on: ['A', 'B'] },
        ];
      }
    } else {
      console.error('[Orchestrator] JSON parse failed, using fallback plan. Raw:', result.text);
      tasks = [
        { task_id: 'A', agent: 'MarketDataAgent',  tool: 'dexscreener',      description: `Fetch market data relevant to: ${userPrompt}`, query: userPrompt.slice(0, 100), fee_usdc: 0.20 },
        { task_id: 'B', agent: 'SentimentAgent',   tool: 'sentiment_scraper', description: `Analyze sentiment for: ${userPrompt}`,          query: userPrompt.slice(0, 100), fee_usdc: 0.30 },
        { task_id: 'C', agent: 'SynthesizerAgent', tool: 'synthesizer',       description: `Synthesize a full report for: ${userPrompt}`,   query: '',                       fee_usdc: 0.10, depends_on: ['A', 'B'] },
      ];
    }
  }

  broadcast({
    type: 'orchestrator_decompose',
    agent: 'Orchestrator',
    message: `Plan: ${tasks.map(t => `[${t.task_id}] ${t.agent} → "${t.query || t.description.slice(0, 40)}..."`).join(' | ')}`,
    data: { tasks, provider: result.provider, model: result.model },
    timestamp: Date.now(),
  });

  return tasks;
}
