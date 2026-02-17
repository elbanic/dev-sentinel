import type { LLMProvider, MatchResult, FailureExperience } from '../types/index';
import type { VectorStore } from '../storage/vector-store';
import type { SqliteStore } from '../storage/sqlite-store';
import { PROMPTS } from '../llm/prompts';
import { stripThinkBlock } from '../llm/strip-think-block';
import { parseLLMJson } from '../utils/parse-llm-json';

/**
 * Parsed response from the LLM relevance judge.
 */
interface JudgeResponse {
  relevant: boolean;
  confidence: number;
  reasoning: string;
  suggestedAction: string;
}

/**
 * Builds the user message sent to the LLM relevance judge.
 * Includes both the original user prompt and the experience details.
 */
function buildJudgeUserMessage(prompt: string, experience: FailureExperience): string {
  return [
    `## Current Developer Prompt`,
    prompt,
    ``,
    `## Past Failure Experience`,
    `Frustration Signature: ${experience.frustrationSignature}`,
    `Failed Approaches: ${experience.failedApproaches.join('; ')}`,
    `Successful Approach: ${experience.successfulApproach ?? 'N/A'}`,
    `Lessons: ${experience.lessons.join('; ')}`,
  ].join('\n');
}

/**
 * Attempts to parse the LLM judge response as JSON.
 * Handles <think> blocks and markdown fences.
 * Returns null if parsing fails or the response is malformed.
 */
function parseJudgeResponse(raw: string): JudgeResponse | null {
  const cleaned = stripThinkBlock(raw);
  const parsed = parseLLMJson(cleaned);

  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as any).relevant !== 'boolean') {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  return {
    relevant: obj.relevant as boolean,
    confidence: typeof obj.confidence === 'number' ? Math.min(1, Math.max(0, obj.confidence)) : 0,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
    suggestedAction: typeof obj.suggestedAction === 'string' ? obj.suggestedAction : '',
  };
}

/**
 * Searches for relevant past failure experiences using RAG.
 *
 * Pipeline:
 *   1. Embed the prompt via LLM
 *   2. Search vector store for similar experiences
 *   3. For each candidate, look up the full experience from SQLite
 *   4. Ask the LLM to judge relevance of each experience
 *   5. Return the most relevant match (highest confidence), or null
 *
 * Never throws - all failures gracefully return null.
 */
export async function searchMemory(
  prompt: string,
  llmProvider: LLMProvider,
  vectorStore: VectorStore,
  sqliteStore: SqliteStore,
  excludeExperienceIds?: string[],
): Promise<MatchResult | null> {
  try {
    // Step 1: Generate embedding for the user prompt
    const embedding = await llmProvider.generateEmbedding(prompt);

    // Step 2: Search vector store for similar candidates
    const candidates = vectorStore.search(embedding, 3, 0.5);

    // Early return if no candidates found
    if (candidates.length === 0) {
      return null;
    }

    // Build exclusion set for O(1) lookup
    const excludeSet = excludeExperienceIds ? new Set(excludeExperienceIds) : null;

    // Track the best relevant match across all candidates
    let bestMatch: MatchResult | null = null;

    // Step 3-6: Evaluate each candidate
    for (const candidate of candidates) {
      try {
        // Skip already-advised experiences
        if (excludeSet && excludeSet.has(candidate.id)) {
          continue;
        }

        // Step 3: Look up the full experience from SQLite
        const experience = sqliteStore.getExperience(candidate.id);
        if (experience === null) {
          continue;
        }

        // Step 4: Ask LLM judge for relevance
        const userMessage = buildJudgeUserMessage(prompt, experience);
        const rawResponse = await llmProvider.generateCompletion(
          PROMPTS.ragJudge,
          userMessage,
        );

        // Step 5: Parse and validate the judge response
        const judgeResult = parseJudgeResponse(rawResponse);
        if (judgeResult === null) {
          continue;
        }

        // Step 6: Only consider relevant candidates
        if (!judgeResult.relevant) {
          continue;
        }

        // Track the candidate with the highest LLM confidence
        if (bestMatch === null || judgeResult.confidence > bestMatch.confidence) {
          bestMatch = {
            experience,
            confidence: judgeResult.confidence,
            suggestedAction: judgeResult.suggestedAction,
          };
        }
      } catch {
        // Inner try-catch: skip this candidate on any error, try next
        continue;
      }
    }

    return bestMatch;
  } catch {
    // Outer try-catch: any unhandled error returns null
    return null;
  }
}
