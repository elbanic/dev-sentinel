import * as fs from 'fs';
import * as path from 'path';
import { loadSettings } from '../config/settings-loader';

let _debugEnabled: boolean | null = null;

function isDebugEnabled(): boolean {
  if (_debugEnabled === null) {
    _debugEnabled = loadSettings().debug;
  }
  return _debugEnabled;
}

/**
 * Append a timestamped debug message to hook-debug.log.
 * Only writes when settings.debug is true (checked once, cached).
 * Never throws — sentinel failure must never affect Claude Code.
 */
export function debugLog(msg: string, sentinelDir: string): void {
  if (!isDebugEnabled()) return;
  try {
    const logPath = path.join(sentinelDir, 'hook-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
  } catch { /* never break the CLI */ }
}
