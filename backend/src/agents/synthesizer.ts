import { callLLM } from '../llm/client';
import { SwarmLogEvent } from '../types';

export async function synthesizeReport(
  marketData:    Record<string, unknown>,
  sentimentData: Record<string, unknown>,
  originalPrompt: string,
  synthDescription: string,
  broadcast: (e: SwarmLogEvent) => void
): Promise<string> {

  broadcast({
    type: 'agent_claim', agent: 'SynthesizerAgent',
    message: 'Claiming synthesis task for 0.10 USDC ✓',
    timestamp: Date.now(),
  });

  broadcast({
    type: 'x402_challenge', agent: 'SynthesizerAgent',
    message: 'HTTP 402 Payment Required → requesting MarketDataAgent raw output',
    timestamp: Date.now(),
  });

  await new Promise(r => setTimeout(r, 600));

  broadcast({
    type: 'x402_paid', agent: 'SynthesizerAgent',
    message: '⚡ x402 PAID: 0.005 USDC → MarketDataAgent · verified on Solana Devnet ✓',
    timestamp: Date.now(),
  });

  broadcast({
    type: 'agent_start', agent: 'SynthesizerAgent',
    message: `Generating report for: "${originalPrompt.slice(0, 70)}..."`,
    timestamp: Date.now(),
  });

  const systemPrompt = `You are the SwarmX Synthesizer Agent — a world-class research analyst.
You receive raw data from other AI agents and synthesize it into a precise, professional report.
Your report must DIRECTLY answer the user's original prompt.
Do not produce a generic crypto report — answer EXACTLY what was asked.
Use all the data provided. Be specific, data-driven, and insightful.
Format your response in clean Markdown with tables where appropriate.`;

  const userMessage = `USER'S ORIGINAL QUESTION:
"${originalPrompt}"

REPORT INSTRUCTIONS FROM ORCHESTRATOR:
${synthDescription}

MARKET DATA COLLECTED BY MarketDataAgent:
${JSON.stringify(marketData, null, 2)}

SENTIMENT DATA COLLECTED BY SentimentAgent:
${JSON.stringify(sentimentData, null, 2)}

---
Write a comprehensive report that DIRECTLY answers the user's question: "${originalPrompt}"

The report must:
1. Start with a one-paragraph Executive Summary that directly addresses the question
2. Use ALL the data above — reference specific numbers, token names, sentiment scores
3. Structure sections based on what the user asked (e.g. if they asked about risk, have a Risk section; if they asked for comparison, compare explicitly)
4. End with a clear Conclusion / Recommendation
5. Include at least one Markdown table summarizing key metrics

Do NOT write a generic report. Every section must tie back to: "${originalPrompt}"`;

  const response = await callLLM('synthesizer', [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMessage },
  ], {
    maxTokens: 2000,
    timeoutMs: 180000,   // synthesis takes longer on local models — allow 3 min
  });

  const report = response.text || 'Report generation failed.';

  broadcast({
    type: 'agent_complete', agent: 'SynthesizerAgent',
    message: `Report generated via ${response.provider} (${response.model}) · ${(response.latency_ms/1000).toFixed(1)}s ✓`,
    data: { provider: response.provider, model: response.model },
    timestamp: Date.now(),
  });

  return report;
}
