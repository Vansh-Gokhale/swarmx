import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

// ── Config ───────────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const USE_LOCAL_LLM   = process.env.USE_LOCAL_LLM !== 'false'; // default: true

// Model routing — different tasks use different models
const MODELS = {
  // Local Ollama models
  local: {
    orchestrator: process.env.LOCAL_MODEL_ORCHESTRATOR || 'qwen3.5:latest',
    sentiment:    process.env.LOCAL_MODEL_SENTIMENT    || 'qwen3.5:latest',
    synthesizer:  process.env.LOCAL_MODEL_SYNTHESIZER  || 'qwen3.5:latest',
    extractor:    process.env.LOCAL_MODEL_EXTRACTOR    || 'qwen3.5:latest',
    fallback:     process.env.LOCAL_MODEL_FALLBACK     || 'qwen3.5:latest',
  },
  // Gemini fallback model (free tier / existing API key)
  gemini: {
    default: 'gemini-2.5-flash-lite',
  },
};

// ── Shared types ─────────────────────────────────────────────────────────────

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  text: string;
  model: string;
  provider: 'ollama' | 'gemini';
  latency_ms: number;
}

// ── Ollama client (OpenAI-compatible) ────────────────────────────────────────

/**
 * Call Ollama's OpenAI-compatible chat endpoint
 */
async function callOllama(
  model: string,
  messages: LLMMessage[],
  maxTokens = 1000,
  timeoutMs = 60000
): Promise<LLMResponse> {
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        max_tokens:  maxTokens,
        temperature: 0.1,          // low temp for structured JSON output
        stream:      false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    if (!text) throw new Error('Ollama returned empty response');

    return {
      text,
      model,
      provider:   'ollama',
      latency_ms: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Gemini client (cloud fallback — free tier) ───────────────────────────────

/**
 * Call Google Gemini API as the cloud fallback.
 * Uses the existing GEMINI_API_KEY which has free-tier access.
 */
async function callGemini(
  messages: LLMMessage[],
  maxTokens = 1000
): Promise<LLMResponse> {
  const start = Date.now();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Separate system instruction from conversation messages
  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs  = messages.filter(m => m.role !== 'system');

  // Build a single user prompt from the remaining messages
  const userContent = userMsgs.map(m => m.content).join('\n\n');

  const response = await ai.models.generateContent({
    model: MODELS.gemini.default,
    contents: userContent,
    config: {
      systemInstruction: systemMsg?.content,
    },
  });

  const text = response.text ?? '';

  return {
    text,
    model:      MODELS.gemini.default,
    provider:   'gemini',
    latency_ms: Date.now() - start,
  };
}

// ── Main exported function — smart router with fallback ───────────────────────

export type LLMTask = 'orchestrator' | 'sentiment' | 'synthesizer' | 'extractor';

export async function callLLM(
  task: LLMTask,
  messages: LLMMessage[],
  options: {
    maxTokens?:    number;
    forceCloud?:   boolean;   // bypass local for this call
    timeoutMs?:    number;
  } = {}
): Promise<LLMResponse> {
  const { maxTokens = 1000, forceCloud = false, timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '90000') } = options;

  // Force cloud (e.g. for high-stakes synthesis on demo day)
  if (forceCloud || !USE_LOCAL_LLM) {
    console.log(`[LLM] Using Gemini (forced) for task: ${task}`);
    return callGemini(messages, maxTokens);
  }

  // Try local Ollama first
  const localModel = MODELS.local[task] || MODELS.local.fallback;

  try {
    console.log(`[LLM] Trying Ollama model "${localModel}" for task: ${task}`);
    const result = await callOllama(localModel, messages, maxTokens, timeoutMs);
    console.log(`[LLM] Ollama success | task: ${task} | ${result.latency_ms}ms`);
    return result;
  } catch (ollamaErr) {
    console.warn(`[LLM] Ollama failed for "${localModel}": ${(ollamaErr as Error).message}`);

    // Try the fast fallback local model before going to cloud
    if (localModel !== MODELS.local.fallback) {
      try {
        console.log(`[LLM] Trying fallback local model: ${MODELS.local.fallback}`);
        const fallback = await callOllama(
          MODELS.local.fallback, messages, maxTokens, 30000
        );
        console.log(`[LLM] Fallback local model succeeded | ${fallback.latency_ms}ms`);
        return fallback;
      } catch (fallbackErr) {
        console.warn(`[LLM] Fallback local also failed: ${(fallbackErr as Error).message}`);
      }
    }

    // Last resort: Gemini API (free tier)
    if (process.env.GEMINI_API_KEY) {
      console.log(`[LLM] Falling back to Gemini API for task: ${task}`);
      return callGemini(messages, maxTokens);
    }

    throw new Error(
      `All LLM providers failed for task "${task}". ` +
      `Ollama error: ${(ollamaErr as Error).message}. ` +
      `No GEMINI_API_KEY set for fallback.`
    );
  }
}

/**
 * Check if Ollama is running and which models are available
 */
export async function checkOllamaHealth(): Promise<{
  running: boolean;
  models: string[];
  recommended_missing: string[];
}> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false, models: [], recommended_missing: [] };

    const data = await res.json();
    const models: string[] = (data.models || []).map((m: any) => m.name);
    const recommended = Object.values(MODELS.local);
    const recommended_missing = [...new Set(recommended)].filter(
      m => !models.some(installed => installed.startsWith(m.split(':')[0]))
    );

    return { running: true, models, recommended_missing };
  } catch {
    return { running: false, models: [], recommended_missing: [] };
  }
}
