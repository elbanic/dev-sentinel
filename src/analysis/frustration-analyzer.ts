import type { LLMProvider, FrustrationAnalysis } from '../types/index';
import { FrustrationAnalysisSchema } from '../types/index';
import { PROMPTS } from '../llm/prompts';
import { stripThinkBlock } from '../llm/strip-think-block';
import { parseLLMJson } from '../utils/parse-llm-json';

/** The fallback returned on any failure. No optional fields. */
const FALLBACK: FrustrationAnalysis = {
  type: 'normal',
  confidence: 0,
  reasoning: '',
};

/**
 * Analyze a user prompt for frustration signals using a single LLM call.
 *
 * - Makes exactly ONE call to llmProvider.generateCompletion
 * - Parses the response as JSON (handles markdown fences)
 * - Validates with Zod
 * - On LLM error (generateCompletion throws): throws (bubble up to handler)
 * - On parse/validation failure: returns the fallback
 */
export async function analyzeFrustration(
  prompt: string,
  llmProvider: LLMProvider,
): Promise<FrustrationAnalysis> {
  // LLM call — errors bubble up to the caller (handler records them)
  const raw = await llmProvider.generateCompletion(
    PROMPTS.frustrationAnalysis,
    prompt,
  );

  // Parse/validate — errors are graceful fallback
  try {
    const parsed = parseLLMJson(stripThinkBlock(raw));
    if (!parsed) return FALLBACK;

    const result = FrustrationAnalysisSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}
