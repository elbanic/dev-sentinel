/**
 * Integration Tests for Dev Sentinel Pipeline (Phase 7.3)
 *
 * These tests exercise the full pipeline across multiple modules using REAL
 * stores (SQLite :memory:) and a SmartMockLLMProvider that returns structured
 * JSON responses. No Ollama dependency is required.
 *
 * Scenarios:
 *   1. Active Recall: seed DB -> matching prompt -> systemMessage returned
 *   2. Flag lifecycle: frustrated -> resolution -> Stop hook -> draft created
 *   3. Frustrated -> abandonment -> Stop hook -> draft created
 *   4. Frustrated -> Stop fires while still 'frustrated' -> NO draft
 *   5. CLI review confirm -> experience + vector stored
 *   6. sentinel init -> hook config + settings files
 *   7. Graceful degradation: LLM down -> silent pass-through
 *
 * All tests use :memory: SQLite databases and temp files for transcripts.
 * No mocks of internal modules -- only the LLM provider is controlled.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import { handleUserPromptSubmit } from '../../src/hook/user-prompt-submit-handler';
import { handleStop } from '../../src/hook/stop-hook-handler';
import { createProgram } from '../../src/cli';
import { initCommand } from '../../src/cli/init-command';
import type { LLMProvider, FailureExperience, AutoMemoryCandidate } from '../../src/types/index';

// ---------------------------------------------------------------------------
// SmartMockLLMProvider: extends MockLLMProvider to return structured JSON
// responses in a predetermined sequence.
// ---------------------------------------------------------------------------

class SmartMockLLMProvider extends MockLLMProvider {
  private completionResponses: string[] = [];
  private completionIndex = 0;

  constructor(responses?: string[]) {
    super();
    if (responses) {
      this.completionResponses = responses;
    }
  }

  async generateCompletion(system: string, user: string): Promise<string> {
    this.calls.push({ method: 'generateCompletion', args: [system, user] });
    if (this.completionIndex < this.completionResponses.length) {
      return this.completionResponses[this.completionIndex++];
    }
    return super.generateCompletion(system, user);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary JSONL transcript file with errors so that the
 * transcript parser and note generator produce a valid candidate.
 *
 * The transcript includes: user message, assistant message, tool_use,
 * tool_result with error, and a final assistant message.
 */
function createTranscriptFile(dir: string): string {
  const lines = [
    JSON.stringify({
      type: 'human',
      message: { role: 'user', content: 'Why does this keep failing?' },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'Let me investigate the issue.' },
    }),
    JSON.stringify({
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'npm test' },
    }),
    JSON.stringify({
      type: 'tool_result',
      name: 'Bash',
      output: 'Error: test failed with exit code 1',
      error: 'Error: test failed with exit code 1',
      is_error: true,
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: 'I found the issue. The configuration was missing a required field. I have added the missing field and the tests should pass now.',
      },
    }),
  ];

  const filePath = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

/**
 * Build an experience factory.
 */
function makeExperience(overrides: Partial<FailureExperience> = {}): FailureExperience {
  return {
    id: 'exp-seed-001',
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried adding null check', 'Tried optional chaining'],
    successfulApproach: 'Initialized the variable before use',
    lessons: ['Always check initialization order'],
    createdAt: '2026-02-15T10:00:00Z',
    revision: 1,
    ...overrides,
  };
}

/**
 * Build a candidate factory.
 */
function makeCandidate(overrides: Partial<AutoMemoryCandidate> = {}): AutoMemoryCandidate {
  return {
    id: 'draft-int-001',
    sessionId: 'session-int-001',
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried adding null check'],
    successfulApproach: 'Initialized the variable before use',
    lessons: ['Always check initialization order'],
    status: 'pending',
    createdAt: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

/**
 * Build the embedding text for a candidate (same formula as cli.ts review confirm).
 */
function buildEmbeddingText(candidate: AutoMemoryCandidate | FailureExperience): string {
  const failed = ('failedApproaches' in candidate ? candidate.failedApproaches : []).join('; ');
  const fixed = candidate.successfulApproach ?? '';
  const lessons = candidate.lessons.join('; ');
  return `${candidate.frustrationSignature}. Failed: ${failed}. Fixed: ${fixed}. Lessons: ${lessons}`;
}

/**
 * Run a Commander program and capture output.
 */
async function runCommand(
  args: string[],
  deps: {
    sqliteStore: SqliteStore;
    vectorStore: VectorStore;
    llmProvider: LLMProvider;
    stdinData?: string;
  },
): Promise<{ output: string; errorOutput: string }> {
  let output = '';
  let errorOutput = '';

  const program = createProgram({
    sqliteStore: deps.sqliteStore,
    vectorStore: deps.vectorStore,
    llmProvider: deps.llmProvider,
    stdin: deps.stdinData,
  });

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
  } catch {
    // Commander throws CommanderError on exitOverride
  }

  return { output, errorOutput };
}

// ===========================================================================
// Test Suite
// ===========================================================================

describe('Integration: Pipeline End-to-End', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let tmpDir: string;

  beforeEach(() => {
    // Real in-memory SQLite databases
    sqliteStore = new SqliteStore(':memory:');
    sqliteStore.initialize();

    vectorStore = new VectorStore(':memory:');
    vectorStore.initialize();

    // Temp directory for transcript files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-int-'));
  });

  afterEach(() => {
    try {
      sqliteStore.close();
    } catch {
      // Already closed
    }
    try {
      vectorStore.close();
    } catch {
      // Already closed
    }
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // =========================================================================
  // Scenario 1: Active Recall -- seed DB -> matching prompt -> systemMessage
  // =========================================================================
  describe('Scenario 1: Active Recall', () => {
    it('should return a systemMessage when a frustrated prompt matches a seeded experience', async () => {
      // Arrange: seed an experience in SQLite
      const experience = makeExperience({
        id: 'exp-recall-001',
        frustrationSignature: 'TypeError: Cannot read properties of undefined',
        failedApproaches: ['Tried adding null check'],
        successfulApproach: 'Initialized the variable before use',
        lessons: ['Always check initialization order'],
      });
      sqliteStore.storeExperience(experience);

      // Seed the corresponding embedding in VectorStore
      // Use the same text that review confirm would generate
      const embeddingText = buildEmbeddingText(experience);
      const mockProvider = new MockLLMProvider();
      const embedding = await mockProvider.generateEmbedding(embeddingText);
      vectorStore.store(experience.id, embedding, {
        frustrationSignature: experience.frustrationSignature,
      });

      // SmartMock: frustration analysis -> frustrated, RAG judge -> relevant
      const smartProvider = new SmartMockLLMProvider([
        // Call 1: frustration analysis
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'user is frustrated',
        }),
        // Call 2: RAG judge
        JSON.stringify({
          relevant: true,
          confidence: 0.85,
          reasoning: 'same error pattern',
          suggestedAction: 'Try initializing the variable before use. Check initialization order.',
        }),
      ]);

      // Act: submit a prompt similar to the seeded experience
      // The prompt needs to produce an embedding similar to the seeded one.
      // Since MockLLMProvider uses a deterministic hash, we use the same text
      // to guarantee the vector search finds a match.
      const result = await handleUserPromptSubmit({
        prompt: embeddingText,
        sessionId: 'session-recall-001',
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Assert: result should contain a systemMessage with the suggestedAction
      const parsed = JSON.parse(result);
      expect(parsed.systemMessage).toBeDefined();
      expect(parsed.systemMessage).toContain('Try initializing the variable before use');
    });

    it('should set the session flag to frustrated during active recall', async () => {
      // Arrange
      const experience = makeExperience({ id: 'exp-recall-002' });
      sqliteStore.storeExperience(experience);
      const embeddingText = buildEmbeddingText(experience);
      const mockEmbedder = new MockLLMProvider();
      const embedding = await mockEmbedder.generateEmbedding(embeddingText);
      vectorStore.store(experience.id, embedding, {
        frustrationSignature: experience.frustrationSignature,
      });

      const smartProvider = new SmartMockLLMProvider([
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'frustrated',
        }),
        JSON.stringify({
          relevant: true,
          confidence: 0.85,
          reasoning: 'match',
          suggestedAction: 'Initialize variables.',
        }),
      ]);

      // Act
      await handleUserPromptSubmit({
        prompt: embeddingText,
        sessionId: 'session-recall-002',
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Assert: flag should be set to 'frustrated'
      const flag = sqliteStore.getFlag('session-recall-002');
      expect(flag).not.toBeNull();
      expect(flag!.status).toBe('frustrated');
    });

    it('should store the turn in session_turns during active recall', async () => {
      // Arrange
      const experience = makeExperience({ id: 'exp-recall-003' });
      sqliteStore.storeExperience(experience);
      const embeddingText = buildEmbeddingText(experience);
      const mockEmbedder = new MockLLMProvider();
      const embedding = await mockEmbedder.generateEmbedding(embeddingText);
      vectorStore.store(experience.id, embedding, {
        frustrationSignature: experience.frustrationSignature,
      });

      const smartProvider = new SmartMockLLMProvider([
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'frustrated',
        }),
        JSON.stringify({
          relevant: true,
          confidence: 0.85,
          reasoning: 'match',
          suggestedAction: 'Fix it.',
        }),
      ]);

      // Act
      await handleUserPromptSubmit({
        prompt: embeddingText,
        sessionId: 'session-recall-003',
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Assert
      const turns = sqliteStore.getTurnsBySession('session-recall-003');
      expect(turns.length).toBe(1);
      expect(turns[0].prompt).toBe(embeddingText);
      const analysis = JSON.parse(turns[0].analysis);
      expect(analysis.type).toBe('frustrated');
    });
  });

  // =========================================================================
  // Scenario 2: Flag lifecycle -- frustrated -> resolution -> Stop hook
  // =========================================================================
  describe('Scenario 2: Flag lifecycle (frustrated -> resolution -> Stop)', () => {
    it('should create a draft through the full frustrated -> resolution -> Stop pipeline', async () => {
      const transcriptPath = createTranscriptFile(tmpDir);

      // SmartMock responses:
      // Call 1: frustration analysis for frustrated prompt
      // Call 2: frustration analysis for resolution prompt
      // Call 3: lesson summarization for note generation (from Stop hook)
      const smartProvider = new SmartMockLLMProvider([
        // Call 1: frustrated
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'user is frustrated',
        }),
        // Call 2: resolution
        JSON.stringify({
          type: 'resolution',
          confidence: 0.8,
          reasoning: 'user found a fix',
        }),
        // Call 3: lesson summarization (used by generateNote)
        JSON.stringify({
          frustrationSignature: 'Test failure due to missing config',
          failedApproaches: ['Ran tests without setup'],
          successfulApproach: 'Added missing configuration field',
          lessons: ['Always verify config before running tests'],
        }),
      ]);

      const sessionId = 'session-lifecycle-001';

      // Step 1: Submit frustrated prompt
      const result1 = await handleUserPromptSubmit({
        prompt: 'Why does this test keep failing?!',
        sessionId,
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Verify: flag should be set to 'frustrated'
      const flag1 = sqliteStore.getFlag(sessionId);
      expect(flag1).not.toBeNull();
      expect(flag1!.status).toBe('frustrated');

      // Step 2: Submit resolution prompt
      const result2 = await handleUserPromptSubmit({
        prompt: 'It works now, I found the missing config.',
        sessionId,
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Verify: flag should be upgraded to 'capture'
      const flag2 = sqliteStore.getFlag(sessionId);
      expect(flag2).not.toBeNull();
      expect(flag2!.status).toBe('capture');

      // Step 3: Fire Stop hook
      const stopResult = await handleStop({
        sessionId,
        transcriptPath,
        llmProvider: smartProvider,
        sqliteStore,
      });

      // Verify: Stop hook always returns approve
      expect(stopResult).toBe('{"decision":"approve"}');

      // Verify: a candidate draft was created
      const drafts = sqliteStore.getPendingDrafts();
      const sessionDrafts = drafts.filter((d) => d.sessionId === sessionId);
      expect(sessionDrafts.length).toBe(1);
      expect(sessionDrafts[0].status).toBe('pending');

      // Verify: flag is cleared after Stop
      const flag3 = sqliteStore.getFlag(sessionId);
      expect(flag3).toBeNull();
    });

    it('should store exactly 2 turns for the frustrated + resolution prompts', async () => {
      const transcriptPath = createTranscriptFile(tmpDir);

      const smartProvider = new SmartMockLLMProvider([
        JSON.stringify({ type: 'frustrated', confidence: 0.9, reasoning: 'frustrated' }),
        JSON.stringify({ type: 'resolution', confidence: 0.8, reasoning: 'resolved' }),
        JSON.stringify({
          frustrationSignature: 'Error X',
          failedApproaches: ['Approach A'],
          successfulApproach: 'Approach B',
          lessons: ['Lesson 1'],
        }),
      ]);

      const sessionId = 'session-lifecycle-002';

      await handleUserPromptSubmit({
        prompt: 'Frustrated prompt!',
        sessionId,
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      await handleUserPromptSubmit({
        prompt: 'Resolution prompt.',
        sessionId,
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Assert: 2 turns stored
      const turns = sqliteStore.getTurnsBySession(sessionId);
      expect(turns.length).toBe(2);
    });
  });

  // =========================================================================
  // Scenario 3: Frustrated -> abandonment -> Stop hook -> draft created
  // =========================================================================
  describe('Scenario 3: Frustrated -> abandonment -> Stop -> draft', () => {
    it('should create a draft through frustrated -> abandonment -> Stop pipeline', async () => {
      const transcriptPath = createTranscriptFile(tmpDir);

      const smartProvider = new SmartMockLLMProvider([
        // Call 1: frustrated
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'user is frustrated',
        }),
        // Call 2: abandonment
        JSON.stringify({
          type: 'abandonment',
          confidence: 0.85,
          reasoning: 'user is giving up on this approach',
        }),
        // Call 3: lesson summarization
        JSON.stringify({
          frustrationSignature: 'Build error in module X',
          failedApproaches: ['Tried clearing cache'],
          successfulApproach: null,
          lessons: ['Consider a different build tool'],
        }),
      ]);

      const sessionId = 'session-abandon-001';

      // Step 1: frustrated prompt
      await handleUserPromptSubmit({
        prompt: 'This build keeps failing!',
        sessionId,
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      const flag1 = sqliteStore.getFlag(sessionId);
      expect(flag1!.status).toBe('frustrated');

      // Step 2: abandonment prompt
      await handleUserPromptSubmit({
        prompt: 'Forget it, I will try a completely different approach.',
        sessionId,
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      const flag2 = sqliteStore.getFlag(sessionId);
      expect(flag2!.status).toBe('capture');

      // Step 3: Stop hook
      const stopResult = await handleStop({
        sessionId,
        transcriptPath,
        llmProvider: smartProvider,
        sqliteStore,
      });

      expect(stopResult).toBe('{"decision":"approve"}');

      // Verify: draft created
      const drafts = sqliteStore.getPendingDrafts();
      const sessionDrafts = drafts.filter((d) => d.sessionId === sessionId);
      expect(sessionDrafts.length).toBe(1);

      // Verify: flag cleared
      const flag3 = sqliteStore.getFlag(sessionId);
      expect(flag3).toBeNull();
    });
  });

  // =========================================================================
  // Scenario 4: Frustrated -> Stop fires while still 'frustrated' -> NO draft
  // =========================================================================
  describe('Scenario 4: Frustrated -> Stop while still frustrated -> NO draft', () => {
    it('should NOT create a draft when Stop fires while flag is still frustrated', async () => {
      const transcriptPath = createTranscriptFile(tmpDir);

      const smartProvider = new SmartMockLLMProvider([
        // Call 1: frustrated
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'user is frustrated',
        }),
      ]);

      const sessionId = 'session-no-draft-001';

      // Step 1: frustrated prompt -> flag = 'frustrated'
      await handleUserPromptSubmit({
        prompt: 'This error is driving me crazy!',
        sessionId,
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      const flag = sqliteStore.getFlag(sessionId);
      expect(flag).not.toBeNull();
      expect(flag!.status).toBe('frustrated');

      // Step 2: Fire Stop hook immediately (no resolution/abandonment)
      const stopResult = await handleStop({
        sessionId,
        transcriptPath,
        llmProvider: smartProvider,
        sqliteStore,
      });

      // Assert: Stop returns approve
      expect(stopResult).toBe('{"decision":"approve"}');

      // Assert: NO draft created (flag is 'frustrated', not 'capture')
      const drafts = sqliteStore.getPendingDrafts();
      const sessionDrafts = drafts.filter((d) => d.sessionId === sessionId);
      expect(sessionDrafts.length).toBe(0);

      // Assert: flag is NOT cleared (only cleared when status is 'capture')
      const flagAfterStop = sqliteStore.getFlag(sessionId);
      expect(flagAfterStop).not.toBeNull();
      expect(flagAfterStop!.status).toBe('frustrated');
    });
  });

  // =========================================================================
  // Scenario 5: CLI review confirm -> experience + vector stored
  // =========================================================================
  describe('Scenario 5: CLI review confirm -> experience + vector stored', () => {
    it('should store an experience and embedding when confirming a draft via CLI', async () => {
      // Arrange: seed a pending candidate
      const candidate = makeCandidate({
        id: 'draft-confirm-int-001',
        sessionId: 'session-confirm-int',
        frustrationSignature: 'ENOENT: no such file or directory',
        failedApproaches: ['Checked wrong directory'],
        successfulApproach: 'Used path.resolve()',
        lessons: ['Always use absolute paths'],
      });
      sqliteStore.storeCandidate(candidate);

      const llmProvider = new MockLLMProvider();

      // Act: run CLI review confirm
      const { output } = await runCommand(
        ['review', 'confirm', 'draft-confirm-int-001'],
        { sqliteStore, vectorStore, llmProvider },
      );

      // Assert: experience stored in SQLite
      const experience = sqliteStore.getExperience('draft-confirm-int-001');
      expect(experience).not.toBeNull();
      expect(experience!.id).toBe('draft-confirm-int-001');
      expect(experience!.frustrationSignature).toBe('ENOENT: no such file or directory');
      expect(experience!.failedApproaches).toEqual(['Checked wrong directory']);
      expect(experience!.successfulApproach).toBe('Used path.resolve()');
      expect(experience!.lessons).toEqual(['Always use absolute paths']);

      // Assert: embedding stored in VectorStore
      const embeddingText = buildEmbeddingText(candidate);
      const queryEmbedding = await llmProvider.generateEmbedding(embeddingText);
      const searchResults = vectorStore.search(queryEmbedding, 1, 0.99);
      expect(searchResults.length).toBeGreaterThanOrEqual(1);
      expect(searchResults[0].id).toBe('draft-confirm-int-001');

      // Assert: candidate removed from pending
      const pendingDrafts = sqliteStore.getPendingDrafts();
      expect(pendingDrafts.find((d) => d.id === 'draft-confirm-int-001')).toBeUndefined();

      // Assert: success message
      expect(output.toLowerCase()).toContain('confirmed');
    });

    it('should make the confirmed experience findable by Active Recall', async () => {
      // Arrange: seed + confirm a draft
      const candidate = makeCandidate({
        id: 'draft-findable-001',
        frustrationSignature: 'Connection refused on port 5432',
        failedApproaches: ['Checked firewall'],
        successfulApproach: 'Started the database service',
        lessons: ['Ensure database service is running before connecting'],
      });
      sqliteStore.storeCandidate(candidate);

      const llmProvider = new MockLLMProvider();

      // Confirm the draft
      await runCommand(['review', 'confirm', 'draft-findable-001'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Now create a SmartMock for active recall
      const smartProvider = new SmartMockLLMProvider([
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'user is frustrated',
        }),
        JSON.stringify({
          relevant: true,
          confidence: 0.9,
          reasoning: 'same database connection issue',
          suggestedAction: 'Start the database service before connecting.',
        }),
      ]);

      // Use the same embedding text as a prompt (guarantees vector match)
      const embeddingText = buildEmbeddingText(candidate);

      // Act: submit a matching prompt
      const result = await handleUserPromptSubmit({
        prompt: embeddingText,
        sessionId: 'session-findable-001',
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Assert: systemMessage should be returned
      const parsed = JSON.parse(result);
      expect(parsed.systemMessage).toBeDefined();
      expect(parsed.systemMessage).toContain('Start the database service');
    });
  });

  // =========================================================================
  // Scenario 6: sentinel init -> hook config + settings files
  // =========================================================================
  describe('Scenario 6: sentinel init -> files created correctly', () => {
    let initProjectDir: string;
    let initHomeDir: string;

    beforeEach(() => {
      initProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-init-proj-'));
      initHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-init-home-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(initProjectDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
      try {
        fs.rmSync(initHomeDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it('should create .claude/settings.local.json with hook configuration', async () => {
      // Act
      const result = await initCommand({
        projectDir: initProjectDir,
        homeDir: initHomeDir,
      });

      // Assert: file exists
      const settingsPath = path.join(initProjectDir, '.claude', 'settings.local.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      // Assert: contains hook configuration
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();

      // Assert: UserPromptSubmit hook contains sentinel command
      const upsHook = settings.hooks.UserPromptSubmit;
      expect(Array.isArray(upsHook)).toBe(true);
      expect(upsHook.length).toBeGreaterThanOrEqual(1);
      const hasSentinelUPS = upsHook.some(
        (h: any) =>
          Array.isArray(h.hooks) &&
          h.hooks.some((inner: any) => inner.command === 'sentinel --hook user-prompt-submit'),
      );
      expect(hasSentinelUPS).toBe(true);

      // Assert: Stop hook contains sentinel command
      const stopHook = settings.hooks.Stop;
      expect(Array.isArray(stopHook)).toBe(true);
      const hasSentinelStop = stopHook.some(
        (h: any) =>
          Array.isArray(h.hooks) &&
          h.hooks.some((inner: any) => inner.command === 'sentinel --hook stop'),
      );
      expect(hasSentinelStop).toBe(true);

      // Assert: messages include confirmation
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should create ~/.sentinel/ directory and settings.json', async () => {
      // Act
      await initCommand({
        projectDir: initProjectDir,
        homeDir: initHomeDir,
      });

      // Assert: .sentinel directory exists
      const sentinelDir = path.join(initHomeDir, '.sentinel');
      expect(fs.existsSync(sentinelDir)).toBe(true);

      // Assert: settings.json exists with default settings
      const settingsPath = path.join(sentinelDir, 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.llm).toBeDefined();
      expect(settings.llm.provider).toBe('ollama');
    });

    it('should not overwrite existing settings.json', async () => {
      // Arrange: create an existing settings.json
      const sentinelDir = path.join(initHomeDir, '.sentinel');
      fs.mkdirSync(sentinelDir, { recursive: true });
      const existingSettings = { llm: { provider: 'bedrock' }, custom: true };
      fs.writeFileSync(
        path.join(sentinelDir, 'settings.json'),
        JSON.stringify(existingSettings),
        'utf-8',
      );

      // Act
      await initCommand({
        projectDir: initProjectDir,
        homeDir: initHomeDir,
      });

      // Assert: existing settings.json should not be overwritten
      const settingsPath = path.join(sentinelDir, 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.custom).toBe(true);
    });

    it('should not duplicate hooks when run twice', async () => {
      // Act: run init twice
      await initCommand({
        projectDir: initProjectDir,
        homeDir: initHomeDir,
      });
      await initCommand({
        projectDir: initProjectDir,
        homeDir: initHomeDir,
      });

      // Assert: hooks should not be duplicated
      const settingsPath = path.join(initProjectDir, '.claude', 'settings.local.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

      const upsHooks = settings.hooks.UserPromptSubmit.filter(
        (h: any) =>
          Array.isArray(h.hooks) &&
          h.hooks.some((inner: any) => inner.command === 'sentinel --hook user-prompt-submit'),
      );
      expect(upsHooks.length).toBe(1);

      const stopHooks = settings.hooks.Stop.filter(
        (h: any) =>
          Array.isArray(h.hooks) &&
          h.hooks.some((inner: any) => inner.command === 'sentinel --hook stop'),
      );
      expect(stopHooks.length).toBe(1);
    });

    it('should report an Ollama warning when health check fails', async () => {
      // Act
      const result = await initCommand({
        projectDir: initProjectDir,
        homeDir: initHomeDir,
        ollamaHealthCheck: async () => false,
      });

      // Assert
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].toLowerCase()).toContain('ollama');
    });
  });

  // =========================================================================
  // Scenario 7: Graceful degradation -- LLM down -> silent pass-through
  // =========================================================================
  describe('Scenario 7: Graceful degradation (LLM failure)', () => {
    it('should return "{}" from handleUserPromptSubmit when LLM is down', async () => {
      // Arrange: MockLLMProvider in failure mode
      const failingProvider = new MockLLMProvider({ shouldFail: true });

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'This error keeps happening!',
        sessionId: 'session-graceful-001',
        llmProvider: failingProvider,
        sqliteStore,
        vectorStore,
      });

      // Assert: graceful pass-through
      expect(result).toBe('{}');
    });

    it('should return approve from handleStop when LLM is down', async () => {
      const transcriptPath = createTranscriptFile(tmpDir);
      const failingProvider = new MockLLMProvider({ shouldFail: true });

      // Pre-set flag to 'capture' to exercise the full stop path
      sqliteStore.setFlag('session-graceful-002', 'capture');

      // Act
      const result = await handleStop({
        sessionId: 'session-graceful-002',
        transcriptPath,
        llmProvider: failingProvider,
        sqliteStore,
      });

      // Assert: always returns approve
      expect(result).toBe('{"decision":"approve"}');
    });

    it('should not crash handleUserPromptSubmit even with null-like provider', async () => {
      // Act & Assert: never throws
      const result = await handleUserPromptSubmit({
        prompt: 'Some prompt',
        sessionId: 'session-graceful-003',
        llmProvider: null as any,
        sqliteStore,
        vectorStore,
      });

      expect(result).toBe('{}');
    });

    it('should not crash handleStop even with null-like provider', async () => {
      sqliteStore.setFlag('session-graceful-004', 'capture');

      // Act & Assert: never throws
      const result = await handleStop({
        sessionId: 'session-graceful-004',
        transcriptPath: '/nonexistent/path.jsonl',
        llmProvider: null as any,
        sqliteStore,
      });

      expect(result).toBe('{"decision":"approve"}');
    });

    it('should clear the capture flag even when LLM fails during Stop', async () => {
      const transcriptPath = createTranscriptFile(tmpDir);
      const failingProvider = new MockLLMProvider({ shouldFail: true });

      sqliteStore.setFlag('session-graceful-005', 'capture');

      // Act
      await handleStop({
        sessionId: 'session-graceful-005',
        transcriptPath,
        llmProvider: failingProvider,
        sqliteStore,
      });

      // Assert: flag is cleared even when LLM fails
      const flag = sqliteStore.getFlag('session-graceful-005');
      expect(flag).toBeNull();
    });
  });

  // =========================================================================
  // Scenario 8: CLI review reject -> candidate deleted
  // =========================================================================
  describe('Scenario 8: CLI review reject', () => {
    it('should delete the candidate without creating an experience', async () => {
      // Arrange
      const candidate = makeCandidate({
        id: 'draft-reject-int-001',
        sessionId: 'session-reject-int',
      });
      sqliteStore.storeCandidate(candidate);

      const llmProvider = new MockLLMProvider();

      // Act
      const { output } = await runCommand(
        ['review', 'reject', 'draft-reject-int-001'],
        { sqliteStore, vectorStore, llmProvider },
      );

      // Assert: candidate removed
      const drafts = sqliteStore.getPendingDrafts();
      expect(drafts.find((d) => d.id === 'draft-reject-int-001')).toBeUndefined();

      // Assert: no experience created
      const experience = sqliteStore.getExperience('draft-reject-int-001');
      expect(experience).toBeNull();

      // Assert: output indicates rejection
      expect(output.toLowerCase()).toContain('rejected');
    });
  });

  // =========================================================================
  // Scenario 9: CLI review list -> shows pending drafts
  // =========================================================================
  describe('Scenario 9: CLI review list', () => {
    it('should list pending drafts from the database', async () => {
      // Arrange
      sqliteStore.storeCandidate(
        makeCandidate({ id: 'draft-list-001', frustrationSignature: 'Error Alpha' }),
      );
      sqliteStore.storeCandidate(
        makeCandidate({ id: 'draft-list-002', frustrationSignature: 'Error Beta' }),
      );

      const llmProvider = new MockLLMProvider();

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      expect(output).toContain('draft-list-001');
      expect(output).toContain('Error Alpha');
      expect(output).toContain('draft-list-002');
      expect(output).toContain('Error Beta');
    });

    it('should display no pending drafts message when database is empty', async () => {
      const llmProvider = new MockLLMProvider();

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      expect(output.toLowerCase()).toContain('no pending');
    });
  });

  // =========================================================================
  // Scenario 10: CLI status command
  // =========================================================================
  describe('Scenario 10: CLI status', () => {
    it('should show correct counts for experiences and pending drafts', async () => {
      // Arrange
      sqliteStore.storeExperience(makeExperience({ id: 'exp-stat-001' }));
      sqliteStore.storeExperience(makeExperience({ id: 'exp-stat-002' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-stat-001' }));

      const llmProvider = new MockLLMProvider();

      // Act
      const { output } = await runCommand(['status'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      expect(output).toContain('2'); // 2 experiences
      expect(output).toContain('1'); // 1 pending draft
    });
  });

  // =========================================================================
  // Scenario 11: Pending draft notification from other sessions
  // =========================================================================
  describe('Scenario 11: Pending draft notification', () => {
    it('should include pending draft notification in systemMessage when drafts exist from other sessions', async () => {
      // Arrange: create a pending draft from a different session
      sqliteStore.storeCandidate(
        makeCandidate({ id: 'draft-other-001', sessionId: 'other-session' }),
      );

      // SmartMock: normal analysis (not frustrated)
      const smartProvider = new SmartMockLLMProvider([
        JSON.stringify({
          type: 'normal',
          confidence: 0.9,
          reasoning: 'normal prompt',
        }),
      ]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Please add a test for the new feature.',
        sessionId: 'session-notify-001',
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Assert: should contain notification about pending drafts
      const parsed = JSON.parse(result);
      expect(parsed.systemMessage).toBeDefined();
      expect(parsed.systemMessage).toContain('pending');
      expect(parsed.systemMessage).toContain('review');
    });

    it('should NOT include notification when drafts are from the same session', async () => {
      // Arrange: pending draft from the same session
      sqliteStore.storeCandidate(
        makeCandidate({ id: 'draft-same-001', sessionId: 'session-notify-002' }),
      );

      const smartProvider = new SmartMockLLMProvider([
        JSON.stringify({
          type: 'normal',
          confidence: 0.9,
          reasoning: 'normal prompt',
        }),
      ]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Continue working on the feature.',
        sessionId: 'session-notify-002',
        llmProvider: smartProvider,
        sqliteStore,
        vectorStore,
      });

      // Assert: no notification (draft is from same session)
      expect(result).toBe('{}');
    });
  });

  // =========================================================================
  // Scenario 12: Full round-trip -- frustrated -> resolution -> Stop -> confirm -> recall
  // =========================================================================
  describe('Scenario 12: Full round-trip end-to-end', () => {
    it('should complete the entire cycle from frustration to recall', async () => {
      const transcriptPath = createTranscriptFile(tmpDir);
      const sessionId = 'session-roundtrip-001';

      // ---- Phase 1: Frustrated prompt ----
      const provider1 = new SmartMockLLMProvider([
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'frustrated',
        }),
      ]);

      await handleUserPromptSubmit({
        prompt: 'npm install keeps failing with ERESOLVE!',
        sessionId,
        llmProvider: provider1,
        sqliteStore,
        vectorStore,
      });

      expect(sqliteStore.getFlag(sessionId)!.status).toBe('frustrated');

      // ---- Phase 2: Resolution prompt ----
      const provider2 = new SmartMockLLMProvider([
        JSON.stringify({
          type: 'resolution',
          confidence: 0.85,
          reasoning: 'resolved',
        }),
      ]);

      await handleUserPromptSubmit({
        prompt: 'Fixed it by using --legacy-peer-deps.',
        sessionId,
        llmProvider: provider2,
        sqliteStore,
        vectorStore,
      });

      expect(sqliteStore.getFlag(sessionId)!.status).toBe('capture');

      // ---- Phase 3: Stop hook creates draft ----
      const provider3 = new SmartMockLLMProvider([
        JSON.stringify({
          frustrationSignature: 'ERESOLVE: peer dependency conflict',
          failedApproaches: ['npm install without flags'],
          successfulApproach: 'npm install --legacy-peer-deps',
          lessons: ['Use --legacy-peer-deps for peer dependency conflicts'],
        }),
      ]);

      await handleStop({
        sessionId,
        transcriptPath,
        llmProvider: provider3,
        sqliteStore,
      });

      const drafts = sqliteStore.getPendingDrafts();
      expect(drafts.length).toBe(1);
      const draftId = drafts[0].id;

      // ---- Phase 4: Confirm draft via CLI ----
      // confirmExperience calls LLM summarization on transcript content,
      // so the provider must return valid lesson JSON
      const confirmProvider = new SmartMockLLMProvider([
        JSON.stringify({
          frustrationSignature: 'ERESOLVE: peer dependency conflict',
          failedApproaches: ['npm install without flags'],
          successfulApproach: 'npm install --legacy-peer-deps',
          lessons: ['Use --legacy-peer-deps for peer dependency conflicts'],
        }),
      ]);
      await runCommand(['review', 'confirm', draftId], {
        sqliteStore,
        vectorStore,
        llmProvider: confirmProvider,
      });

      // Verify experience exists
      const experience = sqliteStore.getExperience(draftId);
      expect(experience).not.toBeNull();

      // ---- Phase 5: Active Recall finds the experience ----
      const embeddingText = buildEmbeddingText(experience!);
      const recallProvider = new SmartMockLLMProvider([
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'frustrated again',
        }),
        JSON.stringify({
          relevant: true,
          confidence: 0.9,
          reasoning: 'same issue',
          suggestedAction: 'Use --legacy-peer-deps to resolve peer dependency conflicts.',
        }),
      ]);

      const recallResult = await handleUserPromptSubmit({
        prompt: embeddingText,
        sessionId: 'session-roundtrip-002',
        llmProvider: recallProvider,
        sqliteStore,
        vectorStore,
      });

      const parsed = JSON.parse(recallResult);
      expect(parsed.systemMessage).toBeDefined();
      expect(parsed.systemMessage).toContain('--legacy-peer-deps');
    });
  });
});
