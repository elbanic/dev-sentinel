/**
 * Unit Tests for CLI `sentinel enable` and `sentinel disable` Commands
 *
 * TDD RED phase: These tests define the expected behavior of the enable/disable
 * commands BEFORE the implementation exists. All tests are expected to FAIL.
 *
 * Requirements:
 *   1. `sentinel disable`:
 *      - Reads ~/.sentinel/settings.json (or creates it if missing)
 *      - Sets `enabled: false` in the JSON
 *      - Preserves existing settings (does not overwrite other fields)
 *      - Outputs confirmation message "Sentinel disabled.\n"
 *
 *   2. `sentinel enable`:
 *      - Reads ~/.sentinel/settings.json (or creates it if missing)
 *      - Sets `enabled: true` in the JSON
 *      - Preserves existing settings
 *      - Outputs confirmation message "Sentinel enabled.\n"
 *
 *   3. `sentinel status` should show enabled/disabled state
 *
 * Architecture:
 *   The enable/disable logic is implemented as a utility function:
 *     toggleSentinelEnabled(configDir: string, enabled: boolean): void
 *   This function is independently testable and the CLI commands delegate to it.
 *
 * Test categories (6 groups, ~30 tests):
 *   1. toggleSentinelEnabled() utility — core logic
 *   2. sentinel disable — CLI integration
 *   3. sentinel enable — CLI integration
 *   4. sentinel status — enabled/disabled display
 *   5. Edge cases — concurrent writes, permissions, encoding
 *   6. Property tests — round-trip preservation via fast-check
 *
 * Testing strategy:
 *   - toggleSentinelEnabled() tests use real temp directories (no fs mocking)
 *   - CLI command tests use createProgram() + configureOutput() (same as cli.test.ts)
 *   - Property tests use fast-check to verify settings preservation
 *
 * Assumptions:
 *   - toggleSentinelEnabled will be exported from a new module
 *     (e.g., src/config/toggle-enabled.ts) or from settings-loader.ts
 *   - The CLI commands will be registered in createProgram() (not in main())
 *   - The configDir parameter defaults to ~/.sentinel/ but is injectable for testing
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as fc from 'fast-check';
import { createProgram } from '../../src/cli';
import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';

// ---------------------------------------------------------------------------
// Import the utility function under test.
// This import WILL FAIL until the module is created (RED phase).
// ---------------------------------------------------------------------------
import { toggleSentinelEnabled } from '../../src/config/toggle-enabled';

// ---------------------------------------------------------------------------
// Module mocks for hook handlers (needed by createProgram)
// ---------------------------------------------------------------------------
jest.mock('../../src/hook/user-prompt-submit-handler', () => ({
  handleUserPromptSubmit: jest.fn(),
}));

jest.mock('../../src/hook/stop-hook-handler', () => ({
  handleStop: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-enable-test-'));
}

/**
 * Write a settings.json file into the temp directory with the given content.
 */
function writeSettings(content: Record<string, unknown>): string {
  const filePath = path.join(tempDir, 'settings.json');
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  return filePath;
}

/**
 * Read and parse the settings.json file from the temp directory.
 */
function readSettings(): Record<string, unknown> {
  const filePath = path.join(tempDir, 'settings.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Check if settings.json exists in the temp directory.
 */
function settingsFileExists(): boolean {
  return fs.existsSync(path.join(tempDir, 'settings.json'));
}

/**
 * Parse a Commander program for the given command args.
 * Matches the pattern used in cli.test.ts.
 */
async function runCommand(
  args: string[],
  deps: {
    sqliteStore: SqliteStore;
    vectorStore: VectorStore;
    llmProvider: MockLLMProvider;
    configDir?: string;
  },
): Promise<{ output: string; errorOutput: string; exitCode?: number }> {
  let output = '';
  let errorOutput = '';
  let exitCode: number | undefined;

  const program = createProgram({
    sqliteStore: deps.sqliteStore,
    vectorStore: deps.vectorStore,
    llmProvider: deps.llmProvider,
    configDir: deps.configDir,
  } as any);

  program.exitOverride();
  program.configureOutput({
    writeOut: (str: string) => {
      output += str;
    },
    writeErr: (str: string) => {
      errorOutput += str;
    },
  });

  try {
    await program.parseAsync(['node', 'sentinel', ...args]);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'exitCode' in err) {
      exitCode = (err as { exitCode: number }).exitCode;
    }
  }

  return { output, errorOutput, exitCode };
}

// ===========================================================================
// 1. toggleSentinelEnabled() utility — core logic
// ===========================================================================
describe('toggleSentinelEnabled utility', () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Basic enable/disable operations
  // -------------------------------------------------------------------------
  describe('basic operations', () => {
    it('should set enabled to false when disabling', () => {
      // Arrange: create a settings file with enabled: true
      writeSettings({
        enabled: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      // Act
      toggleSentinelEnabled(tempDir, false);

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should set enabled to true when enabling', () => {
      // Arrange: create a settings file with enabled: false
      writeSettings({
        enabled: false,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      // Act
      toggleSentinelEnabled(tempDir, true);

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(true);
    });

    it('should be idempotent when disabling an already disabled sentinel', () => {
      // Arrange
      writeSettings({
        enabled: false,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      // Act
      toggleSentinelEnabled(tempDir, false);

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should be idempotent when enabling an already enabled sentinel', () => {
      // Arrange
      writeSettings({
        enabled: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      // Act
      toggleSentinelEnabled(tempDir, true);

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Settings file creation when missing
  // -------------------------------------------------------------------------
  describe('file creation when missing', () => {
    it('should create settings.json with enabled: false when disabling and file does not exist', () => {
      // Arrange: no settings.json exists
      expect(settingsFileExists()).toBe(false);

      // Act
      toggleSentinelEnabled(tempDir, false);

      // Assert: file should be created
      expect(settingsFileExists()).toBe(true);
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should create settings.json with enabled: true when enabling and file does not exist', () => {
      // Arrange: no settings.json exists
      expect(settingsFileExists()).toBe(false);

      // Act
      toggleSentinelEnabled(tempDir, true);

      // Assert
      expect(settingsFileExists()).toBe(true);
      const settings = readSettings();
      expect(settings.enabled).toBe(true);
    });

    it('should create the config directory if it does not exist', () => {
      // Arrange: use a nested path that does not exist
      const nestedDir = path.join(tempDir, 'nested', '.sentinel');
      expect(fs.existsSync(nestedDir)).toBe(false);

      // Act
      toggleSentinelEnabled(nestedDir, false);

      // Assert: directory and file should be created
      expect(fs.existsSync(nestedDir)).toBe(true);
      const filePath = path.join(nestedDir, 'settings.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const settings = JSON.parse(raw);
      expect(settings.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Preserving existing settings (critical requirement)
  // -------------------------------------------------------------------------
  describe('preserving existing settings', () => {
    it('should preserve llm configuration when toggling enabled', () => {
      // Arrange
      writeSettings({
        enabled: true,
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
        storage: { dbPath: '/custom/path/my.db' },
      });

      // Act
      toggleSentinelEnabled(tempDir, false);

      // Assert: all other fields should be preserved
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
      expect((settings.llm as any).provider).toBe('bedrock');
      expect((settings.llm as any).ollama.baseUrl).toBe('http://custom:9999');
      expect((settings.llm as any).ollama.completionModel).toBe('custom-model');
      expect((settings.llm as any).bedrock.region).toBe('ap-northeast-2');
      expect((settings.storage as any).dbPath).toBe('/custom/path/my.db');
    });

    it('should preserve debug flag when toggling enabled', () => {
      // Arrange
      writeSettings({
        enabled: true,
        debug: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      // Act
      toggleSentinelEnabled(tempDir, false);

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.debug).toBe(true);
    });

    it('should preserve recall settings when toggling enabled', () => {
      // Arrange
      writeSettings({
        enabled: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
        recall: { maxAdvicesPerSession: 10 },
      });

      // Act
      toggleSentinelEnabled(tempDir, false);

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
      expect((settings.recall as any).maxAdvicesPerSession).toBe(10);
    });

    it('should preserve unknown/extra fields when toggling enabled', () => {
      // Arrange: settings file has fields the schema does not define
      // The toggle function should preserve them (read-modify-write)
      writeSettings({
        enabled: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
        customField: 'should survive',
        experimental: { feature: true },
      });

      // Act
      toggleSentinelEnabled(tempDir, false);

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.customField).toBe('should survive');
      expect((settings.experimental as any).feature).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Handling malformed settings files
  // -------------------------------------------------------------------------
  describe('handling malformed settings files', () => {
    it('should overwrite with valid JSON when settings.json contains invalid JSON', () => {
      // Arrange: write invalid JSON
      const filePath = path.join(tempDir, 'settings.json');
      fs.writeFileSync(filePath, 'this is not json {{{', 'utf-8');

      // Act: should not throw
      expect(() => toggleSentinelEnabled(tempDir, false)).not.toThrow();

      // Assert: file should now contain valid JSON with enabled: false
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should handle empty settings file gracefully', () => {
      // Arrange
      const filePath = path.join(tempDir, 'settings.json');
      fs.writeFileSync(filePath, '', 'utf-8');

      // Act
      expect(() => toggleSentinelEnabled(tempDir, false)).not.toThrow();

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should handle settings file that is a JSON array', () => {
      // Arrange
      const filePath = path.join(tempDir, 'settings.json');
      fs.writeFileSync(filePath, '[1, 2, 3]', 'utf-8');

      // Act
      expect(() => toggleSentinelEnabled(tempDir, false)).not.toThrow();

      // Assert: should create a valid object with enabled: false
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should handle settings file that is a JSON primitive', () => {
      // Arrange
      const filePath = path.join(tempDir, 'settings.json');
      fs.writeFileSync(filePath, '"just a string"', 'utf-8');

      // Act
      expect(() => toggleSentinelEnabled(tempDir, true)).not.toThrow();

      // Assert
      const settings = readSettings();
      expect(settings.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // JSON formatting
  // -------------------------------------------------------------------------
  describe('output formatting', () => {
    it('should write pretty-printed JSON (not minified)', () => {
      // Arrange
      writeSettings({ enabled: true, llm: { provider: 'ollama', ollama: {} }, storage: {} });

      // Act
      toggleSentinelEnabled(tempDir, false);

      // Assert: output should have newlines (pretty-printed)
      const filePath = path.join(tempDir, 'settings.json');
      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).toContain('\n');
      // Should be valid JSON
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });
});

// ===========================================================================
// 2. sentinel disable — CLI integration
// ===========================================================================
describe('CLI - sentinel disable', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = createTempDir();

    sqliteStore = new SqliteStore(':memory:');
    sqliteStore.initialize();

    vectorStore = new VectorStore(':memory:');
    vectorStore.initialize();

    llmProvider = new MockLLMProvider();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try { sqliteStore.close(); } catch { /* already closed */ }
    try { vectorStore.close(); } catch { /* already closed */ }
  });

  it('should output "Sentinel disabled." confirmation message', async () => {
    // Arrange: create settings file
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    const { output } = await runCommand(['disable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    expect(output).toContain('Sentinel disabled.');
  });

  it('should set enabled to false in settings.json', async () => {
    // Arrange
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    await runCommand(['disable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    const settings = readSettings();
    expect(settings.enabled).toBe(false);
  });

  it('should preserve other settings when disabling', async () => {
    // Arrange
    writeSettings({
      enabled: true,
      debug: true,
      llm: { provider: 'bedrock', ollama: {}, bedrock: { region: 'eu-west-1' } },
      storage: { dbPath: '/custom/path.db' },
      recall: { maxAdvicesPerSession: 3 },
    });

    // Act
    await runCommand(['disable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    const settings = readSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.debug).toBe(true);
    expect((settings.llm as any).provider).toBe('bedrock');
    expect((settings.storage as any).dbPath).toBe('/custom/path.db');
    expect((settings.recall as any).maxAdvicesPerSession).toBe(3);
  });

  it('should create settings.json if it does not exist when disabling', async () => {
    // Arrange: no settings file
    expect(settingsFileExists()).toBe(false);

    // Act
    const { output } = await runCommand(['disable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    expect(settingsFileExists()).toBe(true);
    const settings = readSettings();
    expect(settings.enabled).toBe(false);
    expect(output).toContain('Sentinel disabled.');
  });

  it('should not produce error output on successful disable', async () => {
    // Arrange
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    const { errorOutput } = await runCommand(['disable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    expect(errorOutput).toBe('');
  });
});

// ===========================================================================
// 3. sentinel enable — CLI integration
// ===========================================================================
describe('CLI - sentinel enable', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = createTempDir();

    sqliteStore = new SqliteStore(':memory:');
    sqliteStore.initialize();

    vectorStore = new VectorStore(':memory:');
    vectorStore.initialize();

    llmProvider = new MockLLMProvider();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try { sqliteStore.close(); } catch { /* already closed */ }
    try { vectorStore.close(); } catch { /* already closed */ }
  });

  it('should output "Sentinel enabled." confirmation message', async () => {
    // Arrange
    writeSettings({
      enabled: false,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    const { output } = await runCommand(['enable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    expect(output).toContain('Sentinel enabled.');
  });

  it('should set enabled to true in settings.json', async () => {
    // Arrange
    writeSettings({
      enabled: false,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    await runCommand(['enable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    const settings = readSettings();
    expect(settings.enabled).toBe(true);
  });

  it('should preserve other settings when enabling', async () => {
    // Arrange
    writeSettings({
      enabled: false,
      debug: true,
      llm: { provider: 'bedrock', ollama: {}, bedrock: { region: 'us-west-2' } },
      storage: { dbPath: '/special/path.db' },
      recall: { maxAdvicesPerSession: 7 },
    });

    // Act
    await runCommand(['enable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    const settings = readSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.debug).toBe(true);
    expect((settings.llm as any).provider).toBe('bedrock');
    expect((settings.storage as any).dbPath).toBe('/special/path.db');
    expect((settings.recall as any).maxAdvicesPerSession).toBe(7);
  });

  it('should create settings.json if it does not exist when enabling', async () => {
    // Arrange
    expect(settingsFileExists()).toBe(false);

    // Act
    const { output } = await runCommand(['enable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    expect(settingsFileExists()).toBe(true);
    const settings = readSettings();
    expect(settings.enabled).toBe(true);
    expect(output).toContain('Sentinel enabled.');
  });

  it('should not produce error output on successful enable', async () => {
    // Arrange
    writeSettings({
      enabled: false,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    const { errorOutput } = await runCommand(['enable'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert
    expect(errorOutput).toBe('');
  });
});

// ===========================================================================
// 4. sentinel status — enabled/disabled display
// ===========================================================================
describe('CLI - sentinel status with enabled/disabled display', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = createTempDir();

    sqliteStore = new SqliteStore(':memory:');
    sqliteStore.initialize();

    vectorStore = new VectorStore(':memory:');
    vectorStore.initialize();

    llmProvider = new MockLLMProvider();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try { sqliteStore.close(); } catch { /* already closed */ }
    try { vectorStore.close(); } catch { /* already closed */ }
  });

  it('should display "enabled" in status output when sentinel is enabled', async () => {
    // Arrange: create settings with enabled: true
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    const { output } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert: output should indicate enabled state
    // Accept patterns like "Status: enabled", "Enabled: true", "enabled" etc.
    const lower = output.toLowerCase();
    expect(lower).toMatch(/enabled/);
  });

  it('should display "disabled" in status output when sentinel is disabled', async () => {
    // Arrange: create settings with enabled: false
    writeSettings({
      enabled: false,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    const { output } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert: output should indicate disabled state
    const lower = output.toLowerCase();
    expect(lower).toMatch(/disabled/);
  });

  it('should still show experience and draft counts alongside enabled status', async () => {
    // Arrange
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });
    sqliteStore.storeExperience({
      id: 'exp-status-001',
      frustrationSignature: 'Test error',
      failedApproaches: [],
      lessons: [],
      createdAt: '2026-02-18T10:00:00Z',
    });

    // Act
    const { output } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert: should contain both enabled status AND experience count
    const lower = output.toLowerCase();
    expect(lower).toMatch(/enabled/);
    expect(output).toContain('1'); // experience count
    expect(lower).toMatch(/experience|draft/); // descriptive label
  });
});

// ===========================================================================
// 5. Edge cases
// ===========================================================================
describe('enable/disable edge cases', () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle rapid enable/disable toggling without corruption', () => {
    // Arrange
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act: rapid toggling
    toggleSentinelEnabled(tempDir, false);
    toggleSentinelEnabled(tempDir, true);
    toggleSentinelEnabled(tempDir, false);
    toggleSentinelEnabled(tempDir, true);
    toggleSentinelEnabled(tempDir, false);

    // Assert: final state should be false
    const settings = readSettings();
    expect(settings.enabled).toBe(false);
    // File should still be valid JSON
    const filePath = path.join(tempDir, 'settings.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('should handle settings file with only enabled field', () => {
    // Arrange: minimal settings file
    writeSettings({ enabled: true });

    // Act
    toggleSentinelEnabled(tempDir, false);

    // Assert
    const settings = readSettings();
    expect(settings.enabled).toBe(false);
  });

  it('should handle settings file that is an empty object', () => {
    // Arrange
    writeSettings({});

    // Act
    toggleSentinelEnabled(tempDir, false);

    // Assert
    const settings = readSettings();
    expect(settings.enabled).toBe(false);
  });

  it('should never throw regardless of file system state', () => {
    // The utility should handle errors gracefully (like loadSettings)
    expect(() => toggleSentinelEnabled(tempDir, false)).not.toThrow();
    expect(() => toggleSentinelEnabled(tempDir, true)).not.toThrow();

    // With non-existent nested path
    const deepPath = path.join(tempDir, 'a', 'b', 'c', '.sentinel');
    expect(() => toggleSentinelEnabled(deepPath, false)).not.toThrow();
  });

  it('should preserve file encoding as UTF-8', () => {
    // Arrange: settings with unicode characters (e.g., in custom paths)
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: { dbPath: '/home/user/sentinel-data' },
    });

    // Act
    toggleSentinelEnabled(tempDir, false);

    // Assert
    const filePath = path.join(tempDir, 'settings.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw);
    expect(parsed.storage.dbPath).toBe('/home/user/sentinel-data');
  });
});

// ===========================================================================
// 6. Property tests — round-trip settings preservation via fast-check
// ===========================================================================
describe('Property: toggleSentinelEnabled preserves all non-enabled fields', () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should preserve arbitrary string fields in the settings object', () => {
    fc.assert(
      fc.property(
        // Generate random key-value pairs (excluding 'enabled')
        fc.dictionary(
          fc.string({ minLength: 1 }).filter((k) => k !== 'enabled'),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
        ),
        fc.boolean(),
        (extraFields, targetEnabled) => {
          // Arrange: write settings with extra fields and enabled: !targetEnabled
          const original = { enabled: !targetEnabled, ...extraFields };
          writeSettings(original);

          // Act
          toggleSentinelEnabled(tempDir, targetEnabled);

          // Assert: enabled should be toggled, all other fields preserved
          const result = readSettings();
          expect(result.enabled).toBe(targetEnabled);
          for (const [key, value] of Object.entries(extraFields)) {
            expect(result[key]).toEqual(value);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('should always produce valid JSON after any toggle operation', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (enabled) => {
          // Arrange: no file exists
          const localDir = createTempDir();
          try {
            // Act
            toggleSentinelEnabled(localDir, enabled);

            // Assert: file should contain valid JSON
            const filePath = path.join(localDir, 'settings.json');
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            expect(parsed.enabled).toBe(enabled);
          } finally {
            fs.rmSync(localDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  it('should satisfy: disable then enable is equivalent to just setting enabled: true', () => {
    fc.assert(
      fc.property(
        fc.record({
          debug: fc.boolean(),
          provider: fc.constantFrom('ollama', 'bedrock'),
        }),
        ({ debug, provider }) => {
          // Arrange
          const original = {
            enabled: true,
            debug,
            llm: { provider, ollama: {} },
            storage: {},
          };
          writeSettings(original);

          // Act: disable then enable
          toggleSentinelEnabled(tempDir, false);
          toggleSentinelEnabled(tempDir, true);

          // Assert: should be equivalent to original
          const result = readSettings();
          expect(result.enabled).toBe(true);
          expect(result.debug).toBe(debug);
          expect((result.llm as any).provider).toBe(provider);
        },
      ),
      { numRuns: 10 },
    );
  });
});
