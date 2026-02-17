/**
 * Parse JSON from LLM response text that may be wrapped in markdown code fences.
 * Returns the parsed value, or null if parsing fails.
 */
export function parseLLMJson(raw: string): unknown {
  // 1. Try direct JSON.parse
  try {
    return JSON.parse(raw);
  } catch {
    // Fall through to fence extraction
  }

  // 2. Try extracting from markdown fences: ```json ... ``` or ``` ... ```
  const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // ignore
    }
  }

  return null;
}
