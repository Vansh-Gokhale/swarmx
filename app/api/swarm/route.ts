import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

// ── Fetch real market data from DexScreener ───────────────────────────
// Detect which chain the user is asking about
function detectChain(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  if (lower.includes("ethereum") || lower.includes("eth ") || lower.includes("erc20")) return "ethereum";
  if (lower.includes("solana") || lower.includes("sol ")) return "solana";
  if (lower.includes("base")) return "base";
  if (lower.includes("arbitrum") || lower.includes("arb")) return "arbitrum";
  if (lower.includes("bsc") || lower.includes("bnb") || lower.includes("binance")) return "bsc";
  if (lower.includes("polygon") || lower.includes("matic")) return "polygon";
  if (lower.includes("avalanche") || lower.includes("avax")) return "avalanche";
  return null; // any chain
}

async function fetchMarketData(query: string) {
  try {
    const chain = detectChain(query);
    const searchTerm = extractSearchTerm(query);
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(searchTerm)}`,
      { next: { revalidate: 0 } }
    );
    const data = await res.json();
    let pairs = data?.pairs || [];

    // Filter by chain if detected
    if (chain) {
      const chainFiltered = pairs.filter((p: any) => p.chainId === chain);
      if (chainFiltered.length > 0) pairs = chainFiltered;
    }
    pairs = pairs.slice(0, 5);

    if (pairs.length === 0) {
      // Fallback: broader search
      const fallbackTerm = chain || "SOL";
      const fallback = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${fallbackTerm}`,
        { next: { revalidate: 0 } }
      );
      const fbData = await fallback.json();
      let fbPairs = fbData?.pairs || [];
      if (chain) fbPairs = fbPairs.filter((p: any) => p.chainId === chain);
      return formatPairs(fbPairs.slice(0, 5));
    }
    return formatPairs(pairs);
  } catch {
    return null;
  }
}

function extractSearchTerm(prompt: string): string {
  // Try to extract specific token names from the prompt
  const tokenPatterns =
    /\b(SOL|BONK|WIF|POPCAT|JUP|PYTH|RAY|ORCA|MANGO|JTO|TRUMP|MELANIA|RENDER|HNT|MOBILE|ETH|PEPE|SHIB|DOGE|UNI|AAVE|LINK|ARB|OP|MATIC|AVAX|BNB|APE|FLOKI|BRETT|MOG|TURBO|NEIRO)\b/gi;
  const matches = prompt.match(tokenPatterns);
  if (matches && matches.length > 0) {
    return matches.slice(0, 3).join(" ");
  }
  // Fallback to general search terms from the prompt
  const keywords = prompt
    .replace(
      /generate|report|risk|sentiment|analysis|analyze|top|trending|meme|coin|coins|token|tokens|on|the|a|an|of|for|and|solana|ethereum|best|performing|right|now|please|give|me/gi,
      ""
    )
    .trim();
  return keywords || "trending crypto";
}

function formatPairs(pairs: any[]) {
  return pairs.map((p: any) => ({
    name: p.baseToken?.symbol || "UNKNOWN",
    fullName: p.baseToken?.name || "",
    price_usd: p.priceUsd || "N/A",
    volume_24h: p.volume?.h24 || 0,
    liquidity_usd: p.liquidity?.usd || 0,
    price_change_5m: p.priceChange?.m5 || 0,
    price_change_1h: p.priceChange?.h1 || 0,
    price_change_6h: p.priceChange?.h6 || 0,
    price_change_24h: p.priceChange?.h24 || 0,
    dex: p.dexId || "unknown",
    pair_address: p.pairAddress || "",
    fdv: p.fdv || 0,
    txns_24h_buys: p.txns?.h24?.buys || 0,
    txns_24h_sells: p.txns?.h24?.sells || 0,
  }));
}

// ── Simulated sentiment data ─────────────────────────────────────────
function generateSentimentData(tokens: any[]) {
  return tokens.map((t: any) => {
    // Derive sentiment from price action
    const change = t.price_change_24h || 0;
    const buyRatio =
      t.txns_24h_buys + t.txns_24h_sells > 0
        ? t.txns_24h_buys / (t.txns_24h_buys + t.txns_24h_sells)
        : 0.5;
    const score = Math.min(1, Math.max(0, 0.5 + change / 100 + (buyRatio - 0.5) * 0.5));

    return {
      name: t.name,
      sentiment_score: parseFloat(score.toFixed(2)),
      buy_sell_ratio: parseFloat(buyRatio.toFixed(2)),
      txn_count_24h: t.txns_24h_buys + t.txns_24h_sells,
      trending: Math.abs(change) > 5,
      signal: score > 0.65 ? "Bullish" : score < 0.4 ? "Bearish" : "Neutral",
    };
  });
}

// ── Main handler ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "prompt required" }, { status: 400 });
    }

    // Step 1: Fetch real market data
    const marketData = await fetchMarketData(prompt);

    // Step 2: Generate sentiment from market signals
    const sentimentData = marketData ? generateSentimentData(marketData) : null;

    // Step 3: Try Gemini, fall back to local report on any failure
    let report: string;

    if (GEMINI_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

        const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: `You are an expert crypto market analyst working for SwarmX, a decentralized AI research platform.

USER REQUEST: ${prompt}

LIVE MARKET DATA (from DexScreener API — real-time):
${JSON.stringify(marketData, null, 2)}

SENTIMENT SIGNALS (derived from on-chain transaction patterns):
${JSON.stringify(sentimentData, null, 2)}

Generate a comprehensive, professional Markdown report. Requirements:
1. **Executive Summary** — 2-3 sentences summarizing the key findings specific to the user's query
2. **Per-Token Analysis** — Table with: Token, Price, 24h Vol, 24h Change, Sentiment Score, Risk Rating (1-10)
3. **Detailed Analysis** — For each token: price action, volume trends, buy/sell ratio, key observations
4. **Risk Assessment** — Specific risks with severity ratings
5. **Conclusion & Recommendation** — Actionable insights

Rules:
- Use the ACTUAL data provided, not made-up numbers
- Be specific and data-driven
- Format numbers nicely (e.g., $12.5M not 12500000)
- Risk ratings should be justified by the data
- Keep it concise but thorough
- DO NOT add disclaimers about "not financial advice" — this is a research tool`,
          config: {
            maxOutputTokens: 2000,
            temperature: 0.7,
          },
        });

        report = response.text || generateLocalReport(prompt, marketData, sentimentData);
      } catch (geminiErr) {
        console.warn("Gemini API failed, using local report:", geminiErr);
        report = generateLocalReport(prompt, marketData, sentimentData);
      }
    } else {
      report = generateLocalReport(prompt, marketData, sentimentData);
    }

    return NextResponse.json({
      report,
      marketData,
      sentimentData,
    });
  } catch (err) {
    console.error("Swarm API error:", err);
    return NextResponse.json(
      { error: "Failed to generate report", details: String(err) },
      { status: 500 }
    );
  }
}

// ── Fallback report (no API key) ──────────────────────────────────────
function generateLocalReport(
  prompt: string,
  marketData: any[] | null,
  sentimentData: any[] | null
): string {
  if (!marketData || marketData.length === 0) {
    return `# Research Report\n\n## No Data Available\n\nCould not fetch market data for your query: "${prompt}". Please try again with specific token names (e.g., BONK, WIF, SOL).`;
  }

  let report = `# Solana Market Research Report\n\n`;
  report += `## Executive Summary\n\n`;
  report += `Analysis of ${marketData.length} tokens matching your query: *"${prompt}"*. `;

  const bullish = sentimentData?.filter((s) => s.signal === "Bullish").length || 0;
  const bearish = sentimentData?.filter((s) => s.signal === "Bearish").length || 0;
  report += `Overall sentiment: **${bullish} bullish, ${bearish} bearish, ${marketData.length - bullish - bearish} neutral**.\n\n`;

  report += `## Per-Token Analysis\n\n`;
  report += `| Token | Price | 24h Volume | 24h Change | Sentiment | Risk |\n`;
  report += `|-------|-------|-----------|-----------|-----------|------|\n`;

  marketData.forEach((t, i) => {
    const sent = sentimentData?.[i];
    const vol =
      t.volume_24h >= 1e6
        ? `$${(t.volume_24h / 1e6).toFixed(1)}M`
        : `$${(t.volume_24h / 1e3).toFixed(1)}K`;
    const change = `${t.price_change_24h >= 0 ? "+" : ""}${t.price_change_24h}%`;
    const risk = sent
      ? Math.min(10, Math.max(1, Math.round(10 - sent.sentiment_score * 8 - (t.liquidity_usd > 1e6 ? 2 : 0))))
      : 5;
    report += `| ${t.name} | $${t.price_usd} | ${vol} | ${change} | ${sent?.signal || "N/A"} (${sent?.sentiment_score || "?"}) | ${risk}/10 |\n`;
  });

  report += `\n## Detailed Analysis\n\n`;
  marketData.forEach((t, i) => {
    const sent = sentimentData?.[i];
    report += `### ${t.name} (${t.fullName})\n`;
    report += `- **Price:** $${t.price_usd} | **DEX:** ${t.dex}\n`;
    report += `- **24h Volume:** $${(t.volume_24h / 1e6).toFixed(2)}M | **Liquidity:** $${(t.liquidity_usd / 1e6).toFixed(2)}M\n`;
    report += `- **Price Changes:** 5m: ${t.price_change_5m}% | 1h: ${t.price_change_1h}% | 6h: ${t.price_change_6h}% | 24h: ${t.price_change_24h}%\n`;
    report += `- **Transactions (24h):** ${t.txns_24h_buys} buys / ${t.txns_24h_sells} sells (ratio: ${sent?.buy_sell_ratio || "N/A"})\n`;
    report += `- **Sentiment:** ${sent?.signal || "N/A"} (score: ${sent?.sentiment_score || "?"})\n\n`;
  });

  report += `## Risk Assessment\n\n`;
  const lowLiq = marketData.filter((t) => t.liquidity_usd < 500000);
  if (lowLiq.length > 0) {
    report += `⚠️ **Low Liquidity Warning:** ${lowLiq.map((t) => t.name).join(", ")} have < $500K liquidity\n\n`;
  }
  const highVol = marketData.filter((t) => Math.abs(t.price_change_24h) > 20);
  if (highVol.length > 0) {
    report += `⚠️ **High Volatility:** ${highVol.map((t) => `${t.name} (${t.price_change_24h}%)`).join(", ")}\n\n`;
  }

  report += `\n## Conclusion\n\n`;
  report += `*Report generated by SwarmX Agent Swarm — Live data from DexScreener API*\n`;

  return report;
}
