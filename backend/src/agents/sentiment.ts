import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { SwarmLogEvent } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function fetchSentiment(
  description: string,
  query: string,
  broadcast: (e: SwarmLogEvent) => void
): Promise<Record<string, unknown>> {

  broadcast({
    type: 'agent_claim', agent: 'SentimentAgent',
    message: `Claiming sentiment task for 0.30 USDC | query: "${query}"`,
    timestamp: Date.now(),
  });
  broadcast({
    type: 'agent_start', agent: 'SentimentAgent',
    message: `Analyzing social signals for: "${query}"`,
    timestamp: Date.now(),
  });

  let twitterData: unknown[] = [];
  let usedRealData = false;

  if (process.env.APIFY_API_KEY) {
    try {
      const apifyRes = await axios.post(
        `https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items`,
        {
          searchTerms: [query],
          maxItems: 50,
          queryType: 'Latest',
        },
        {
          headers: { Authorization: `Bearer ${process.env.APIFY_API_KEY}` },
          timeout: 15000,
          params: { token: process.env.APIFY_API_KEY },
        }
      );
      if (apifyRes.data?.length > 0) {
        twitterData = apifyRes.data;
        usedRealData = true;
        broadcast({
          type: 'agent_start', agent: 'SentimentAgent',
          message: `Scraped ${twitterData.length} tweets for "${query}"`,
          timestamp: Date.now(),
        });
      }
    } catch {
      broadcast({
        type: 'agent_start', agent: 'SentimentAgent',
        message: 'Twitter API unavailable — running Claude sentiment model...',
        timestamp: Date.now(),
      });
    }
  }

  const analysisPrompt = usedRealData
    ? `Analyze the sentiment from these ${twitterData.length} tweets about "${query}":
${JSON.stringify(twitterData.slice(0, 20), null, 1)}

Return ONLY a JSON object with fields:
- topics: array of strings (what people are talking about)
- tokens: array of objects with { name, symbol, tweet_count (estimate), sentiment_score (0-1), sentiment_label ("bullish"|"bearish"|"neutral"), trending (bool), top_keywords: string[], key_narratives: string[], risk_signals: string[] }
- overall_market_mood: string
- data_source: "twitter_live"
No markdown, no explanation.`
    : `You are a crypto social media analyst. Based on your knowledge of crypto Twitter/X dynamics as of mid-2025, generate a realistic sentiment analysis JSON for the following query: "${query}"

IMPORTANT: The query is: "${query}"
Your analysis must be SPECIFIC to this query. Different queries must produce different results.

Return ONLY a JSON object with these fields:
{
  "query": "${query}",
  "topics": ["topic1", "topic2"],
  "tokens": [
    {
      "name": "token name",
      "symbol": "TICKER",
      "tweet_count": <realistic number>,
      "sentiment_score": <0.0 to 1.0>,
      "sentiment_label": "bullish" | "bearish" | "neutral",
      "trending": true | false,
      "top_keywords": ["keyword1", "keyword2", "keyword3"],
      "key_narratives": ["narrative1", "narrative2"],
      "risk_signals": ["signal1"] or []
    }
  ],
  "overall_market_mood": "description of current mood for this query",
  "community_activity": "low" | "moderate" | "high" | "very_high",
  "data_source": "claude_analysis",
  "analysis_note": "brief note about what drives sentiment for this specific query"
}

Make this UNIQUE and SPECIFIC to "${query}". Do NOT return generic crypto data.
No markdown, no backticks, no explanation.`;

  const sentimentResponse = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: analysisPrompt,
  });

  const raw = sentimentResponse.text ? sentimentResponse.text.trim() : '{}';

  let sentimentData: Record<string, unknown> = {};
  try {
    sentimentData = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    sentimentData = { query, error: 'parse_failed', raw_response: raw.slice(0, 200) };
  }

  sentimentData.query = query;

  broadcast({
    type: 'agent_complete', agent: 'SentimentAgent',
    message: `Sentiment analysis complete for "${query}" | mood: ${sentimentData.overall_market_mood || 'analyzed'} ✓`,
    data: sentimentData,
    timestamp: Date.now(),
  });

  return sentimentData;
}
