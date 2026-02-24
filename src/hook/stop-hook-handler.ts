import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { LLMProvider } from '../types/index';
import type { SqliteStore } from '../storage/sqlite-store';
import { parseTranscriptFile } from '../capture/transcript-parser';
import { debugLog } from '../utils/debug-log';

const APPROVE_RESPONSE = '{"decision":"approve"}';

/**
 * Find the first frustrated turn's prompt and intent from session_turns.
 * Returns { prompt, intent } or null if no frustrated turn found.
 */
function findFirstFrustratedTurn(
  sessionId: string,
  sqliteStore: SqliteStore,
): { prompt: string; intent: string; errorKeyword: string } | null {
  try {
    const turns = sqliteStore.getTurnsBySession(sessionId);
    for (const turn of turns) {
      try {
        const analysis = JSON.parse(turn.analysis);
        if (analysis.type === 'frustrated') {
          return {
            prompt: turn.prompt,
            intent: analysis.intent ? String(analysis.intent).substring(0, 200) : '',
            errorKeyword: analysis.errorKeyword ? String(analysis.errorKeyword).substring(0, 200) : '',
          };
        }
      } catch {
        // invalid JSON in analysis, skip
      }
    }
  } catch {
    // getTurnsBySession failed
  }
  return null;
}

/**
 * Run the capture pipeline: parse transcript -> store full raw transcript as candidate (no LLM).
 * Context extraction is deferred to `sentinel review confirm`.
 */
export function runCapturePipeline(
  sessionId: string,
  transcriptPath: string,
  sqliteStore: SqliteStore,
  matchedExperienceId?: string,
): void {
  const sentinelDir = path.join(os.homedir(), '.sentinel');

  // Step 1: Parse transcript
  let transcriptData;
  try {
    transcriptData = parseTranscriptFile(transcriptPath);
    debugLog(`[stop] parseTranscript: ${transcriptData ? `${transcriptData.messages.length} msgs` : 'null'}`, sentinelDir);
  } catch (e) {
    debugLog(`[stop] parseTranscript error: ${e}`, sentinelDir);
    return;
  }

  if (!transcriptData || transcriptData.messages.length === 0) {
    debugLog('[stop] transcriptData is null or empty, skipping', sentinelDir);
    return;
  }

  // Step 2: Find frustrated turn for frustrationSignature (no slicing)
  const frustratedTurn = findFirstFrustratedTurn(sessionId, sqliteStore);
  let errorSummary = '';
  if (frustratedTurn) {
    errorSummary = frustratedTurn.errorKeyword || frustratedTurn.intent;
    debugLog(`[stop] frustrated turn found, intent: ${errorSummary}`, sentinelDir);
  } else {
    debugLog('[stop] no frustrated turn found, using empty signature', sentinelDir);
  }

  // Step 3: Dedup check + store candidate with full raw transcript
  try {
    const pendingDrafts = sqliteStore.getPendingDrafts();
    const hasDuplicate = pendingDrafts.some(
      (draft) => draft.sessionId === sessionId,
    );
    if (hasDuplicate) {
      debugLog('[stop] duplicate draft, skipping', sentinelDir);
      return;
    }

    const candidateId = randomUUID();
    sqliteStore.storeCandidate({
      id: candidateId,
      sessionId,
      transcriptData: JSON.stringify(transcriptData),
      frustrationSignature: errorSummary,
      failedApproaches: [],
      successfulApproach: undefined,
      matchedExperienceId,
      lessons: [],
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    debugLog(`[stop] storeCandidate: ${candidateId} (raw transcript, ${transcriptData.messages.length} msgs)`, sentinelDir);
  } catch (e) {
    debugLog(`[stop] storeCandidate error: ${e}`, sentinelDir);
  }
}

/**
 * Safely clear the session flag. Swallows any errors.
 */
export function safeClearFlag(sqliteStore: SqliteStore, sessionId: string): void {
  try {
    sqliteStore.clearFlag(sessionId);
  } catch {
    // Even if clearFlag throws, swallow the error
  }
}

/**
 * Stop Hook Handler - fires after every Claude response.
 *
 * Checks session flag status and, if status === 'capture', stores the raw
 * transcript as a candidate (no LLM call). LLM summarization happens later
 * when the user runs `sentinel review confirm`.
 *
 * Always returns '{"decision":"approve"}'. Never throws.
 */
export async function handleStop(input: {
  sessionId: string;
  transcriptPath: string;
  llmProvider: LLMProvider;
  sqliteStore: SqliteStore;
}): Promise<string> {
  try {
    const { sessionId, transcriptPath, sqliteStore } = input;

    if (!sessionId) {
      return APPROVE_RESPONSE;
    }

    let flag: ReturnType<SqliteStore['getFlag']>;
    try {
      flag = sqliteStore.getFlag(sessionId);
    } catch {
      return APPROVE_RESPONSE;
    }

    if (!flag || flag.status !== 'capture') {
      return APPROVE_RESPONSE;
    }

    const matchedExperienceId = flag.matched_experience_id ?? undefined;

    try {
      runCapturePipeline(sessionId, transcriptPath, sqliteStore, matchedExperienceId);
    } finally {
      safeClearFlag(sqliteStore, sessionId);
    }

    return APPROVE_RESPONSE;
  } catch {
    return APPROVE_RESPONSE;
  }
}
