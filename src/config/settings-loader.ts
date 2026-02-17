import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { SentinelSettingsSchema } from '../types/index';
import type { SentinelSettings } from '../types/index';

// Default settings returned on any failure (file not found, invalid JSON, Zod validation error).
// Exported as a frozen object so other modules can reference default values without risk of mutation.
export const DEFAULT_SETTINGS: Readonly<SentinelSettings> = Object.freeze({
  enabled: true,
  debug: false,
  llm: {
    provider: 'ollama' as const,
    ollama: {
      baseUrl: 'http://localhost:11434',
      completionModel: 'qwen3:4b',
      embeddingModel: 'qwen3-embedding:0.6b',
    },
  },
  storage: {
    dbPath: '~/.sentinel/sentinel.db',
  },
  recall: {
    maxAdvicesPerSession: 5,
  },
  analysis: {},
});

// Provider-based default thresholds when user doesn't set analysis.frustrationThreshold
const DEFAULT_FRUSTRATION_THRESHOLDS: Record<string, number> = {
  ollama: 0.75,
  bedrock: 0.85,
};

/**
 * Resolves the effective frustration threshold.
 * If the user explicitly set it, use that. Otherwise, use provider-based default.
 */
export function resolveFrustrationThreshold(settings: SentinelSettings): number {
  if (settings.analysis.frustrationThreshold !== undefined) {
    return settings.analysis.frustrationThreshold;
  }
  return DEFAULT_FRUSTRATION_THRESHOLDS[settings.llm.provider] ?? 0.75;
}

/**
 * Loads sentinel settings from a JSON config file.
 *
 * 1. If configPath is provided, reads from that path.
 *    Otherwise reads from ~/.sentinel/settings.json
 * 2. Parses JSON and validates with Zod schema (which applies defaults for missing fields).
 * 3. On ANY failure (file not found, bad JSON, Zod validation error): returns DEFAULT_SETTINGS.
 * 4. NEVER throws.
 */
export function loadSettings(configPath?: string): SentinelSettings {
  try {
    const resolvedPath =
      configPath ?? path.join(os.homedir(), '.sentinel', 'settings.json');

    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(raw);

    const result = SentinelSettingsSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    return structuredClone(DEFAULT_SETTINGS) as SentinelSettings;
  } catch {
    return structuredClone(DEFAULT_SETTINGS) as SentinelSettings;
  }
}
