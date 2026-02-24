import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_SETTINGS } from '../config/settings-loader';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface InitOptions {
  projectDir: string;
  homeDir: string;
  scope?: 'global' | 'local';
  ollamaHealthCheck?: () => Promise<boolean>;
}

export interface InitResult {
  messages: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Sentinel hook definitions
// ---------------------------------------------------------------------------

const SENTINEL_USER_PROMPT_SUBMIT_HOOK = {
  matcher: '',
  hooks: [{ type: 'command', command: 'sentinel --hook user-prompt-submit' }],
};

const SENTINEL_STOP_HOOK = {
  matcher: '',
  hooks: [{ type: 'command', command: 'sentinel --hook stop' }],
};

const SENTINEL_SESSION_END_HOOK = {
  matcher: '',
  hooks: [{ type: 'command', command: 'sentinel --hook session-end' }],
};

// ---------------------------------------------------------------------------
// Helper: check if a sentinel hook already exists in a hook array
// ---------------------------------------------------------------------------

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

function hasSentinelHook(hookArray: HookEntry[], sentinelCommand: string): boolean {
  return hookArray.some(
    (h) =>
      Array.isArray(h.hooks) &&
      h.hooks.some((inner) => inner.command === sentinelCommand),
  );
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function initCommand(options: InitOptions): Promise<InitResult> {
  const messages: string[] = [];
  const warnings: string[] = [];

  const scope = options.scope ?? 'local';

  // 1. Install hooks based on scope
  if (scope === 'global') {
    // Global: write hooks to ~/.claude/settings.json
    const globalClaudeDir = path.join(options.homeDir, '.claude');
    const globalSettingsPath = path.join(globalClaudeDir, 'settings.json');

    fs.mkdirSync(globalClaudeDir, { recursive: true });

    let existingSettings: Record<string, any> = {};

    if (fs.existsSync(globalSettingsPath)) {
      try {
        const raw = fs.readFileSync(globalSettingsPath, 'utf-8');
        existingSettings = JSON.parse(raw);
      } catch {
        existingSettings = {};
      }
    }

    // Ensure hooks object exists
    if (!existingSettings.hooks || typeof existingSettings.hooks !== 'object') {
      existingSettings.hooks = {};
    }

    if (!Array.isArray(existingSettings.hooks.UserPromptSubmit)) {
      existingSettings.hooks.UserPromptSubmit = [];
    }

    if (!Array.isArray(existingSettings.hooks.Stop)) {
      existingSettings.hooks.Stop = [];
    }

    if (!Array.isArray(existingSettings.hooks.SessionEnd)) {
      existingSettings.hooks.SessionEnd = [];
    }

    if (
      !hasSentinelHook(
        existingSettings.hooks.UserPromptSubmit,
        'sentinel --hook user-prompt-submit',
      )
    ) {
      existingSettings.hooks.UserPromptSubmit.push(
        SENTINEL_USER_PROMPT_SUBMIT_HOOK,
      );
    }

    if (
      !hasSentinelHook(existingSettings.hooks.Stop, 'sentinel --hook stop')
    ) {
      existingSettings.hooks.Stop.push(SENTINEL_STOP_HOOK);
    }

    if (
      !hasSentinelHook(existingSettings.hooks.SessionEnd, 'sentinel --hook session-end')
    ) {
      existingSettings.hooks.SessionEnd.push(SENTINEL_SESSION_END_HOOK);
    }

    fs.writeFileSync(
      globalSettingsPath,
      JSON.stringify(existingSettings, null, 2),
      'utf-8',
    );
    messages.push('Created ~/.claude/settings.json');

    // Check for duplicate hooks in project settings.local.json
    const localSettingsPath = path.join(options.projectDir, '.claude', 'settings.local.json');
    if (fs.existsSync(localSettingsPath)) {
      try {
        const raw = fs.readFileSync(localSettingsPath, 'utf-8');
        const localSettings = JSON.parse(raw);
        if (localSettings.hooks) {
          const hasUPS = Array.isArray(localSettings.hooks.UserPromptSubmit) &&
            hasSentinelHook(localSettings.hooks.UserPromptSubmit, 'sentinel --hook user-prompt-submit');
          const hasStop = Array.isArray(localSettings.hooks.Stop) &&
            hasSentinelHook(localSettings.hooks.Stop, 'sentinel --hook stop');
          const hasSessionEnd = Array.isArray(localSettings.hooks.SessionEnd) &&
            hasSentinelHook(localSettings.hooks.SessionEnd, 'sentinel --hook session-end');
          if (hasUPS || hasStop || hasSessionEnd) {
            warnings.push(
              'Sentinel hooks found in .claude/settings.local.json. Remove them to avoid duplicate invocations.'
            );
          }
        }
      } catch {
        // Can't read settings.local.json — skip check
      }
    }
  } else {
    // Local: write hooks to .claude/settings.local.json (existing behavior)
    const claudeDir = path.join(options.projectDir, '.claude');
    const settingsLocalPath = path.join(claudeDir, 'settings.local.json');

    fs.mkdirSync(claudeDir, { recursive: true });

    let existingSettings: Record<string, any> = {};

    if (fs.existsSync(settingsLocalPath)) {
      try {
        const raw = fs.readFileSync(settingsLocalPath, 'utf-8');
        existingSettings = JSON.parse(raw);
      } catch {
        existingSettings = {};
      }
    }

    // Ensure hooks object exists
    if (!existingSettings.hooks || typeof existingSettings.hooks !== 'object') {
      existingSettings.hooks = {};
    }

    if (!Array.isArray(existingSettings.hooks.UserPromptSubmit)) {
      existingSettings.hooks.UserPromptSubmit = [];
    }

    if (!Array.isArray(existingSettings.hooks.Stop)) {
      existingSettings.hooks.Stop = [];
    }

    if (!Array.isArray(existingSettings.hooks.SessionEnd)) {
      existingSettings.hooks.SessionEnd = [];
    }

    if (
      !hasSentinelHook(
        existingSettings.hooks.UserPromptSubmit,
        'sentinel --hook user-prompt-submit',
      )
    ) {
      existingSettings.hooks.UserPromptSubmit.push(
        SENTINEL_USER_PROMPT_SUBMIT_HOOK,
      );
    }

    if (
      !hasSentinelHook(existingSettings.hooks.Stop, 'sentinel --hook stop')
    ) {
      existingSettings.hooks.Stop.push(SENTINEL_STOP_HOOK);
    }

    if (
      !hasSentinelHook(existingSettings.hooks.SessionEnd, 'sentinel --hook session-end')
    ) {
      existingSettings.hooks.SessionEnd.push(SENTINEL_SESSION_END_HOOK);
    }

    fs.writeFileSync(
      settingsLocalPath,
      JSON.stringify(existingSettings, null, 2),
      'utf-8',
    );
    messages.push('Created .claude/settings.local.json');

    // Check for duplicate hooks in settings.json
    const settingsPath = path.join(claudeDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const settingsJson = JSON.parse(raw);
        if (settingsJson.hooks) {
          const hasUPS = Array.isArray(settingsJson.hooks.UserPromptSubmit) &&
            hasSentinelHook(settingsJson.hooks.UserPromptSubmit, 'sentinel --hook user-prompt-submit');
          const hasStop = Array.isArray(settingsJson.hooks.Stop) &&
            hasSentinelHook(settingsJson.hooks.Stop, 'sentinel --hook stop');
          const hasSessionEnd = Array.isArray(settingsJson.hooks.SessionEnd) &&
            hasSentinelHook(settingsJson.hooks.SessionEnd, 'sentinel --hook session-end');
          if (hasUPS || hasStop || hasSessionEnd) {
            warnings.push(
              'Sentinel hooks found in .claude/settings.json. Remove them to avoid duplicate invocations (hooks should only be in settings.local.json).'
            );
          }
        }
      } catch {
        // Can't read settings.json — skip check
      }
    }
  }

  // 2. Create ~/.sentinel/ directory
  const sentinelDir = path.join(options.homeDir, '.sentinel');
  fs.mkdirSync(sentinelDir, { recursive: true });
  messages.push('Created ~/.sentinel/ directory');

  // 3. Create ~/.sentinel/settings.json with DEFAULT_SETTINGS (only if it doesn't exist)
  const sentinelSettingsPath = path.join(sentinelDir, 'settings.json');
  if (!fs.existsSync(sentinelSettingsPath)) {
    fs.writeFileSync(
      sentinelSettingsPath,
      JSON.stringify(DEFAULT_SETTINGS, null, 2),
      'utf-8',
    );
    messages.push('Created ~/.sentinel/settings.json');
  }

  // 4. Ollama health check
  if (options.ollamaHealthCheck) {
    try {
      const isHealthy = await options.ollamaHealthCheck();
      if (!isHealthy) {
        warnings.push(
          'Ollama is not reachable. Local LLM features will be unavailable until Ollama is running.',
        );
      }
    } catch {
      warnings.push(
        'Ollama is not reachable. Local LLM features will be unavailable until Ollama is running.',
      );
    }
  }

  return { messages, warnings };
}
