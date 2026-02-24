import * as path from 'path';
import * as os from 'os';
import type { SqliteStore } from '../storage/sqlite-store';
import { runCapturePipeline, safeClearFlag } from './stop-hook-handler';
import { debugLog } from '../utils/debug-log';

/**
 * SessionEnd Hook Handler - fires when a Claude Code session ends.
 *
 * If a 'frustrated' flag is still active (user never explicitly said
 * "resolved" or "abandoned"), upgrades to 'capture' and stores the
 * raw transcript as a draft candidate.
 *
 * Returns void (SessionEnd hook does not expect stdout output).
 * Never throws.
 */
export async function handleSessionEnd(input: {
  sessionId: string;
  transcriptPath: string;
  sqliteStore: SqliteStore;
}): Promise<void> {
  try {
    const { sessionId, transcriptPath, sqliteStore } = input;
    const sentinelDir = path.join(os.homedir(), '.sentinel');

    if (!sessionId) {
      return;
    }

    let flag: ReturnType<SqliteStore['getFlag']>;
    try {
      flag = sqliteStore.getFlag(sessionId);
    } catch (e) {
      debugLog(`[session-end] getFlag error: ${e}`, sentinelDir);
      return;
    }

    if (!flag || flag.status !== 'frustrated') {
      return;
    }

    const matchedExperienceId = flag.matched_experience_id ?? undefined;

    // Upgrade flag to 'capture' (best effort)
    try {
      sqliteStore.upgradeFlag(sessionId, 'capture');
      debugLog(`[session-end] upgraded flag to capture for ${sessionId}`, sentinelDir);
    } catch (e) {
      debugLog(`[session-end] upgradeFlag error (continuing): ${e}`, sentinelDir);
    }

    try {
      runCapturePipeline(sessionId, transcriptPath, sqliteStore, matchedExperienceId);
    } finally {
      safeClearFlag(sqliteStore, sessionId);
    }
  } catch {
    // Never throw - SessionEnd errors are silently ignored
  }
}
