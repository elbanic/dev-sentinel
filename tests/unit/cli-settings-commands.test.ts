/**
 * Unit Tests for CLI Settings-Related Commands
 *
 * This file consolidates all settings-related CLI integration tests:
 *   1. `sentinel status` — DB statistics display (from cli.test.ts)
 *   2. `sentinel enable` — CLI integration (from cli-enable-disable.test.ts)
 *   3. `sentinel disable` — CLI integration (from cli-enable-disable.test.ts)
 *   4. `sentinel status` — enabled/disabled display (from cli-enable-disable.test.ts)
 *   5. `sentinel status` — persistent error warnings (NEW)
 *
 * Testing strategy:
 *   - Uses shared helpers from cli-test-helpers (runCommand, makeCandidate, etc.)
 *   - Real SqliteStore with :memory: DB for full round-trip verification
 *   - MockLLMProvider for deterministic embeddings
 *   - Temp directories for settings file manipulation
 */

import * as fs from 'fs';
import * as path from 'path';
import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import {
  runCommand,
  makeCandidate,
  createTestDeps,
  cleanupDeps,
  createTempDir,
} from '../helpers/cli-test-helpers';

// ---------------------------------------------------------------------------
// Helpers for settings file manipulation
// ---------------------------------------------------------------------------

let tempDir: string;

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

// ===========================================================================
// 1. sentinel status — DB statistics
// ===========================================================================
describe('status', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    const deps = createTestDeps();
    sqliteStore = deps.sqliteStore;
    vectorStore = deps.vectorStore;
    llmProvider = deps.llmProvider;
  });

  afterEach(() => {
    cleanupDeps({ sqliteStore, vectorStore, llmProvider });
  });

  it('should display zero counts when database is empty', async () => {
    // Arrange: fresh empty database

    // Act
    const { output } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
    });

    // Assert: output should contain "0" for counts
    expect(output).toContain('0');
  });

  it('should display correct count of stored experiences', async () => {
    // Arrange: store some experiences
    sqliteStore.storeExperience({
      id: 'exp-001',
      frustrationSignature: 'Error A',
      failedApproaches: ['approach'],
      successfulApproach: 'fix',
      lessons: ['lesson'],
      createdAt: '2026-02-16T12:00:00Z',
      revision: 1,
    });
    sqliteStore.storeExperience({
      id: 'exp-002',
      frustrationSignature: 'Error B',
      failedApproaches: [],
      lessons: [],
      createdAt: '2026-02-16T12:01:00Z',
      revision: 1,
    });

    // Act
    const { output } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
    });

    // Assert: output should mention "2" experiences (or "Experiences: 2")
    expect(output).toContain('2');
  });

  it('should display the count of pending drafts', async () => {
    // Arrange
    sqliteStore.storeCandidate(makeCandidate({ id: 'draft-stat-1' }));
    sqliteStore.storeCandidate(makeCandidate({ id: 'draft-stat-2' }));
    sqliteStore.storeCandidate(makeCandidate({ id: 'draft-stat-3' }));

    // Act
    const { output } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
    });

    // Assert: should mention 3 pending drafts
    expect(output).toContain('3');
  });

  it('should display the word "experience" or "draft" in the output', async () => {
    // Arrange: empty DB

    // Act
    const { output } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
    });

    // Assert: the output should have descriptive labels
    const lowerOutput = output.toLowerCase();
    expect(
      lowerOutput.includes('experience') || lowerOutput.includes('draft') || lowerOutput.includes('pending'),
    ).toBe(true);
  });
});

// ===========================================================================
// 2. sentinel enable — CLI integration
// ===========================================================================
describe('CLI - sentinel enable', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = createTempDir();

    const deps = createTestDeps();
    sqliteStore = deps.sqliteStore;
    vectorStore = deps.vectorStore;
    llmProvider = deps.llmProvider;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    cleanupDeps({ sqliteStore, vectorStore, llmProvider });
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
// 3. sentinel disable — CLI integration
// ===========================================================================
describe('CLI - sentinel disable', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = createTempDir();

    const deps = createTestDeps();
    sqliteStore = deps.sqliteStore;
    vectorStore = deps.vectorStore;
    llmProvider = deps.llmProvider;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    cleanupDeps({ sqliteStore, vectorStore, llmProvider });
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
// 4. sentinel status — enabled/disabled display
// ===========================================================================
describe('CLI - sentinel status with enabled/disabled display', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = createTempDir();

    const deps = createTestDeps();
    sqliteStore = deps.sqliteStore;
    vectorStore = deps.vectorStore;
    llmProvider = deps.llmProvider;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    cleanupDeps({ sqliteStore, vectorStore, llmProvider });
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
      revision: 1,
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
// 5. sentinel status — persistent error warnings
//
// These tests use (sqliteStore as any) to call recordHookError, which does not
// exist on SqliteStore yet. This allows the test FILE to compile so existing
// tests above are not broken, while the new tests themselves fail at runtime
// (RED phase).
// ===========================================================================
describe('status - persistent error warnings', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = createTempDir();

    const deps = createTestDeps();
    sqliteStore = deps.sqliteStore;
    vectorStore = deps.vectorStore;
    llmProvider = deps.llmProvider;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    cleanupDeps({ sqliteStore, vectorStore, llmProvider });
  });

  it('should NOT display warnings when no persistent errors exist', async () => {
    // Arrange: empty DB, no errors recorded
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

    // Assert: output should NOT contain 'Warning'
    expect(output).not.toMatch(/Warning/i);
  });

  it('should display warning when persistent errors exist for a component', async () => {
    // Arrange: record 5 errors for 'llm' to exceed threshold
    // Cast to any since recordHookError does not exist yet on SqliteStore
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });
    const store = sqliteStore as any;
    store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');
    store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');
    store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');
    store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');
    store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');

    // Act
    const { output } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert: output should contain warning with component name and error detail
    expect(output).toMatch(/Warning/i);
    expect(output).toMatch(/LLM provider/i);
    expect(output).toContain('connection refused');
  });

  it('should not crash when there are zero errors (exit code should be clean)', async () => {
    // Arrange: no errors, just an empty DB with valid settings
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    // Act
    const { output, exitCode } = await runCommand(['status'], {
      sqliteStore,
      vectorStore,
      llmProvider,
      configDir: tempDir,
    });

    // Assert: should succeed with clean exit
    // exitCode is undefined (no error thrown) or 0
    expect(exitCode === undefined || exitCode === 0).toBe(true);
    // Should still display basic status info
    expect(output.length).toBeGreaterThan(0);
  });
});
