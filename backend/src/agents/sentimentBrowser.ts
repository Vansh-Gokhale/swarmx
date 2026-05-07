import { Page } from 'puppeteer';
import {
  navigateTo, humanScroll, humanType,
  extractPageText, takeScreenshot
} from '../browser/browserAgent';
import { callLLM } from '../llm/client';
import { extractJSON } from '../llm/utils';
import { SwarmLogEvent } from '../types';

export async function fetchSentimentBrowser(
  description: string,
  query: string,
  page: Page,
  broadcast: (e: SwarmLogEvent) => void
): Promise<Record<string, unknown>> {

  broadcast({
    type: 'agent_claim', agent: 'SentimentAgent',
    message: `Claiming sentiment task | query: "${query}"`,
    timestamp: Date.now(),
  });

  const screenshotEvidence: string[] = [];
  let allPageText = '';

  // ── 1. Check crypto Twitter via nitter / search ─────────────────────
  try {
    await navigateTo(
      page,
      `https://twitter.com/search?q=${encodeURIComponent(query + ' solana')}&src=typed_query&f=live`,
      broadcast, 'SentimentAgent'
    );
    broadcast({
      type: 'browser_action', agent: 'SentimentAgent',
      message: `Scanning Twitter/X for: "${query}"...`,
      timestamp: Date.now(),
    });
    await humanScroll(page, 4);
    screenshotEvidence.push(await takeScreenshot(page));
    allPageText += await extractPageText(page);
  } catch {
    // Twitter blocks headless — fall through to alternatives
  }

  // ── 2. Check CoinGecko for community data ───────────────────────────
  const tokenSlug = query.toLowerCase().replace(/\s+/g, '-').split(' ')[0];
  try {
    await navigateTo(
      page,
      `https://www.coingecko.com/en/coins/${tokenSlug}`,
      broadcast, 'SentimentAgent'
    );
    broadcast({
      type: 'browser_action', agent: 'SentimentAgent',
      message: `Checking CoinGecko community data...`,
      timestamp: Date.now(),
    });
    await humanScroll(page, 3);
    screenshotEvidence.push(await takeScreenshot(page));
    allPageText += '\n\n' + await extractPageText(page);
  } catch {}

  // ── 3. Check Crypto Twitter trends on CryptoPanic ───────────────────
  try {
    await navigateTo(
      page,
      `https://cryptopanic.com/news/${tokenSlug}/`,
      broadcast, 'SentimentAgent'
    );
    broadcast({
      type: 'browser_action', agent: 'SentimentAgent',
      message: `Reading crypto news sentiment on CryptoPanic...`,
      timestamp: Date.now(),
    });
    await humanScroll(page, 2);
    screenshotEvidence.push(await takeScreenshot(page));
    allPageText += '\n\n' + await extractPageText(page);
  } catch {}

  // ── 4. LLM analyzes everything collected ────────────────────────────
  broadcast({
    type: 'agent_start', agent: 'SentimentAgent',
    message: `Analyzing sentiment signals across sources...`,
    timestamp: Date.now(),
  });

  const analysisPrompt = `You are a crypto sentiment analyst. Analyze sentiment for: "${query}"

DATA COLLECTED FROM BROWSER:
${allPageText.slice(0, 5000) || 'No page data collected — use your knowledge.'}

Return ONLY a JSON object:
{
  "query": "${query}",
  "tokens": [
    {
      "name": "token name",
      "symbol": "TICKER",
      "sentiment_score": <0.0-1.0>,
      "sentiment_label": "bullish" | "bearish" | "neutral",
      "trending": true | false,
      "social_volume": "low" | "medium" | "high",
      "top_keywords": ["kw1","kw2","kw3"],
      "key_narratives": ["narrative1","narrative2"],
      "risk_signals": ["signal1"] or [],
      "news_sentiment": "positive" | "negative" | "mixed"
    }
  ],
  "overall_market_mood": "one sentence summary",
  "community_activity": "low" | "moderate" | "high",
  "sources_checked": ["dexscreener","twitter","coingecko","cryptopanic"],
  "data_freshness": "real-time browser scrape"
}
No markdown. No backticks. ONLY JSON specific to "${query}".`;

  const analysisRes = await callLLM('sentiment', [{
    role: 'user',
    content: analysisPrompt,
  }], { maxTokens: 900 });

  const raw = extractJSON(analysisRes.text);
  let sentimentData: Record<string, unknown> = {};
  try {
    sentimentData = JSON.parse(raw);
  } catch {
    sentimentData = { query, error: 'parse_failed' };
  }

  sentimentData.screenshots = screenshotEvidence;

  broadcast({
    type: 'agent_complete', agent: 'SentimentAgent',
    message: `Sentiment complete via ${analysisRes.provider} (${analysisRes.model}) · ${analysisRes.latency_ms}ms | mood: ${sentimentData.overall_market_mood || 'analyzed'} ✓`,
    data: { provider: analysisRes.provider, model: analysisRes.model },
    timestamp: Date.now(),
  });

  return sentimentData;
}
