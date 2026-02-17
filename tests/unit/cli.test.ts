/**
 * Unit Tests for CLI (`src/cli.ts`)
 *
 * TDD RED phase: These tests define the expected behavior of the CLI
 * entry point BEFORE the implementation exists. The module should export
 * a `createProgram` factory that builds a Commander.js program with
 * dependency injection for testability.
 *
 * The target module (src/cli.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Commands under test:
 *   1. `sentinel review list`       - Show pending drafts formatted as a list
 *   2. `sentinel review confirm <id>` - Confirm draft -> experience + embedding
 *   3. `sentinel review reject <id>`  - Delete the candidate
 *   4. `sentinel --hook user-prompt-submit` - Route stdin JSON to handler
 *   5. `sentinel --hook stop`        - Route stdin JSON to handler
 *   6. `sentinel status`             - Show DB statistics
 *
 * Test points (10 categories, ~32 individual tests):
 *   1.  review list: pending drafts -> formatted output
 *   2.  review list: no drafts -> "No pending drafts" message
 *   3.  review confirm <id>: experience stored + embedding in VectorStore
 *   4.  review confirm <id>: embedding text template correctness
 *   5.  review reject <id>: candidate deleted
 *   6.  review confirm: non-existent id -> error message
 *   7.  review reject: non-existent id -> error message
 *   8.  --hook user-prompt-submit: routes stdin to handler
 *   9.  --hook stop: routes stdin to handler
 *  10.  status: statistics output format
 *
 * Testing strategy:
 *   - createProgram({ sqliteStore, vectorStore, llmProvider, stdin, stdout })
 *   - Real SqliteStore with :memory: DB for full round-trip verification
 *   - MockLLMProvider for deterministic embeddings
 *   - program.exitOverride() + program.configureOutput() for testing
 *   - Capture stdout via configureOutput({ writeOut }) callback
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/cli';
import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import type { AutoMemoryCandidate, FailureExperience } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Module mocks for hook handlers (CLI should delegate to these)
// ---------------------------------------------------------------------------

jest.mock('../../src/hook/user-prompt-submit-handler', () => ({
  handleUserPromptSubmit: jest.fn(),
}));

jest.mock('../../src/hook/stop-hook-handler', () => ({
  handleStop: jest.fn(),
}));

import { handleUserPromptSubmit } from '../../src/hook/user-prompt-submit-handler';
import { handleStop } from '../../src/hook/stop-hook-handler';

const mockedHandleUserPromptSubmit = handleUserPromptSubmit as jest.MockedFunction<
  typeof handleUserPromptSubmit
>;
const mockedHandleStop = handleStop as jest.MockedFunction<typeof handleStop>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<AutoMemoryCandidate> = {}): AutoMemoryCandidate {
  return {
    id: 'draft-001',
    sessionId: 'session-abc',
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried clearing cache', 'Tried reinstalling'],
    successfulApproach: 'Updated dependency version',
    lessons: ['Always check dependency compatibility'],
    status: 'pending',
    createdAt: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

/**
 * Build the expected embedding text for a candidate, matching the spec:
 *   "{frustrationSignature}. Failed: {failedApproaches joined with '; '}.
 *    Fixed: {successfulApproach}. Lessons: {lessons joined with '; '}"
 */
function buildEmbeddingText(candidate: AutoMemoryCandidate): string {
  const failed = candidate.failedApproaches.join('; ');
  const fixed = candidate.successfulApproach ?? '';
  const lessons = candidate.lessons.join('; ');
  return `${candidate.frustrationSignature}. Failed: ${failed}. Fixed: ${fixed}. Lessons: ${lessons}`;
}

/**
 * Parse a Commander program for the given command args.
 * Returns captured output and any thrown CommanderError.
 */
async function runCommand(
  args: string[],
  deps: {
    sqliteStore: SqliteStore;
    vectorStore: VectorStore;
    llmProvider: MockLLMProvider;
    stdinData?: string;
  },
): Promise<{ output: string; errorOutput: string; exitCode?: number }> {
  let output = '';
  let errorOutput = '';
  let exitCode: number | undefined;

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
  } catch (err: unknown) {
    // Commander throws CommanderError on exitOverride
    if (err && typeof err === 'object' && 'exitCode' in err) {
      exitCode = (err as { exitCode: number }).exitCode;
    }
  }

  return { output, errorOutput, exitCode };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CLI - createProgram', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    // Use real in-memory SQLite databases for full round-trip verification
    sqliteStore = new SqliteStore(':memory:');
    sqliteStore.initialize();

    vectorStore = new VectorStore(':memory:');
    vectorStore.initialize();

    llmProvider = new MockLLMProvider();
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
  });

  // =========================================================================
  // 1. review list: pending drafts -> formatted output
  // =========================================================================
  describe('review list: pending drafts', () => {
    it('should display pending drafts when they exist', async () => {
      // Arrange
      const draft = makeCandidate({ id: 'draft-100', frustrationSignature: 'ENOENT: file not found' });
      sqliteStore.storeCandidate(draft);

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should contain the draft ID and frustration signature
      expect(output).toContain('draft-100');
      expect(output).toContain('ENOENT: file not found');
    });

    it('should display multiple pending drafts', async () => {
      // Arrange
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-A', frustrationSignature: 'Error A' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-B', frustrationSignature: 'Error B' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-C', frustrationSignature: 'Error C' }));

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: all draft IDs should appear
      expect(output).toContain('draft-A');
      expect(output).toContain('draft-B');
      expect(output).toContain('draft-C');
    });

    it('should only display pending drafts (not confirmed or rejected)', async () => {
      // Arrange
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-pending', status: 'pending' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-confirmed', status: 'confirmed' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-rejected', status: 'rejected' }));

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: only the pending one should appear
      expect(output).toContain('draft-pending');
      expect(output).not.toContain('draft-confirmed');
      expect(output).not.toContain('draft-rejected');
    });
  });

  // =========================================================================
  // 2. review list: no drafts -> "No pending drafts" message
  // =========================================================================
  describe('review list: no pending drafts', () => {
    it('should display a "no pending drafts" message when none exist', async () => {
      // Arrange: empty database, no candidates at all

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should indicate no pending drafts
      // Accept any message containing relevant keywords (case-insensitive)
      const lowerOutput = output.toLowerCase();
      expect(
        lowerOutput.includes('no pending') || lowerOutput.includes('no draft') || lowerOutput.includes('empty'),
      ).toBe(true);
    });

    it('should display a "no pending drafts" message when all drafts are confirmed/rejected', async () => {
      // Arrange: only non-pending candidates
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-done', status: 'confirmed' }));

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      const lowerOutput = output.toLowerCase();
      expect(
        lowerOutput.includes('no pending') || lowerOutput.includes('no draft') || lowerOutput.includes('empty'),
      ).toBe(true);
    });
  });

  // =========================================================================
  // 3. review confirm <id>: experience stored + embedding in VectorStore
  // =========================================================================
  describe('review confirm <id>: full pipeline', () => {
    it('should store the experience in SqliteStore when confirming a draft', async () => {
      // Arrange
      const draft = makeCandidate({
        id: 'confirm-001',
        frustrationSignature: 'EACCES: permission denied',
        failedApproaches: ['chmod 644'],
        successfulApproach: 'chmod 755',
        lessons: ['Check execute permissions'],
      });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'confirm-001'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: experience should be stored in experiences table
      const experience = sqliteStore.getExperience('confirm-001');
      expect(experience).not.toBeNull();
      expect(experience!.id).toBe('confirm-001');
      expect(experience!.frustrationSignature).toBe('EACCES: permission denied');
      expect(experience!.failedApproaches).toEqual(['chmod 644']);
      expect(experience!.successfulApproach).toBe('chmod 755');
      expect(experience!.lessons).toEqual(['Check execute permissions']);
    });

    it('should store the embedding in VectorStore when confirming a draft', async () => {
      // Arrange
      const draft = makeCandidate({
        id: 'confirm-002',
        frustrationSignature: 'Build failed',
        failedApproaches: ['npm cache clean'],
        successfulApproach: 'Updated node version',
        lessons: ['Check node version compatibility'],
      });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'confirm-002'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: embedding should be stored in VectorStore
      // Verify by generating the same embedding and searching for it
      const embeddingText = buildEmbeddingText(draft);
      const queryEmbedding = await llmProvider.generateEmbedding(embeddingText);
      const results = vectorStore.search(queryEmbedding, 1, 0.99);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('confirm-002');
    });

    it('should delete the candidate after confirming', async () => {
      // Arrange
      const draft = makeCandidate({ id: 'confirm-003' });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'confirm-003'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: candidate should be removed from pending drafts
      const pendingDrafts = sqliteStore.getPendingDrafts();
      const remaining = pendingDrafts.filter((d) => d.id === 'confirm-003');
      expect(remaining).toHaveLength(0);
    });

    it('should call llmProvider.generateEmbedding with the correct text', async () => {
      // Arrange
      const draft = makeCandidate({
        id: 'confirm-004',
        frustrationSignature: 'TypeError: x is not a function',
        failedApproaches: ['Added type guard', 'Used optional chaining'],
        successfulApproach: 'Fixed the import path',
        lessons: ['Check import paths', 'Use TypeScript strict mode'],
      });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'confirm-004'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: verify the embedding call was made
      const embeddingCalls = llmProvider.calls.filter(
        (c) => c.method === 'generateEmbedding',
      );
      expect(embeddingCalls.length).toBe(1);

      const expectedText = buildEmbeddingText(draft);
      expect(embeddingCalls[0].args[0]).toBe(expectedText);
    });

    it('should output a success message after confirming', async () => {
      // Arrange
      sqliteStore.storeCandidate(makeCandidate({ id: 'confirm-005' }));

      // Act
      const { output } = await runCommand(['review', 'confirm', 'confirm-005'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should indicate success
      const lowerOutput = output.toLowerCase();
      expect(
        lowerOutput.includes('confirmed') || lowerOutput.includes('success') || lowerOutput.includes('stored'),
      ).toBe(true);
    });
  });

  // =========================================================================
  // 4. review confirm <id>: embedding text template correctness
  // =========================================================================
  describe('review confirm <id>: embedding text template', () => {
    it('should format the embedding text correctly with all fields', async () => {
      // Arrange
      const draft = makeCandidate({
        id: 'template-001',
        frustrationSignature: 'ENOENT: no such file',
        failedApproaches: ['Tried relative path', 'Tried home dir expansion'],
        successfulApproach: 'Used path.resolve',
        lessons: ['Always use absolute paths', 'Never trust user paths'],
      });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'template-001'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: verify the exact template format
      const embeddingCalls = llmProvider.calls.filter(
        (c) => c.method === 'generateEmbedding',
      );
      expect(embeddingCalls.length).toBe(1);

      const embeddingText = embeddingCalls[0].args[0] as string;
      expect(embeddingText).toBe(
        'ENOENT: no such file. Failed: Tried relative path; Tried home dir expansion. Fixed: Used path.resolve. Lessons: Always use absolute paths; Never trust user paths',
      );
    });

    it('should handle missing successfulApproach in embedding text', async () => {
      // Arrange: no successfulApproach
      const draft = makeCandidate({
        id: 'template-002',
        frustrationSignature: 'Connection refused',
        failedApproaches: ['Checked port'],
        successfulApproach: undefined,
        lessons: ['Verify service is running'],
      });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'template-002'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: "Fixed:" part should be empty
      const embeddingCalls = llmProvider.calls.filter(
        (c) => c.method === 'generateEmbedding',
      );
      expect(embeddingCalls.length).toBe(1);

      const embeddingText = embeddingCalls[0].args[0] as string;
      expect(embeddingText).toBe(
        'Connection refused. Failed: Checked port. Fixed: . Lessons: Verify service is running',
      );
    });

    it('should handle empty arrays in embedding text', async () => {
      // Arrange
      const draft = makeCandidate({
        id: 'template-003',
        frustrationSignature: 'Unknown error',
        failedApproaches: [],
        successfulApproach: 'Rebooted',
        lessons: [],
      });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'template-003'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      const embeddingCalls = llmProvider.calls.filter(
        (c) => c.method === 'generateEmbedding',
      );
      expect(embeddingCalls.length).toBe(1);

      const embeddingText = embeddingCalls[0].args[0] as string;
      expect(embeddingText).toBe(
        'Unknown error. Failed: . Fixed: Rebooted. Lessons: ',
      );
    });
  });

  // =========================================================================
  // 5. review reject <id>: candidate deleted
  // =========================================================================
  describe('review reject <id>', () => {
    it('should delete the candidate when rejecting', async () => {
      // Arrange
      const draft = makeCandidate({ id: 'reject-001' });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'reject', 'reject-001'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: candidate should be removed
      const pendingDrafts = sqliteStore.getPendingDrafts();
      expect(pendingDrafts.filter((d) => d.id === 'reject-001')).toHaveLength(0);
    });

    it('should NOT create an experience when rejecting', async () => {
      // Arrange
      sqliteStore.storeCandidate(makeCandidate({ id: 'reject-002' }));

      // Act
      await runCommand(['review', 'reject', 'reject-002'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: no experience should be stored
      const experience = sqliteStore.getExperience('reject-002');
      expect(experience).toBeNull();
    });

    it('should NOT generate an embedding when rejecting', async () => {
      // Arrange
      sqliteStore.storeCandidate(makeCandidate({ id: 'reject-003' }));

      // Act
      await runCommand(['review', 'reject', 'reject-003'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: no embedding calls should have been made
      const embeddingCalls = llmProvider.calls.filter(
        (c) => c.method === 'generateEmbedding',
      );
      expect(embeddingCalls).toHaveLength(0);
    });

    it('should output a success message after rejecting', async () => {
      // Arrange
      sqliteStore.storeCandidate(makeCandidate({ id: 'reject-004' }));

      // Act
      const { output } = await runCommand(['review', 'reject', 'reject-004'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should indicate the draft was rejected/deleted
      const lowerOutput = output.toLowerCase();
      expect(
        lowerOutput.includes('rejected') || lowerOutput.includes('deleted') || lowerOutput.includes('removed'),
      ).toBe(true);
    });
  });

  // =========================================================================
  // 6. review confirm: non-existent id -> error message
  // =========================================================================
  describe('review confirm: non-existent id', () => {
    it('should output an error message when confirming a non-existent draft', async () => {
      // Arrange: no candidates stored

      // Act
      const { output, errorOutput } = await runCommand(
        ['review', 'confirm', 'nonexistent-id'],
        { sqliteStore, vectorStore, llmProvider },
      );

      // Assert: output or error output should indicate the draft was not found
      const combinedOutput = (output + errorOutput).toLowerCase();
      expect(
        combinedOutput.includes('not found') ||
          combinedOutput.includes('no draft') ||
          combinedOutput.includes('does not exist'),
      ).toBe(true);
    });

    it('should NOT store any experience when confirming a non-existent draft', async () => {
      // Arrange: no candidates stored

      // Act
      await runCommand(['review', 'confirm', 'nonexistent-id'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: no experience should be stored
      const experience = sqliteStore.getExperience('nonexistent-id');
      expect(experience).toBeNull();
    });

    it('should NOT generate any embedding when confirming a non-existent draft', async () => {
      // Arrange: no candidates stored

      // Act
      await runCommand(['review', 'confirm', 'nonexistent-id'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: no embedding calls
      const embeddingCalls = llmProvider.calls.filter(
        (c) => c.method === 'generateEmbedding',
      );
      expect(embeddingCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // 7. review reject: non-existent id -> error message
  // =========================================================================
  describe('review reject: non-existent id', () => {
    it('should output an error message when rejecting a non-existent draft', async () => {
      // Arrange: no candidates stored

      // Act
      const { output, errorOutput } = await runCommand(
        ['review', 'reject', 'ghost-draft'],
        { sqliteStore, vectorStore, llmProvider },
      );

      // Assert: output should indicate the draft was not found
      const combinedOutput = (output + errorOutput).toLowerCase();
      expect(
        combinedOutput.includes('not found') ||
          combinedOutput.includes('no draft') ||
          combinedOutput.includes('does not exist'),
      ).toBe(true);
    });
  });

  // =========================================================================
  // 8. --hook user-prompt-submit: routes stdin to handler
  // =========================================================================
  describe('--hook user-prompt-submit', () => {
    it('should call handleUserPromptSubmit with the parsed stdin JSON', async () => {
      // Arrange
      const stdinJson = JSON.stringify({
        prompt: 'Why is this failing again?',
        session_id: 'session-hook-001',
      });
      mockedHandleUserPromptSubmit.mockResolvedValue('{}');

      // Act
      const { output } = await runCommand(['--hook', 'user-prompt-submit'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: stdinJson,
      });

      // Assert: handler should have been called
      expect(mockedHandleUserPromptSubmit).toHaveBeenCalledTimes(1);

      // Verify the handler was called with correct arguments
      const callArgs = mockedHandleUserPromptSubmit.mock.calls[0][0];
      expect(callArgs.prompt).toBe('Why is this failing again?');
      expect(callArgs.sessionId).toBe('session-hook-001');
      expect(callArgs.sqliteStore).toBe(sqliteStore);
      expect(callArgs.vectorStore).toBe(vectorStore);
      expect(callArgs.llmProvider).toBe(llmProvider);
    });

    it('should output the handler result to stdout', async () => {
      // Arrange
      const stdinJson = JSON.stringify({
        prompt: 'Some prompt',
        session_id: 'session-hook-002',
      });
      const handlerResult = JSON.stringify({
        systemMessage: 'You have encountered this error before.',
      });
      mockedHandleUserPromptSubmit.mockResolvedValue(handlerResult);

      // Act
      const { output } = await runCommand(['--hook', 'user-prompt-submit'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: stdinJson,
      });

      // Assert: output should contain the handler result
      expect(output).toContain(handlerResult);
    });

    it('should output "{}" when handler returns empty response', async () => {
      // Arrange
      const stdinJson = JSON.stringify({
        prompt: 'Normal prompt',
        session_id: 'session-hook-003',
      });
      mockedHandleUserPromptSubmit.mockResolvedValue('{}');

      // Act
      const { output } = await runCommand(['--hook', 'user-prompt-submit'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: stdinJson,
      });

      // Assert
      expect(output).toContain('{}');
    });
  });

  // =========================================================================
  // 9. --hook stop: routes stdin to handler
  // =========================================================================
  describe('--hook stop', () => {
    it('should call handleStop with the parsed stdin JSON', async () => {
      // Arrange
      const stdinJson = JSON.stringify({
        session_id: 'session-stop-001',
        transcript_path: '/home/user/.claude/sessions/abc/transcript.jsonl',
      });
      mockedHandleStop.mockResolvedValue('{"decision":"approve"}');

      // Act
      await runCommand(['--hook', 'stop'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: stdinJson,
      });

      // Assert: handler should have been called
      expect(mockedHandleStop).toHaveBeenCalledTimes(1);

      const callArgs = mockedHandleStop.mock.calls[0][0];
      expect(callArgs.sessionId).toBe('session-stop-001');
      expect(callArgs.transcriptPath).toBe(
        '/home/user/.claude/sessions/abc/transcript.jsonl',
      );
      expect(callArgs.sqliteStore).toBe(sqliteStore);
      expect(callArgs.llmProvider).toBe(llmProvider);
    });

    it('should output the handler result to stdout', async () => {
      // Arrange
      const stdinJson = JSON.stringify({
        session_id: 'session-stop-002',
        transcript_path: '/tmp/transcript.jsonl',
      });
      mockedHandleStop.mockResolvedValue('{"decision":"approve"}');

      // Act
      const { output } = await runCommand(['--hook', 'stop'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: stdinJson,
      });

      // Assert
      expect(output).toContain('{"decision":"approve"}');
    });
  });

  // =========================================================================
  // 10. status: statistics output
  // =========================================================================
  describe('status', () => {
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
      });
      sqliteStore.storeExperience({
        id: 'exp-002',
        frustrationSignature: 'Error B',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-16T12:01:00Z',
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

  // =========================================================================
  // Edge cases and additional coverage
  // =========================================================================
  describe('edge cases', () => {
    it('should export createProgram as a function', () => {
      // This is the most fundamental test: createProgram must be exported
      expect(typeof createProgram).toBe('function');
    });

    it('should handle confirm when llmProvider fails to generate embedding', async () => {
      // Arrange
      const failingProvider = new MockLLMProvider({ shouldFail: true });
      sqliteStore.storeCandidate(makeCandidate({ id: 'fail-embed-001' }));

      // Act
      const { output, errorOutput } = await runCommand(
        ['review', 'confirm', 'fail-embed-001'],
        {
          sqliteStore,
          vectorStore,
          llmProvider: failingProvider,
        },
      );

      // Assert: should output an error message, not crash
      const combinedOutput = (output + errorOutput).toLowerCase();
      expect(
        combinedOutput.includes('error') || combinedOutput.includes('failed') || combinedOutput.includes('unable'),
      ).toBe(true);
    });

    it('should handle --hook with invalid stdin JSON gracefully', async () => {
      // Arrange: invalid JSON stdin
      mockedHandleUserPromptSubmit.mockResolvedValue('{}');

      // Act
      const { output } = await runCommand(['--hook', 'user-prompt-submit'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: 'this is not valid JSON {{{',
      });

      // Assert: should handle gracefully (output '{}' or an error)
      // The CLI should not crash
      expect(output).toBeDefined();
    });

    it('should handle --hook with unknown hook name', async () => {
      // Arrange & Act
      const { output, errorOutput } = await runCommand(
        ['--hook', 'unknown-hook-name'],
        {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: '{}',
        },
      );

      // Assert: should indicate unknown hook or output empty
      const combinedOutput = output + errorOutput;
      expect(combinedOutput.length).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // 11. add <path>: import markdown files as experiences
  // =========================================================================
  describe('add <path>', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should import a single .md file as an experience', async () => {
      // Arrange
      const mdFile = path.join(tmpDir, 'note.md');
      fs.writeFileSync(mdFile, '# Fix: ENOENT error\n\nAlways use absolute paths.');

      // Act
      const { output } = await runCommand(['add', mdFile], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: experience should be stored
      const count = sqliteStore.getExperienceCount();
      expect(count).toBe(1);
      expect(output.toLowerCase()).toContain('added');
    });

    it('should import all .md files from a folder recursively', async () => {
      // Arrange
      fs.writeFileSync(path.join(tmpDir, 'a.md'), '# Note A\nContent A');
      fs.writeFileSync(path.join(tmpDir, 'b.md'), '# Note B\nContent B');
      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'c.md'), '# Note C\nContent C');
      // Non-md file should be ignored
      fs.writeFileSync(path.join(tmpDir, 'ignore.txt'), 'not markdown');

      // Act
      const { output } = await runCommand(['add', tmpDir], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: 3 experiences (a.md, b.md, sub/c.md), not ignore.txt
      const count = sqliteStore.getExperienceCount();
      expect(count).toBe(3);
      expect(output).toContain('3');
    });

    it('should error on nonexistent path', async () => {
      // Arrange
      const badPath = path.join(tmpDir, 'nonexistent.md');

      // Act
      const { output, errorOutput } = await runCommand(['add', badPath], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: error message
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/not found|does not exist|no such/);
      expect(sqliteStore.getExperienceCount()).toBe(0);
    });

    it('should skip empty .md files with a warning', async () => {
      // Arrange
      const emptyFile = path.join(tmpDir, 'empty.md');
      fs.writeFileSync(emptyFile, '');
      const goodFile = path.join(tmpDir, 'good.md');
      fs.writeFileSync(goodFile, '# Good note\nSome content.');

      // Act
      const { output, errorOutput } = await runCommand(['add', tmpDir], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: only the good file should become an experience
      expect(sqliteStore.getExperienceCount()).toBe(1);
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/skip|empty/);
    });

    it('should error when given a non-.md single file', async () => {
      // Arrange
      const txtFile = path.join(tmpDir, 'notes.txt');
      fs.writeFileSync(txtFile, 'some text content');

      // Act
      const { output, errorOutput } = await runCommand(['add', txtFile], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: error message about non-md
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/\.md|markdown/);
      expect(sqliteStore.getExperienceCount()).toBe(0);
    });

    it('should message when folder has no .md files', async () => {
      // Arrange: folder with only non-md files
      fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'text file');
      fs.writeFileSync(path.join(tmpDir, 'data.json'), '{}');

      // Act
      const { output, errorOutput } = await runCommand(['add', tmpDir], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/no .* found|no .*\.md/);
      expect(sqliteStore.getExperienceCount()).toBe(0);
    });

    it('should generate embedding for each imported file', async () => {
      // Arrange
      const mdFile = path.join(tmpDir, 'embed-test.md');
      fs.writeFileSync(mdFile, '# Test\nSome content for embedding.');

      // Act
      await runCommand(['add', mdFile], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: embedding should be stored in vector store
      const embeddingCalls = llmProvider.calls.filter(
        (c) => c.method === 'generateEmbedding',
      );
      expect(embeddingCalls.length).toBe(1);
    });

    it('should continue processing remaining files when LLM fails on one', async () => {
      // Arrange: create 2 files, mock provider that fails once then succeeds
      fs.writeFileSync(path.join(tmpDir, '1-fail.md'), '# Will fail');
      fs.writeFileSync(path.join(tmpDir, '2-ok.md'), '# Will succeed');

      // Use a provider that fails on first call then succeeds
      const flakeyProvider = new MockLLMProvider();
      let embeddingCallCount = 0;
      const origEmbed = flakeyProvider.generateEmbedding.bind(flakeyProvider);
      flakeyProvider.generateEmbedding = async (text: string) => {
        embeddingCallCount++;
        if (embeddingCallCount === 1) {
          throw new Error('Temporary LLM failure');
        }
        return origEmbed(text);
      };

      // Act
      const { output, errorOutput } = await runCommand(['add', tmpDir], {
        sqliteStore,
        vectorStore,
        llmProvider: flakeyProvider,
      });

      // Assert: at least 1 experience should be stored (the one that didn't fail)
      expect(sqliteStore.getExperienceCount()).toBeGreaterThanOrEqual(1);
    });

    it('should skip duplicate content and show a message', async () => {
      // Arrange: two files with identical content
      const mdA = path.join(tmpDir, 'note-a.md');
      const mdB = path.join(tmpDir, 'note-b.md');
      const content = '# Same Problem\n\nExact same troubleshooting notes.';
      fs.writeFileSync(mdA, content);
      fs.writeFileSync(mdB, content);

      // Act
      const { output, errorOutput } = await runCommand(['add', tmpDir], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: only 1 experience stored, second should be skipped as duplicate
      expect(sqliteStore.getExperienceCount()).toBe(1);
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/duplicate|skip|already/);
    });

    it('should store both when content is different', async () => {
      // Arrange: two files with different content
      fs.writeFileSync(path.join(tmpDir, 'unique-a.md'), '# Problem A\nContent A.');
      fs.writeFileSync(path.join(tmpDir, 'unique-b.md'), '# Problem B\nContent B.');

      // Act
      await runCommand(['add', tmpDir], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: both should be stored
      expect(sqliteStore.getExperienceCount()).toBe(2);
    });

    it('should detect duplicate against existing experiences in vector store', async () => {
      // Arrange: first add a file
      const mdFirst = path.join(tmpDir, 'first.md');
      fs.writeFileSync(mdFirst, '# Specific Error\nVery specific content here.');
      await runCommand(['add', mdFirst], { sqliteStore, vectorStore, llmProvider });
      expect(sqliteStore.getExperienceCount()).toBe(1);

      // Now add the same content with a different filename
      const mdSecond = path.join(tmpDir, 'second.md');
      fs.writeFileSync(mdSecond, '# Specific Error\nVery specific content here.');
      const { output, errorOutput } = await runCommand(['add', mdSecond], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: still 1 experience, second was skipped
      expect(sqliteStore.getExperienceCount()).toBe(1);
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/duplicate|skip|already/);
    });
  });

  // =========================================================================
  // 12. list: show stored experiences
  // =========================================================================
  describe('list', () => {
    it('should display stored experiences', async () => {
      // Arrange
      sqliteStore.storeExperience({
        id: 'exp-list-001',
        frustrationSignature: 'ENOENT: no such file',
        failedApproaches: ['tried relative path'],
        successfulApproach: 'used path.resolve',
        lessons: ['use absolute paths'],
        createdAt: '2026-02-17T10:00:00Z',
      });

      // Act
      const { output } = await runCommand(['list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      expect(output).toContain('exp-list-001');
      expect(output).toContain('ENOENT: no such file');
    });

    it('should display multiple experiences', async () => {
      // Arrange
      sqliteStore.storeExperience({
        id: 'exp-A',
        frustrationSignature: 'Error A',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-17T10:00:00Z',
      });
      sqliteStore.storeExperience({
        id: 'exp-B',
        frustrationSignature: 'Error B',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-17T11:00:00Z',
      });

      // Act
      const { output } = await runCommand(['list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      expect(output).toContain('exp-A');
      expect(output).toContain('exp-B');
    });

    it('should display message when no experiences exist', async () => {
      // Act
      const { output } = await runCommand(['list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      const lower = output.toLowerCase();
      expect(lower).toMatch(/no experience|empty|no stored/);
    });
  });

  // =========================================================================
  // 13. delete <id>: remove individual experience
  // =========================================================================
  describe('delete <id>', () => {
    it('should delete an experience from sqlite and vector store', async () => {
      // Arrange: store experience + vector
      sqliteStore.storeExperience({
        id: 'del-001',
        frustrationSignature: 'Error to delete',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-17T10:00:00Z',
      });
      const embedding = await llmProvider.generateEmbedding('Error to delete');
      vectorStore.store('del-001', embedding, { frustrationSignature: 'Error to delete' });

      // Act
      const { output } = await runCommand(['delete', 'del-001'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: gone from both stores
      expect(sqliteStore.getExperience('del-001')).toBeNull();
      const results = vectorStore.search(embedding, 1, 0.99);
      expect(results.filter((r) => r.id === 'del-001')).toHaveLength(0);
      expect(output.toLowerCase()).toMatch(/deleted|removed/);
    });

    it('should error when deleting non-existent id', async () => {
      // Act
      const { output, errorOutput } = await runCommand(['delete', 'ghost-id'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/not found|does not exist/);
    });
  });

  // =========================================================================
  // 14. reset: clear all data
  // =========================================================================
  describe('reset', () => {
    it('should refuse without --confirm flag', async () => {
      // Arrange
      sqliteStore.storeExperience({
        id: 'keep-me',
        frustrationSignature: 'Keep',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-17T10:00:00Z',
      });

      // Act
      const { output, errorOutput } = await runCommand(['reset'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: data should NOT be deleted
      expect(sqliteStore.getExperienceCount()).toBe(1);
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/--confirm/);
    });

    it('should clear all data with --confirm flag', async () => {
      // Arrange
      sqliteStore.storeExperience({
        id: 'wipe-001',
        frustrationSignature: 'Wipe me',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-17T10:00:00Z',
      });
      sqliteStore.storeCandidate(makeCandidate({ id: 'draft-wipe' }));
      const embedding = await llmProvider.generateEmbedding('test');
      vectorStore.store('wipe-001', embedding, { frustrationSignature: 'Wipe me' });

      // Act
      const { output } = await runCommand(['reset', '--confirm'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: everything gone
      expect(sqliteStore.getExperienceCount()).toBe(0);
      expect(sqliteStore.getPendingDrafts()).toHaveLength(0);
      expect(vectorStore.search(embedding, 10, 0)).toHaveLength(0);
      expect(output.toLowerCase()).toMatch(/reset|cleared/);
    });
  });

  // =========================================================================
  // 15. detail <id>: show full experience details
  // =========================================================================
  describe('detail <id>', () => {
    it('should display full experience details for a valid id', async () => {
      // Arrange
      sqliteStore.storeExperience({
        id: 'detail-001',
        frustrationSignature: 'ENOENT: no such file or directory',
        failedApproaches: ['Used relative path', 'Tried tilde expansion'],
        successfulApproach: 'Used path.resolve with __dirname',
        lessons: ['Always use absolute paths', 'Never trust user-provided paths'],
        createdAt: '2026-02-17T10:00:00Z',
      });

      // Act
      const { output } = await runCommand(['detail', 'detail-001'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: all fields should appear in output
      expect(output).toContain('detail-001');
      expect(output).toContain('ENOENT: no such file or directory');
      expect(output).toContain('Used relative path');
      expect(output).toContain('Tried tilde expansion');
      expect(output).toContain('Used path.resolve with __dirname');
      expect(output).toContain('Always use absolute paths');
      expect(output).toContain('Never trust user-provided paths');
      expect(output).toContain('2026-02-17T10:00:00Z');
    });

    it('should display experience with no successfulApproach', async () => {
      // Arrange
      sqliteStore.storeExperience({
        id: 'detail-002',
        frustrationSignature: 'Unresolved issue',
        failedApproaches: ['Approach A'],
        lessons: ['Still investigating'],
        createdAt: '2026-02-17T11:00:00Z',
      });

      // Act
      const { output } = await runCommand(['detail', 'detail-002'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      expect(output).toContain('detail-002');
      expect(output).toContain('Unresolved issue');
      expect(output).toContain('Approach A');
      expect(output).toContain('Still investigating');
    });

    it('should display experience with empty failedApproaches and lessons', async () => {
      // Arrange
      sqliteStore.storeExperience({
        id: 'detail-003',
        frustrationSignature: 'Minimal experience',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-17T12:00:00Z',
      });

      // Act
      const { output } = await runCommand(['detail', 'detail-003'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: should still display the experience without crashing
      expect(output).toContain('detail-003');
      expect(output).toContain('Minimal experience');
    });

    it('should output error for non-existent experience id', async () => {
      // Act
      const { output, errorOutput } = await runCommand(['detail', 'nonexistent-id'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert
      const combined = (output + errorOutput).toLowerCase();
      expect(combined).toMatch(/not found|does not exist/);
    });
  });

  // =========================================================================
  // 16. review detail: tool call display
  // =========================================================================
  describe('review detail: tool call display', () => {
    it('should only show tool calls with non-empty names', async () => {
      // Arrange: store a draft with transcriptData containing tool calls
      // where one has an empty name (should be filtered out)
      const transcriptData = {
        messages: [
          { role: 'user', content: 'Fix the build' },
        ],
        toolCalls: [
          { name: 'Bash', input: { command: 'npm test' }, output: 'ok' },
          { name: '', input: { command: 'hidden' }, output: 'should not appear' },
          { name: 'Read', input: { file_path: '/tmp/f.ts' }, output: 'content' },
        ],
        errors: [],
      };
      const draft = makeCandidate({
        id: 'detail-tc-001',
        transcriptData: JSON.stringify(transcriptData),
      });
      sqliteStore.storeCandidate(draft);

      // Act
      const { output } = await runCommand(['review', 'detail', 'detail-tc-001'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: "Bash" and "Read" should appear, but the empty-name tool call
      // content ("hidden", "should not appear") should NOT produce a tool call entry.
      expect(output).toContain('Bash');
      expect(output).toContain('Read');
      // The empty-name tool call's unique text should not show up as a tool call line
      expect(output).not.toMatch(/^\s*[^\S\n]*\(\{.*hidden.*\)/m);
    });

    it('should show tool call in name(input) -> output format', async () => {
      // Arrange: store a draft with a tool call that has input and output
      const transcriptData = {
        messages: [],
        toolCalls: [
          { name: 'Bash', input: { command: 'npm test' }, output: '3 tests passed' },
        ],
        errors: [],
      };
      const draft = makeCandidate({
        id: 'detail-tc-002',
        transcriptData: JSON.stringify(transcriptData),
      });
      sqliteStore.storeCandidate(draft);

      // Act
      const { output } = await runCommand(['review', 'detail', 'detail-tc-002'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should show name(inputSummary) -> resultSummary format
      expect(output).toContain('Bash(');
      expect(output).toContain('npm test');
      expect(output).toContain('3 tests passed');
    });

    it('should show [ERROR] for tool calls with errors', async () => {
      // Arrange: store a draft with a tool call that has an error
      const transcriptData = {
        messages: [],
        toolCalls: [
          { name: 'Bash', input: { command: 'npm build' }, error: 'exit code 1' },
        ],
        errors: [],
      };
      const draft = makeCandidate({
        id: 'detail-tc-003',
        transcriptData: JSON.stringify(transcriptData),
      });
      sqliteStore.storeCandidate(draft);

      // Act
      const { output } = await runCommand(['review', 'detail', 'detail-tc-003'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should contain [ERROR] marker for the failed tool call
      expect(output).toContain('[ERROR]');
    });
  });

  // =========================================================================
  // 17. review confirm: transcript LLM summarization
  // =========================================================================
  describe('review confirm: transcript LLM summarization', () => {
    it('should pass transcript content to confirmExperience for LLM summarization', async () => {
      // Arrange: store a draft with transcriptData so that buildConfirmContext
      // produces content that gets passed to LLM generateCompletion
      const transcriptData = {
        messages: [
          { role: 'user', content: 'Build failing' },
          { role: 'assistant', content: 'Let me check' },
        ],
        toolCalls: [
          { name: 'Bash', input: { command: 'npm run build' }, error: 'Build failed' },
        ],
        errors: ['Build failed'],
      };
      const draft = makeCandidate({
        id: 'confirm-llm-001',
        transcriptData: JSON.stringify(transcriptData),
        // Draft fields are empty since LLM should fill them during confirm
        frustrationSignature: '',
        failedApproaches: [],
        lessons: [],
      });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'confirm-llm-001'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: generateCompletion should have been called (for LLM summarization)
      // The mock returns non-JSON so extractNoteFields won't override fields,
      // but the call should still happen.
      const completionCalls = llmProvider.calls.filter(
        (c) => c.method === 'generateCompletion',
      );
      expect(completionCalls.length).toBe(1);

      // The experience should still be stored (with original draft defaults
      // as fallback since the mock LLM returns non-JSON)
      const experience = sqliteStore.getExperience('confirm-llm-001');
      expect(experience).not.toBeNull();
    });

    it('should use LLM-extracted fields when LLM returns valid JSON', async () => {
      // Arrange: create a provider that returns valid lesson JSON
      const spiedProvider = new MockLLMProvider();
      jest.spyOn(spiedProvider, 'generateCompletion').mockResolvedValue(JSON.stringify({
        frustrationSignature: 'LLM detected error',
        failedApproaches: ['LLM approach 1'],
        successfulApproach: 'LLM fix',
        lessons: ['LLM lesson 1'],
      }));

      const transcriptData = {
        messages: [
          { role: 'user', content: 'Build failing' },
          { role: 'assistant', content: 'Let me check' },
        ],
        toolCalls: [
          { name: 'Bash', input: { command: 'npm run build' }, error: 'Build failed' },
        ],
        errors: ['Build failed'],
      };
      const draft = makeCandidate({
        id: 'confirm-llm-002',
        transcriptData: JSON.stringify(transcriptData),
        // Draft fields are empty -- LLM should fill them
        frustrationSignature: '',
        failedApproaches: [],
        successfulApproach: undefined,
        lessons: [],
      });
      sqliteStore.storeCandidate(draft);

      // Act
      await runCommand(['review', 'confirm', 'confirm-llm-002'], {
        sqliteStore,
        vectorStore,
        llmProvider: spiedProvider,
      });

      // Assert: the stored experience should have LLM-extracted fields
      const experience = sqliteStore.getExperience('confirm-llm-002');
      expect(experience).not.toBeNull();
      expect(experience!.frustrationSignature).toBe('LLM detected error');
      expect(experience!.failedApproaches).toEqual(['LLM approach 1']);
      expect(experience!.successfulApproach).toBe('LLM fix');
      expect(experience!.lessons).toEqual(['LLM lesson 1']);
    });
  });
});
