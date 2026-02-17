import * as os from 'os';
import * as path from 'path';
import type { TranscriptData, AutoMemoryCandidate, LLMProvider } from '../types/index';
import { PROMPTS } from '../llm/prompts';
import { stripThinkBlock } from '../llm/strip-think-block';
import { debugLog } from '../utils/debug-log';
import { parseLLMJson } from '../utils/parse-llm-json';
import { extractNoteFields } from '../utils/extract-note-fields';
import { randomUUID } from 'crypto';

const sentinelDir = path.join(os.homedir(), '.sentinel');

/**
 * Extract frustration signature from the transcript errors array.
 * Uses the first error as the primary signature.
 */
function extractFrustrationSignature(transcriptData: TranscriptData): string {
  if (transcriptData.errors.length > 0) {
    return transcriptData.errors[0];
  }
  // Fall back to first tool call error
  const toolCallWithError = transcriptData.toolCalls.find(
    (tc) => tc.error !== undefined && tc.error !== '',
  );
  if (toolCallWithError) {
    return toolCallWithError.error!;
  }
  return '';
}

/**
 * Extract failed approaches from tool calls that have error fields.
 */
function extractFailedApproaches(transcriptData: TranscriptData): string[] {
  return transcriptData.toolCalls
    .filter((tc) => tc.error !== undefined && tc.error !== '')
    .map((tc) => `${tc.name}: ${JSON.stringify(tc.input)} → ${tc.error}`);
}


/**
 * Generate an AutoMemoryCandidate from transcript data.
 *
 * Returns null if the transcript contains no errors (neither in the errors array
 * nor in tool call error fields). Never throws.
 *
 * When an LLM provider is given, attempts to use it for structured lesson extraction.
 * Falls back to heuristic extraction from assistant messages on LLM failure.
 */
export async function generateNote(
  transcriptData: TranscriptData,
  sessionId: string,
  llmProvider?: LLMProvider,
): Promise<AutoMemoryCandidate | null> {
  try {
    // Must have at least some messages to generate a meaningful note
    if (transcriptData.messages.length === 0) {
      return null;
    }

    // Fallback extraction from transcript
    const fallbackFrustrationSignature = extractFrustrationSignature(transcriptData);
    const fallbackFailedApproaches = extractFailedApproaches(transcriptData);

    let frustrationSignature = fallbackFrustrationSignature;
    let failedApproaches = fallbackFailedApproaches;
    let successfulApproach: string | undefined = undefined;
    let lessons: string[] = [];

    // Try LLM extraction if provider is available
    if (llmProvider) {
      try {
        // Build context message for LLM
        const contextMessage = buildContextMessage(transcriptData);
        debugLog(`[note] LLM call start (think:true), context length: ${contextMessage.length}`, sentinelDir);
        const startTime = Date.now();
        const response = await llmProvider.generateCompletion(
          PROMPTS.lessonSummarization,
          contextMessage,
          { think: true },
        );
        const elapsed = Date.now() - startTime;
        debugLog(`[note] LLM call done in ${elapsed}ms, response length: ${response.length}`, sentinelDir);

        const stripped = stripThinkBlock(response);
        const parsed = parseLLMJson(stripped);
        debugLog(`[note] parsed: ${parsed ? 'ok' : 'null'}, raw: ${stripped.substring(0, 200)}`, sentinelDir);

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          const fields = extractNoteFields(obj, {
            frustrationSignature, failedApproaches, successfulApproach, lessons,
          });
          frustrationSignature = fields.frustrationSignature;
          failedApproaches = fields.failedApproaches;
          successfulApproach = fields.successfulApproach;
          lessons = fields.lessons;
        }
        // If parsed is null (invalid JSON), fall through to use fallback values
      } catch (e) {
        debugLog(`[note] LLM error: ${e}`, sentinelDir);
        // LLM failure: use fallback values already set above
      }
    }

    return {
      id: randomUUID(),
      sessionId,
      frustrationSignature,
      failedApproaches,
      successfulApproach,
      lessons,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  } catch {
    // Never throw guarantee: return null on any unexpected error
    return null;
  }
}

/**
 * Build a context message from TranscriptData for LLM consumption.
 * Used by both note generation (Stop hook) and review confirm (CLI).
 */
export function buildContextMessage(transcriptData: TranscriptData): string {
  const parts: string[] = [];

  if (transcriptData.messages.length > 0) {
    const messageSummaries = transcriptData.messages.map(
      (m) => `[${m.role}]: ${m.content}`,
    );
    parts.push('── Conversation ──\n' + messageSummaries.join('\n\n'));
  }

  const namedToolCalls = transcriptData.toolCalls.filter((tc) => tc.name);
  if (namedToolCalls.length > 0) {
    const toolCallSummaries = namedToolCalls.map((tc) => {
      const inputStr = tc.input === null || tc.input === undefined
        ? ''
        : JSON.stringify(tc.input);
      const truncatedInput = inputStr.length > 100
        ? inputStr.substring(0, 100) + '...'
        : inputStr;
      let summary = `${tc.name}(${truncatedInput})`;
      if (tc.output) {
        const truncatedOutput = tc.output.length > 200
          ? tc.output.substring(0, 200) + '...'
          : tc.output;
        summary += ` → ${truncatedOutput}`;
      }
      if (tc.error) summary += ` [ERROR: ${tc.error}]`;
      return summary;
    });
    parts.push('── Tool Calls ──\n' + toolCallSummaries.join('\n'));
  }

  if (transcriptData.errors.length > 0) {
    parts.push('── Errors ──\n' + transcriptData.errors.map((e) => `• ${e}`).join('\n'));
  }

  return parts.join('\n\n');
}
