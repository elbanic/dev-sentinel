import * as fs from 'fs';
import * as path from 'path';

/**
 * Set a top-level field in <configDir>/settings.json.
 *
 * - Reads the existing file, parses JSON, sets the given key, writes back.
 * - Creates the directory and file if they don't exist.
 * - Handles malformed JSON gracefully (overwrites with { [key]: value }).
 * - Preserves all existing fields (read-modify-write, no Zod re-validation).
 * - Pretty-prints JSON output.
 * - Never throws.
 */
export function setSentinelSetting(configDir: string, key: string, value: unknown): void {
  try {
    fs.mkdirSync(configDir, { recursive: true });

    const filePath = path.join(configDir, 'settings.json');

    let settings: Record<string, unknown> = {};
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed;
      }
    } catch {
      // File doesn't exist or contains invalid JSON — start fresh
    }

    settings[key] = value;

    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch {
    // Never throw — graceful degradation
  }
}

/** Convenience wrapper kept for backward-compatibility. */
export function toggleSentinelEnabled(configDir: string, enabled: boolean): void {
  setSentinelSetting(configDir, 'enabled', enabled);
}
