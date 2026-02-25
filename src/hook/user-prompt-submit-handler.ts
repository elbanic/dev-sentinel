import * as os from 'os';
import * as path from 'path';
import type { LLMProvider } from '../types/index';
import type { SqliteStore } from '../storage/sqlite-store';
import type { VectorStore } from '../storage/vector-store';
import { analyzeFrustration } from '../analysis/frustration-analyzer';
import { searchMemory } from '../recall/memory-matcher';
import { debugLog } from '../utils/debug-log';
import { formatWarning } from './format-warning';

const EMPTY_RESPONSE = '{}';

/**
 * Handles the UserPromptSubmit hook for Claude Code.
 *
 * Pipeline:
 *   1. Validate input (prompt, sessionId must be truthy)
 *   2. Call analyzeFrustration(prompt, llmProvider) to classify the prompt
 *   3. Based on analysis.type:
 *      - 'frustrated': setFlag + searchMemory -> systemMessage if match found
 *      - 'resolution'/'abandonment': getFlag -> upgradeFlag if status is 'frustrated'
 *      - 'normal': pass through
 *   4. Always call storeTurn(sessionId, prompt, JSON.stringify(analysis))
 *   5. Check getPendingDrafts() for drafts from OTHER sessions -> add notification
 *   6. Return JSON string: '{}' or '{"systemMessage":"..."}'
 *   7. Never throws - all errors gracefully return '{}'
 */
export async function handleUserPromptSubmit(input: {
  prompt: string;
  sessionId: string;
  llmProvider: LLMProvider;
  sqliteStore: SqliteStore;
  vectorStore: VectorStore;
  maxAdvicesPerSession?: number;
  frustrationThreshold?: number;
}): Promise<string> {
  try {
    // Input validation: if prompt or sessionId is falsy/undefined, return empty
    if (!input || !input.prompt || !input.sessionId) {
      return EMPTY_RESPONSE;
    }

    const { prompt, sessionId, llmProvider, sqliteStore, vectorStore } = input;
    const maxAdvices = input.maxAdvicesPerSession ?? 5;
    const threshold = input.frustrationThreshold ?? 0.75;

    // Step 1: Analyze the prompt for frustration
    const analysis = await analyzeFrustration(prompt, llmProvider);

    // Step 2: Handle based on analysis type
    const messageParts: string[] = [];

    const sentinelDir = path.join(os.homedir(), '.sentinel');
    debugLog(`[ups] model=${llmProvider.getModelName()}, ${analysis.type}(${analysis.confidence}), threshold=${threshold}`, sentinelDir);

    if (analysis.type === 'frustrated' && analysis.confidence >= threshold) {
      let matchedExperienceId: string | undefined;

      // Get already-advised experience IDs for this session
      const advisedIds = sqliteStore.getAdvisedExperienceIds(sessionId);

      // Skip searchMemory if max advice limit reached
      if (advisedIds.length >= maxAdvices) {
        debugLog(`[ups] searchMemory: skipped (max advices reached: ${advisedIds.length}/${maxAdvices})`, sentinelDir);
      } else {
        // Search memory for relevant past experiences, excluding already-advised ones
        try {
          const match = await searchMemory(prompt, llmProvider, vectorStore, sqliteStore, advisedIds);
          debugLog(`[ups] searchMemory: ${match ? `confidence=${match.confidence}, action=${match.suggestedAction?.substring(0, 80)}` : 'null'}`, sentinelDir);

          if (match) {
            matchedExperienceId = match.experience.id;
            sqliteStore.recordAdvice(sessionId, match.experience.id);
            messageParts.push(formatWarning(match));
          }
        } catch (e) {
          debugLog(`[ups] searchMemory error: ${e}`, sentinelDir);
          try { sqliteStore.recordHookError('vector', 'user-prompt-submit', String(e)); } catch { /* ignore */ }
        }
      }

      // setFlag AFTER searchMemory so we have matchedExperienceId
      sqliteStore.setFlag(sessionId, 'frustrated', matchedExperienceId);
    } else if (analysis.type === 'resolution' || analysis.type === 'abandonment') {
      // Check if there is an existing frustrated flag
      const flag = sqliteStore.getFlag(sessionId);
      if (flag && flag.status === 'frustrated') {
        // Feature 2: mark advices effective on resolution only
        if (analysis.type === 'resolution') {
          try { sqliteStore.markAdvicesEffective(sessionId); } catch { /* graceful */ }
        }

        // Feature 2: mark prior sessions' advices as ineffective on abandonment
        if (analysis.type === 'abandonment') {
          try {
            const advisedIds = sqliteStore.getAdvisedExperienceIds(sessionId);
            for (const expId of advisedIds) {
              sqliteStore.markPriorAdviceIneffective(expId, sessionId);
            }
          } catch { /* graceful */ }
        }

        sqliteStore.upgradeFlag(sessionId, 'capture');
      }
    }
    // 'normal': no special action

    // Step 3: Always store the turn
    sqliteStore.storeTurn(sessionId, prompt, JSON.stringify(analysis));

    // Step 4: Check for pending drafts from OTHER sessions
    const pendingDrafts = sqliteStore.getPendingDrafts();
    const otherDraftCount = pendingDrafts.filter(
      (draft) => draft.sessionId !== sessionId,
    ).length;
    if (otherDraftCount > 0) {
      messageParts.push(
        Math.random() < 0.5
          ? `${otherDraftCount} pending draft(s). Run "sentinel review list" to review.`
          : `${otherDraftCount} pending draft(s). Run "!sentinel review confirm --recent"`,
      );
    }

    // Step 5: Build the output
    if (messageParts.length > 0) {
      const systemMessage = messageParts.join('\n\n');
      return JSON.stringify({ systemMessage });
    }

    return EMPTY_RESPONSE;
  } catch (e) {
    try { input?.sqliteStore?.recordHookError('llm', 'user-prompt-submit', String(e)); } catch { /* ignore */ }
    // Never throw - return '{}' on any error
    return EMPTY_RESPONSE;
  }
}
