/**
 * Unit Tests for Init Command
 *
 * TDD RED phase: These tests define the expected behavior of initCommand()
 * from src/cli/init-command.ts BEFORE the implementation exists.
 * All tests are expected to FAIL.
 *
 * Function under test:
 *   initCommand(options: InitOptions): Promise<InitResult>
 *
 * Behavior:
 *   1. Create .claude/settings.local.json with hook config (UserPromptSubmit + Stop + SessionEnd)
 *   2. If .claude/settings.local.json already exists, MERGE (don't overwrite existing hooks)
 *   3. If sentinel hooks already configured, don't duplicate them
 *   4. Create ~/.sentinel/ directory
 *   5. Create ~/.sentinel/settings.json with DEFAULT_SETTINGS
 *   6. Check if Ollama is reachable -> warn if not (not error)
 *   7. Return InitResult with messages and warnings
 *   8. ~/.sentinel/ already exists -> no error
 *   9. ~/.sentinel/settings.json already exists -> don't overwrite
 *
 * Testing strategy:
 *   - Uses os.tmpdir() + fs.mkdtempSync for fully isolated filesystem tests
 *   - Each test gets unique temp directories for both projectDir and homeDir
 *   - Injects ollamaHealthCheck as a simple async boolean function
 *   - Cleans up all temp directories in afterEach
 *
 * Edge cases covered:
 *   - Clean environment (no pre-existing files)
 *   - Existing settings.local.json with unrelated hooks
 *   - Existing settings.local.json with sentinel hooks already present
 *   - Existing settings.local.json with mixed (user + sentinel) hooks
 *   - ~/.sentinel/ directory already exists
 *   - ~/.sentinel/settings.json already exists with custom values
 *   - Ollama reachable vs unreachable
 *   - ollamaHealthCheck throws (graceful)
 *   - Malformed existing settings.local.json (invalid JSON)
 *   - .claude/ directory does not exist yet
 *   - ollamaHealthCheck is undefined (optional parameter)
 *   - Empty hooks object in existing settings
 *   - No hooks property in existing settings
 *   - Running init twice (full idempotency)
 *   - SessionEnd hook registration (local and global scope)
 *   - SessionEnd hook idempotency (no duplicates on re-run)
 *   - Cross-scope duplicate detection for SessionEnd hooks
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { initCommand } from '../../src/cli/init-command';
import type { InitOptions, InitResult } from '../../src/cli/init-command';
import { DEFAULT_SETTINGS } from '../../src/config/settings-loader';

// ---------------------------------------------------------------------------
// Constants: expected hook configuration that initCommand should write
// ---------------------------------------------------------------------------

const EXPECTED_SENTINEL_HOOKS = {
  hooks: {
    UserPromptSubmit: [
      {
        matcher: '',
        hooks: [
          { type: 'command', command: 'sentinel --hook user-prompt-submit' },
        ],
      },
    ],
    Stop: [
      {
        matcher: '',
        hooks: [{ type: 'command', command: 'sentinel --hook stop' }],
      },
    ],
    SessionEnd: [
      {
        matcher: '',
        hooks: [{ type: 'command', command: 'sentinel --hook session-end' }],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let projectDir: string;
let homeDir: string;

/**
 * Creates a unique temp directory with the given prefix.
 */
function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sentinel-init-test-${prefix}-`));
}

/**
 * Writes a file under the projectDir, creating intermediate directories as needed.
 */
function writeProjectFile(relativePath: string, content: string): string {
  const filePath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Writes a file under the homeDir, creating intermediate directories as needed.
 */
function writeHomeFile(relativePath: string, content: string): string {
  const filePath = path.join(homeDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Reads a JSON file and returns the parsed object.
 */
function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Builds the default InitOptions with injected temp directories and a healthy Ollama.
 */
function makeOptions(overrides?: Partial<InitOptions>): InitOptions {
  return {
    projectDir,
    homeDir,
    ollamaHealthCheck: async () => true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('initCommand', () => {
  beforeEach(() => {
    projectDir = createTempDir('project');
    homeDir = createTempDir('home');
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  // =========================================================================
  // 1. Clean environment -> all files created
  // =========================================================================
  describe('clean environment - all files created from scratch', () => {
    it('should create .claude/settings.local.json with hook config', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
    });

    it('should write correct UserPromptSubmit hook in settings.local.json', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
      expect(settings.hooks.UserPromptSubmit[0]).toEqual({
        matcher: '',
        hooks: [
          { type: 'command', command: 'sentinel --hook user-prompt-submit' },
        ],
      });
    });

    it('should write correct Stop hook in settings.local.json', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
      expect(settings.hooks.Stop).toHaveLength(1);
      expect(settings.hooks.Stop[0]).toEqual({
        matcher: '',
        hooks: [{ type: 'command', command: 'sentinel --hook stop' }],
      });
    });

    it('should write correct SessionEnd hook in settings.local.json', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.hooks.SessionEnd).toBeDefined();
      expect(settings.hooks.SessionEnd).toHaveLength(1);
      expect(settings.hooks.SessionEnd[0]).toEqual({
        matcher: '',
        hooks: [{ type: 'command', command: 'sentinel --hook session-end' }],
      });
    });

    it('should create ~/.sentinel/ directory', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const sentinelDir = path.join(homeDir, '.sentinel');
      expect(fs.existsSync(sentinelDir)).toBe(true);
      expect(fs.statSync(sentinelDir).isDirectory()).toBe(true);
    });

    it('should create ~/.sentinel/settings.json with DEFAULT_SETTINGS', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
    });

    it('should create .claude/ directory if it does not exist', async () => {
      // Arrange: projectDir has no .claude/ directory yet
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const claudeDir = path.join(projectDir, '.claude');
      expect(fs.existsSync(claudeDir)).toBe(true);
      expect(fs.statSync(claudeDir).isDirectory()).toBe(true);
    });

    it('should return an InitResult object with messages array', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      const result: InitResult = await initCommand(options);

      // Assert
      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should return an InitResult object with warnings array', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      const result: InitResult = await initCommand(options);

      // Assert
      expect(result).toBeDefined();
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  // =========================================================================
  // 2. Existing settings.local.json with other hooks -> merge
  // =========================================================================
  describe('merge with existing settings.local.json', () => {
    it('should preserve existing non-sentinel hooks in UserPromptSubmit', async () => {
      // Arrange: existing settings.local.json has a custom UserPromptSubmit hook
      const existingSettings = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [
                { type: 'command', command: 'my-custom-linter --check' },
              ],
            },
          ],
        },
      };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(existingSettings, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert: existing hook must still be there
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      const userPromptHooks = settings.hooks.UserPromptSubmit as any[];

      // Must have BOTH the existing custom hook and the sentinel hook
      const customHook = userPromptHooks.find(
        (h: any) => h.hooks?.some((inner: any) => inner.command === 'my-custom-linter --check'),
      );
      expect(customHook).toBeDefined();
    });

    it('should add sentinel UserPromptSubmit hook alongside existing hooks', async () => {
      // Arrange
      const existingSettings = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [
                { type: 'command', command: 'my-custom-linter --check' },
              ],
            },
          ],
        },
      };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(existingSettings, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      const userPromptHooks = settings.hooks.UserPromptSubmit as any[];

      const sentinelHook = userPromptHooks.find(
        (h: any) =>
          h.hooks?.some(
            (inner: any) => inner.command === 'sentinel --hook user-prompt-submit',
          ),
      );
      expect(sentinelHook).toBeDefined();
    });

    it('should preserve existing non-sentinel hooks in Stop', async () => {
      // Arrange
      const existingSettings = {
        hooks: {
          Stop: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'my-logger --save' }],
            },
          ],
        },
      };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(existingSettings, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      const stopHooks = settings.hooks.Stop as any[];

      const customHook = stopHooks.find(
        (h: any) => h.hooks?.some((inner: any) => inner.command === 'my-logger --save'),
      );
      expect(customHook).toBeDefined();
    });

    it('should add sentinel Stop hook alongside existing Stop hooks', async () => {
      // Arrange
      const existingSettings = {
        hooks: {
          Stop: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'my-logger --save' }],
            },
          ],
        },
      };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(existingSettings, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      const stopHooks = settings.hooks.Stop as any[];

      const sentinelHook = stopHooks.find(
        (h: any) =>
          h.hooks?.some((inner: any) => inner.command === 'sentinel --hook stop'),
      );
      expect(sentinelHook).toBeDefined();
    });

    it('should preserve non-hook properties in existing settings.local.json', async () => {
      // Arrange: existing file has other top-level properties
      const existingSettings = {
        permissions: { allow: ['Read', 'Write'] },
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'other-tool' }],
            },
          ],
        },
      };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(existingSettings, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert: non-hook properties should be preserved
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.permissions).toBeDefined();
      expect(settings.permissions).toEqual({ allow: ['Read', 'Write'] });
    });
  });

  // =========================================================================
  // 3. Sentinel hooks already configured -> don't duplicate
  // =========================================================================
  describe('idempotency - sentinel hooks already present', () => {
    it('should NOT duplicate UserPromptSubmit sentinel hook when already present', async () => {
      // Arrange: existing file already has the sentinel hook
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(EXPECTED_SENTINEL_HOOKS, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      const userPromptHooks = settings.hooks.UserPromptSubmit as any[];

      // Count sentinel hooks - should be exactly 1
      const sentinelHooks = userPromptHooks.filter(
        (h: any) =>
          h.hooks?.some(
            (inner: any) =>
              inner.command === 'sentinel --hook user-prompt-submit',
          ),
      );
      expect(sentinelHooks).toHaveLength(1);
    });

    it('should NOT duplicate Stop sentinel hook when already present', async () => {
      // Arrange
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(EXPECTED_SENTINEL_HOOKS, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      const stopHooks = settings.hooks.Stop as any[];

      const sentinelHooks = stopHooks.filter(
        (h: any) =>
          h.hooks?.some(
            (inner: any) => inner.command === 'sentinel --hook stop',
          ),
      );
      expect(sentinelHooks).toHaveLength(1);
    });

    it('should NOT duplicate SessionEnd sentinel hook when already present', async () => {
      // Arrange
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(EXPECTED_SENTINEL_HOOKS, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      const sessionEndHooks = settings.hooks.SessionEnd as any[];

      const sentinelHooks = sessionEndHooks.filter(
        (h: any) =>
          h.hooks?.some(
            (inner: any) => inner.command === 'sentinel --hook session-end',
          ),
      );
      expect(sentinelHooks).toHaveLength(1);
    });

    it('should still return a result even when nothing needs to be done', async () => {
      // Arrange: everything is already set up
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(EXPECTED_SENTINEL_HOOKS, null, 2),
      );
      writeHomeFile(
        '.sentinel/settings.json',
        JSON.stringify(DEFAULT_SETTINGS, null, 2),
      );

      const options = makeOptions();

      // Act
      const result: InitResult = await initCommand(options);

      // Assert
      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('should not duplicate when sentinel hooks exist alongside other hooks', async () => {
      // Arrange: mixed hooks - user custom + sentinel
      const mixedSettings = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'my-linter --check' }],
            },
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command: 'sentinel --hook user-prompt-submit',
                },
              ],
            },
          ],
          Stop: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'sentinel --hook stop' }],
            },
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'my-logger --on-stop' }],
            },
          ],
          SessionEnd: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'sentinel --hook session-end' }],
            },
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'my-cleanup --on-end' }],
            },
          ],
        },
      };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(mixedSettings, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      // UserPromptSubmit: 1 custom + 1 sentinel = 2
      expect(settings.hooks.UserPromptSubmit).toHaveLength(2);

      // Stop: 1 sentinel + 1 custom = 2
      expect(settings.hooks.Stop).toHaveLength(2);

      // SessionEnd: 1 sentinel + 1 custom = 2
      expect(settings.hooks.SessionEnd).toHaveLength(2);
    });
  });

  // =========================================================================
  // 4. ~/.sentinel/settings.json contains DEFAULT_SETTINGS values
  // =========================================================================
  describe('sentinel settings file contents', () => {
    it('should write DEFAULT_SETTINGS provider as ollama', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.llm.provider).toBe('ollama');
    });

    it('should write DEFAULT_SETTINGS ollama baseUrl', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.llm.ollama.baseUrl).toBe('http://localhost:11434');
    });

    it('should write DEFAULT_SETTINGS ollama completionModel', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.llm.ollama.completionModel).toBe('qwen3:4b');
    });

    it('should write DEFAULT_SETTINGS ollama embeddingModel', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.llm.ollama.embeddingModel).toBe('qwen3-embedding:0.6b');
    });

    it('should write DEFAULT_SETTINGS storage dbPath', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.storage.dbPath).toBe('~/.sentinel/sentinel.db');
    });

    it('should write valid JSON to ~/.sentinel/settings.json', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf-8');

      // Must not throw on JSON.parse
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  // =========================================================================
  // 5. Ollama unreachable -> warning message (not error)
  // =========================================================================
  describe('Ollama health check - unreachable', () => {
    it('should include a warning when Ollama is not reachable', async () => {
      // Arrange
      const options = makeOptions({
        ollamaHealthCheck: async () => false,
      });

      // Act
      const result: InitResult = await initCommand(options);

      // Assert: should have at least one warning about Ollama
      expect(result.warnings.length).toBeGreaterThan(0);
      const ollamaWarning = result.warnings.find(
        (w: string) => w.toLowerCase().includes('ollama'),
      );
      expect(ollamaWarning).toBeDefined();
    });

    it('should NOT throw when Ollama is unreachable', async () => {
      // Arrange
      const options = makeOptions({
        ollamaHealthCheck: async () => false,
      });

      // Act & Assert: should resolve successfully, not reject
      await expect(initCommand(options)).resolves.toBeDefined();
    });

    it('should still create all files even when Ollama is unreachable', async () => {
      // Arrange
      const options = makeOptions({
        ollamaHealthCheck: async () => false,
      });

      // Act
      await initCommand(options);

      // Assert: all files should still be created
      const hookSettingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const sentinelSettingsPath = path.join(homeDir, '.sentinel', 'settings.json');

      expect(fs.existsSync(hookSettingsPath)).toBe(true);
      expect(fs.existsSync(sentinelSettingsPath)).toBe(true);
    });

    it('should still return messages (not just warnings) when Ollama is unreachable', async () => {
      // Arrange
      const options = makeOptions({
        ollamaHealthCheck: async () => false,
      });

      // Act
      const result: InitResult = await initCommand(options);

      // Assert: messages about file creation should still be present
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 6. Ollama reachable -> no warning
  // =========================================================================
  describe('Ollama health check - reachable', () => {
    it('should NOT include Ollama-related warnings when Ollama is reachable', async () => {
      // Arrange
      const options = makeOptions({
        ollamaHealthCheck: async () => true,
      });

      // Act
      const result: InitResult = await initCommand(options);

      // Assert
      const ollamaWarnings = result.warnings.filter(
        (w: string) => w.toLowerCase().includes('ollama'),
      );
      expect(ollamaWarnings).toHaveLength(0);
    });
  });

  // =========================================================================
  // 7. ~/.sentinel/ directory already exists -> no error
  // =========================================================================
  describe('sentinel directory already exists', () => {
    it('should not throw when ~/.sentinel/ directory already exists', async () => {
      // Arrange
      fs.mkdirSync(path.join(homeDir, '.sentinel'), { recursive: true });
      const options = makeOptions();

      // Act & Assert
      await expect(initCommand(options)).resolves.toBeDefined();
    });

    it('should still create settings.json when ~/.sentinel/ exists but settings.json does not', async () => {
      // Arrange
      fs.mkdirSync(path.join(homeDir, '.sentinel'), { recursive: true });
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
    });
  });

  // =========================================================================
  // 8. ~/.sentinel/settings.json already exists -> don't overwrite
  // =========================================================================
  describe('sentinel settings.json already exists - do not overwrite', () => {
    it('should NOT overwrite existing ~/.sentinel/settings.json', async () => {
      // Arrange: existing settings with a custom provider
      const customSettings = {
        llm: {
          provider: 'bedrock',
          ollama: {
            baseUrl: 'http://custom:9999',
            completionModel: 'custom-model',
            embeddingModel: 'custom-embedding',
          },
          bedrock: {
            region: 'ap-northeast-2',
            completionModel: 'anthropic.claude-sonnet-4-20250514',
            embeddingModel: 'amazon.titan-embed-text-v2:0',
          },
        },
        storage: {
          dbPath: '/custom/path/sentinel.db',
        },
      };
      writeHomeFile('.sentinel/settings.json', JSON.stringify(customSettings, null, 2));

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert: settings should remain unchanged
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.llm.provider).toBe('bedrock');
      expect(settings.llm.ollama.baseUrl).toBe('http://custom:9999');
      expect(settings.storage.dbPath).toBe('/custom/path/sentinel.db');
    });

    it('should preserve the exact content of existing settings.json', async () => {
      // Arrange
      const originalContent = JSON.stringify(
        {
          llm: {
            provider: 'ollama',
            ollama: {
              baseUrl: 'http://localhost:11434',
              completionModel: 'qwen3:4b',
              embeddingModel: 'qwen3-embedding:0.6b',
            },
          },
          storage: { dbPath: '/my/db.sqlite' },
        },
        null,
        2,
      );
      writeHomeFile('.sentinel/settings.json', originalContent);

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(homeDir, '.sentinel', 'settings.json');
      const currentContent = fs.readFileSync(settingsPath, 'utf-8');

      expect(currentContent).toBe(originalContent);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('should handle ollamaHealthCheck that throws an error gracefully', async () => {
      // Arrange: healthCheck throws instead of returning boolean
      const options = makeOptions({
        ollamaHealthCheck: async () => {
          throw new Error('Network error: ECONNREFUSED');
        },
      });

      // Act & Assert: should not throw, should treat as unreachable
      const result: InitResult = await initCommand(options);

      expect(result).toBeDefined();
      // Should warn about Ollama being unreachable
      const ollamaWarning = result.warnings.find(
        (w: string) => w.toLowerCase().includes('ollama'),
      );
      expect(ollamaWarning).toBeDefined();
    });

    it('should handle malformed JSON in existing settings.local.json', async () => {
      // Arrange: existing file has invalid JSON
      writeProjectFile('.claude/settings.local.json', '{ invalid json !!!');

      const options = makeOptions();

      // Act: should not throw - should overwrite or handle gracefully
      const result: InitResult = await initCommand(options);

      // Assert: function completed and sentinel hooks are present
      expect(result).toBeDefined();
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
    });

    it('should handle ollamaHealthCheck being undefined (optional parameter)', async () => {
      // Arrange: omit ollamaHealthCheck entirely
      const options: InitOptions = {
        projectDir,
        homeDir,
      };

      // Act: should not throw - should skip or use default behavior
      const result: InitResult = await initCommand(options);

      // Assert
      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('should handle existing settings.local.json with empty hooks object', async () => {
      // Arrange
      const existingSettings = { hooks: {} };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(existingSettings, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
    });

    it('should handle existing settings.local.json with no hooks property', async () => {
      // Arrange
      const existingSettings = { permissions: { allow: ['Bash'] } };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(existingSettings, null, 2),
      );

      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      // Should have hooks added while preserving permissions
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
      expect(settings.permissions).toEqual({ allow: ['Bash'] });
    });

    it('should write valid JSON to settings.local.json', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const raw = fs.readFileSync(settingsPath, 'utf-8');

      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it('should handle running init twice (full idempotency)', async () => {
      // Arrange
      const options = makeOptions();

      // Act: run init twice
      const firstResult: InitResult = await initCommand(options);
      const secondResult: InitResult = await initCommand(options);

      // Assert: both should succeed
      expect(firstResult).toBeDefined();
      expect(secondResult).toBeDefined();

      // File contents should be correct after second run
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      const settings = readJsonFile(settingsPath) as Record<string, any>;

      // Should still have exactly 1 sentinel hook each
      const sentinelUserHooks = settings.hooks.UserPromptSubmit.filter(
        (h: any) =>
          h.hooks?.some(
            (inner: any) =>
              inner.command === 'sentinel --hook user-prompt-submit',
          ),
      );
      const sentinelStopHooks = settings.hooks.Stop.filter(
        (h: any) =>
          h.hooks?.some(
            (inner: any) => inner.command === 'sentinel --hook stop',
          ),
      );
      const sentinelSessionEndHooks = settings.hooks.SessionEnd.filter(
        (h: any) =>
          h.hooks?.some(
            (inner: any) => inner.command === 'sentinel --hook session-end',
          ),
      );

      expect(sentinelUserHooks).toHaveLength(1);
      expect(sentinelStopHooks).toHaveLength(1);
      expect(sentinelSessionEndHooks).toHaveLength(1);
    });
  });

  // =========================================================================
  // Return value structure
  // =========================================================================
  describe('InitResult return value structure', () => {
    it('should return messages as string array', async () => {
      // Arrange
      const options = makeOptions();

      // Act
      const result: InitResult = await initCommand(options);

      // Assert
      expect(Array.isArray(result.messages)).toBe(true);
      result.messages.forEach((msg: string) => {
        expect(typeof msg).toBe('string');
      });
    });

    it('should return warnings as string array', async () => {
      // Arrange
      const options = makeOptions({ ollamaHealthCheck: async () => false });

      // Act
      const result: InitResult = await initCommand(options);

      // Assert
      expect(Array.isArray(result.warnings)).toBe(true);
      result.warnings.forEach((w: string) => {
        expect(typeof w).toBe('string');
      });
    });

    it('should return empty warnings array when everything succeeds', async () => {
      // Arrange
      const options = makeOptions({ ollamaHealthCheck: async () => true });

      // Act
      const result: InitResult = await initCommand(options);

      // Assert: with healthy Ollama and no issues, warnings should be empty
      expect(result.warnings).toHaveLength(0);
    });
  });

  // =========================================================================
  // Global scope — hooks installed to ~/.claude/settings.json
  // =========================================================================
  describe('global scope', () => {
    it('scope local should write hooks to .claude/settings.local.json (existing behavior)', async () => {
      // Arrange
      const options = makeOptions({ scope: 'local' });

      // Act
      await initCommand(options);

      // Assert
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
      expect(settings.hooks.Stop).toHaveLength(1);
    });

    it('scope global should write hooks to ~/.claude/settings.json', async () => {
      // Arrange
      const options = makeOptions({ scope: 'global' });

      // Act
      await initCommand(options);

      // Assert
      const globalSettingsPath = path.join(homeDir, '.claude', 'settings.json');
      expect(fs.existsSync(globalSettingsPath)).toBe(true);
      const settings = readJsonFile(globalSettingsPath) as Record<string, any>;
      expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
      expect(settings.hooks.UserPromptSubmit[0]).toEqual({
        matcher: '',
        hooks: [
          { type: 'command', command: 'sentinel --hook user-prompt-submit' },
        ],
      });
      expect(settings.hooks.Stop).toHaveLength(1);
      expect(settings.hooks.Stop[0]).toEqual({
        matcher: '',
        hooks: [{ type: 'command', command: 'sentinel --hook stop' }],
      });
    });

    it('scope global should write correct SessionEnd hook in global settings.json', async () => {
      // Arrange
      const options = makeOptions({ scope: 'global' });

      // Act
      await initCommand(options);

      // Assert
      const globalSettingsPath = path.join(homeDir, '.claude', 'settings.json');
      const settings = readJsonFile(globalSettingsPath) as Record<string, any>;

      expect(settings.hooks.SessionEnd).toBeDefined();
      expect(settings.hooks.SessionEnd).toHaveLength(1);
      expect(settings.hooks.SessionEnd[0]).toEqual({
        matcher: '',
        hooks: [{ type: 'command', command: 'sentinel --hook session-end' }],
      });
    });

    it('scope global should NOT create project .claude/ directory', async () => {
      // Arrange
      const options = makeOptions({ scope: 'global' });

      // Act
      await initCommand(options);

      // Assert
      const claudeDir = path.join(projectDir, '.claude');
      expect(fs.existsSync(claudeDir)).toBe(false);
    });

    it('scope global should merge with existing ~/.claude/settings.json', async () => {
      // Arrange: existing global settings with a custom hook
      const existingSettings = {
        permissions: { allow: ['Read'] },
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'my-global-tool --check' }],
            },
          ],
        },
      };
      const globalClaudeDir = path.join(homeDir, '.claude');
      fs.mkdirSync(globalClaudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalClaudeDir, 'settings.json'),
        JSON.stringify(existingSettings, null, 2),
        'utf-8',
      );

      const options = makeOptions({ scope: 'global' });

      // Act
      await initCommand(options);

      // Assert: existing hooks preserved, sentinel hooks added
      const globalSettingsPath = path.join(homeDir, '.claude', 'settings.json');
      const settings = readJsonFile(globalSettingsPath) as Record<string, any>;

      // Custom hook preserved
      const customHook = settings.hooks.UserPromptSubmit.find(
        (h: any) => h.hooks?.some((inner: any) => inner.command === 'my-global-tool --check'),
      );
      expect(customHook).toBeDefined();

      // Sentinel hook added
      const sentinelHook = settings.hooks.UserPromptSubmit.find(
        (h: any) =>
          h.hooks?.some(
            (inner: any) => inner.command === 'sentinel --hook user-prompt-submit',
          ),
      );
      expect(sentinelHook).toBeDefined();

      // Permissions preserved
      expect(settings.permissions).toEqual({ allow: ['Read'] });
    });

    it('scope global idempotency — no duplicate hooks on repeated init', async () => {
      // Arrange
      const options = makeOptions({ scope: 'global' });

      // Act: run init twice
      await initCommand(options);
      await initCommand(options);

      // Assert
      const globalSettingsPath = path.join(homeDir, '.claude', 'settings.json');
      const settings = readJsonFile(globalSettingsPath) as Record<string, any>;

      const sentinelUserHooks = settings.hooks.UserPromptSubmit.filter(
        (h: any) =>
          h.hooks?.some(
            (inner: any) => inner.command === 'sentinel --hook user-prompt-submit',
          ),
      );
      const sentinelStopHooks = settings.hooks.Stop.filter(
        (h: any) =>
          h.hooks?.some(
            (inner: any) => inner.command === 'sentinel --hook stop',
          ),
      );
      expect(sentinelUserHooks).toHaveLength(1);
      expect(sentinelStopHooks).toHaveLength(1);
    });

    it('scope global should still create ~/.sentinel/ directory and settings', async () => {
      // Arrange
      const options = makeOptions({ scope: 'global' });

      // Act
      await initCommand(options);

      // Assert
      const sentinelDir = path.join(homeDir, '.sentinel');
      expect(fs.existsSync(sentinelDir)).toBe(true);
      const sentinelSettingsPath = path.join(sentinelDir, 'settings.json');
      expect(fs.existsSync(sentinelSettingsPath)).toBe(true);
    });

    it('scope global should warn about duplicate hooks in project settings.local.json', async () => {
      // Arrange: project already has sentinel hooks in settings.local.json
      const localSettings = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'sentinel --hook user-prompt-submit' }],
            },
          ],
          Stop: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'sentinel --hook stop' }],
            },
          ],
        },
      };
      writeProjectFile(
        '.claude/settings.local.json',
        JSON.stringify(localSettings, null, 2),
      );

      const options = makeOptions({ scope: 'global' });

      // Act
      const result = await initCommand(options);

      // Assert: should warn about duplicate
      const duplicateWarning = result.warnings.find(
        (w: string) => w.toLowerCase().includes('duplicate') || w.toLowerCase().includes('settings.local.json'),
      );
      expect(duplicateWarning).toBeDefined();
    });

    it('scope global should detect cross-scope SessionEnd hook duplicates', async () => {
      // Arrange: write local settings with SessionEnd hook
      const localClaudeDir = path.join(projectDir, '.claude');
      fs.mkdirSync(localClaudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(localClaudeDir, 'settings.local.json'),
        JSON.stringify({
          hooks: {
            SessionEnd: [
              { matcher: '', hooks: [{ type: 'command', command: 'sentinel --hook session-end' }] },
            ],
          },
        }),
        'utf-8',
      );

      // Act: run init with global scope
      const options = makeOptions({ scope: 'global' });
      const result = await initCommand(options);

      // Assert: should warn about duplicate
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.toLowerCase().includes('duplicate') || w.toLowerCase().includes('sentinel hooks found'))).toBe(true);
    });

    it('scope global should handle malformed ~/.claude/settings.json gracefully', async () => {
      // Arrange: malformed JSON in global settings
      const globalClaudeDir = path.join(homeDir, '.claude');
      fs.mkdirSync(globalClaudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalClaudeDir, 'settings.json'),
        '{ invalid json !!!',
        'utf-8',
      );

      const options = makeOptions({ scope: 'global' });

      // Act
      const result = await initCommand(options);

      // Assert: should not throw, should overwrite with sentinel hooks
      expect(result).toBeDefined();
      const globalSettingsPath = path.join(homeDir, '.claude', 'settings.json');
      const settings = readJsonFile(globalSettingsPath) as Record<string, any>;
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
    });

    it('scope defaults to local when not provided', async () => {
      // Arrange: no scope in options (backwards compatibility)
      const options: InitOptions = {
        projectDir,
        homeDir,
        ollamaHealthCheck: async () => true,
      };

      // Act
      await initCommand(options);

      // Assert: should behave as local scope
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
      const settings = readJsonFile(settingsPath) as Record<string, any>;
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
    });
  });
});
