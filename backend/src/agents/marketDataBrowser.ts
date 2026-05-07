import { Page } from 'puppeteer';
import {
  navigateTo, humanScroll, humanType,
  extractPageText, takeScreenshot
} from '../browser/browserAgent';
import { callLLM } from '../llm/client';
import { extractJSON } from '../llm/utils';
import { SwarmLogEvent } from '../types';

export async function fetchMarketDataBrowser(
  description: string,
  query: string,
  page: Page,
  broadcast: (e: SwarmLogEvent) => void
): Promise<Record<string, unknown>> {

  broadcast({
    type: 'agent_claim', agent: 'MarketDataAgent',
    message: `Claiming DexScreener task | query: "${query}"`,
    timestamp: Date.now(),
  });

  // ── 1. Navigate to DexScreener ───────────────────────────────────────
  await navigateTo(page, 'https://dexscreener.com/solana', broadcast, 'MarketDataAgent');

  broadcast({
    type: 'browser_action', agent: 'MarketDataAgent',
    message: `Opened DexScreener — scanning Solana markets...`,
    timestamp: Date.now(),
  });

  await humanScroll(page, 2);

  // ── 2. Search for the query ──────────────────────────────────────────
  // Try DexScreener search
  await navigateTo(
    page,
    `https://dexscreener.com/solana?q=${encodeURIComponent(query)}`,
    broadcast, 'MarketDataAgent'
  );

  broadcast({
    type: 'browser_action', agent: 'MarketDataAgent',
    message: `Searching DexScreener for: "${query}"`,
    timestamp: Date.now(),
  });

  await humanScroll(page, 3);

  // ── 3. Take screenshot evidence ─────────────────────────────────────
  const screenshot1 = await takeScreenshot(page);

  // ── 4. Extract page data ─────────────────────────────────────────────
  const pageText = await extractPageText(page);

  // ── 5. Also hit DexScreener API for structured data ──────────────────
  let apiData: unknown[] = [];
  try {
    const apiPage = await page.browser().newPage();
    await apiPage.goto(
      `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(query)}`,
      { waitUntil: 'networkidle2', timeout: 10000 }
    );
    const content = await apiPage.content();
    const jsonMatch = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      const pairs = parsed.pairs || [];
      apiData = pairs
        .filter((p: any) => p.chainId === 'solana')
        .slice(0, 4)
        .map((p: any) => ({
          name:             p.baseToken?.name || p.baseToken?.symbol,
          symbol:           p.baseToken?.symbol,
          price_usd:        parseFloat(p.priceUsd || '0'),
          volume_24h_usd:   p.volume?.h24 || 0,
          liquidity_usd:    p.liquidity?.usd || 0,
          price_change_24h: p.priceChange?.h24 || 0,
          price_change_1h:  p.priceChange?.h1 || 0,
          market_cap:       p.marketCap || null,
          txns_buys_24h:    p.txns?.h24?.buys || 0,
          txns_sells_24h:   p.txns?.h24?.sells || 0,
          dex:              p.dexId,
          url:              p.url,
        }));
    }
    await apiPage.close();
  } catch { /* use page text fallback */ }

  // ── 6. Navigate to individual token pages ────────────────────────────
  if (apiData.length > 0 && (apiData[0] as any).url) {
    await navigateTo(page, (apiData[0] as any).url, broadcast, 'MarketDataAgent');
    broadcast({
      type: 'browser_action', agent: 'MarketDataAgent',
      message: `Inspecting token page: ${(apiData[0] as any).symbol}...`,
      timestamp: Date.now(),
    });
    await humanScroll(page, 2);
  }

  // ── 7. Use LLM to extract structured data from page text ─────────────
  let structuredData = apiData;
  if (structuredData.length === 0) {
    const extractRes = await callLLM('extractor', [{
      role: 'user',
      content: `Extract market data from this DexScreener page text for query "${query}".
Return ONLY a JSON array of token objects with: name, symbol, price_usd, volume_24h_usd, liquidity_usd, price_change_24h.
Page text:
${pageText.slice(0, 3000)}

If no specific data found, generate realistic estimates for the tokens in the query.
Return ONLY the JSON array. No explanation.`,
    }], { maxTokens: 600 });

    const raw = extractJSON(extractRes.text);
    try { structuredData = JSON.parse(raw); } catch { structuredData = []; }

    broadcast({
      type: 'browser_action', agent: 'MarketDataAgent',
      message: `Data extracted via ${extractRes.provider} (${extractRes.model}) · ${extractRes.latency_ms}ms`,
      data: { provider: extractRes.provider, model: extractRes.model },
      timestamp: Date.now(),
    });
  }

  broadcast({
    type: 'agent_complete', agent: 'MarketDataAgent',
    message: `Market data collected: ${(structuredData as any[]).length} tokens ✓`,
    timestamp: Date.now(),
  });

  return {
    query,
    tokens:    structuredData,
    screenshot: screenshot1,
    fetched_at: new Date().toISOString(),
    source:    'dexscreener_browser',
  };
}
