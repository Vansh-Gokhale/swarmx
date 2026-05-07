/**
 * Extract JSON from local model output that may include reasoning text.
 * Local models like Llama often wrap JSON in commentary.
 */
export function extractJSON(text: string): string {
  // Try direct parse first
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch {}

  // Strip markdown fences first
  const stripped = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try { JSON.parse(stripped); return stripped; } catch {}

  // Extract JSON array (greedy match for nested structures)
  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { JSON.parse(arrayMatch[0]); return arrayMatch[0]; } catch {}
  }

  // Extract JSON object (greedy match for nested structures)
  const objMatch = stripped.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { JSON.parse(objMatch[0]); return objMatch[0]; } catch {}
  }

  // Last resort — return stripped
  return stripped;
}

/**
 * System prompt additions that improve JSON compliance on local models
 */
export const JSON_ENFORCEMENT = `
CRITICAL: Your response must be ONLY valid JSON.
- Do NOT include any text before or after the JSON.
- Do NOT use markdown code blocks or backticks.
- Do NOT include comments inside the JSON.
- Do NOT explain your answer.
- Start your response with [ or { immediately.`;
