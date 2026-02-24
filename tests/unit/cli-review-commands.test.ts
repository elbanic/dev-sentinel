/**
 * Unit Tests for CLI review commands (extracted from cli.test.ts)
 *
 * Commands under test:
 *   - `sentinel review list`         - Show pending drafts formatted as a list
 *   - `sentinel review confirm <id>` - Confirm draft -> experience + embedding
 *   - `sentinel review reject <id>`  - Delete the candidate
 *   - `sentinel review detail <id>`  - Show draft details
 *   - `sentinel review confirm --all / --recent` - Batch confirm
 *   - `sentinel review reject --all` - Batch reject
 *
 * NOTE: No jest.mock() needed -- review commands do not use hook handlers.
 */

import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import type { FailureExperience } from '../../src/types/index';
import {
  runCommand,
  makeCandidate,
  buildEmbeddingText,
  createTestDeps,
  cleanupDeps,
} from '../helpers/cli-test-helpers';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CLI - review commands', () => {
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
  // review detail: tool call display
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
  // review confirm: transcript LLM summarization
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

    it('should include Frustration Context in LLM content when frustrated turn exists', async () => {
      // Arrange: store a frustrated turn for the session
      const sessionId = 'session-ctx-001';
      sqliteStore.storeTurn(
        sessionId,
        'Why does the build keep failing?',
        JSON.stringify({ type: 'frustrated', confidence: 0.9, intent: 'Fix recurring build failure' }),
      );

      const transcriptData = {
        messages: [
          { role: 'user', content: 'Fix the login' },
          { role: 'assistant', content: 'Done' },
          { role: 'user', content: 'Why does the build keep failing?' },
          { role: 'assistant', content: 'The config is wrong' },
        ],
        toolCalls: [],
        errors: [],
      };
      const draft = makeCandidate({
        id: 'confirm-ctx-001',
        sessionId,
        transcriptData: JSON.stringify(transcriptData),
        frustrationSignature: '',
        failedApproaches: [],
        lessons: [],
      });
      sqliteStore.storeCandidate(draft);

      // Spy on generateCompletion to capture the content passed
      const spiedProvider = new MockLLMProvider();
      const spy = jest.spyOn(spiedProvider, 'generateCompletion').mockResolvedValue(JSON.stringify({
        frustrationSignature: 'Build failure',
        failedApproaches: [],
        successfulApproach: null,
        lessons: ['Check config'],
      }));

      // Act
      await runCommand(['review', 'confirm', 'confirm-ctx-001'], {
        sqliteStore,
        vectorStore,
        llmProvider: spiedProvider,
      });

      // Assert: the content passed to LLM should include Frustration Context
      expect(spy).toHaveBeenCalledTimes(1);
      const contentArg = spy.mock.calls[0][1]; // second argument is the user content
      expect(contentArg).toContain('\u2500\u2500 Frustration Context \u2500\u2500');
      expect(contentArg).toContain('Fix recurring build failure');
      expect(contentArg).toContain('Why does the build keep failing?');
    });
  });

  // =========================================================================
  // review confirm --all / --recent, review reject --all
  // =========================================================================
  describe('review confirm --all / --recent, review reject --all', () => {
    it('should confirm all pending drafts with --all flag', async () => {
      sqliteStore.storeCandidate(makeCandidate({ id: 'all-c-001', sessionId: 's1', frustrationSignature: 'Error A' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'all-c-002', sessionId: 's2', frustrationSignature: 'Error B' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'all-c-003', sessionId: 's3', frustrationSignature: 'Error C' }));

      const { output } = await runCommand(['review', 'confirm', '--all'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      expect(sqliteStore.getExperience('all-c-001')).not.toBeNull();
      expect(sqliteStore.getExperience('all-c-002')).not.toBeNull();
      expect(sqliteStore.getExperience('all-c-003')).not.toBeNull();
      expect(sqliteStore.getPendingDrafts()).toHaveLength(0);
      expect(output).toContain('3');
    });

    it('should reject all pending drafts with --all flag', async () => {
      sqliteStore.storeCandidate(makeCandidate({ id: 'all-r-001', sessionId: 's1' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'all-r-002', sessionId: 's2' }));

      const { output } = await runCommand(['review', 'reject', '--all'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      expect(sqliteStore.getPendingDrafts()).toHaveLength(0);
      expect(sqliteStore.getExperience('all-r-001')).toBeNull();
      expect(sqliteStore.getExperience('all-r-002')).toBeNull();
      expect(output).toContain('2');
    });

    it('should show message when confirm --all has no pending drafts', async () => {
      const { output } = await runCommand(['review', 'confirm', '--all'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      expect(output.toLowerCase()).toContain('no pending drafts');
    });

    it('should show message when reject --all has no pending drafts', async () => {
      const { output } = await runCommand(['review', 'reject', '--all'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      expect(output.toLowerCase()).toContain('no pending drafts');
    });

    it('should continue confirming remaining drafts when one fails with --all', async () => {
      sqliteStore.storeCandidate(makeCandidate({ id: 'all-f-001', sessionId: 's1' }));
      sqliteStore.storeCandidate(makeCandidate({ id: 'all-f-002', sessionId: 's2' }));

      let callCount = 0;
      const spiedProvider = new MockLLMProvider();
      jest.spyOn(spiedProvider, 'generateEmbedding').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Embedding failed');
        return [0.1, 0.2, 0.3];
      });

      const { errorOutput } = await runCommand(['review', 'confirm', '--all'], {
        sqliteStore,
        vectorStore,
        llmProvider: spiedProvider,
      });

      expect(sqliteStore.getExperience('all-f-002')).not.toBeNull();
      expect(errorOutput).toContain('all-f-001');
    });

    it('should confirm the most recent draft with --recent flag', async () => {
      // Arrange: store drafts with different createdAt
      sqliteStore.storeCandidate(makeCandidate({
        id: 'recent-001', sessionId: 's1',
        frustrationSignature: 'Old error',
        createdAt: '2026-02-20T00:00:00Z',
      }));
      sqliteStore.storeCandidate(makeCandidate({
        id: 'recent-002', sessionId: 's2',
        frustrationSignature: 'New error',
        createdAt: '2026-02-23T12:00:00Z',
      }));

      const { output } = await runCommand(['review', 'confirm', '--recent'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Only the most recent draft should be confirmed
      expect(sqliteStore.getExperience('recent-002')).not.toBeNull();
      // The older draft should still be pending
      expect(sqliteStore.getExperience('recent-001')).toBeNull();
      expect(sqliteStore.getPendingDrafts()).toHaveLength(1);
      expect(output).toContain('recent-002');
    });

    it('should show message when confirm --recent has no pending drafts', async () => {
      const { output } = await runCommand(['review', 'confirm', '--recent'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      expect(output.toLowerCase()).toContain('no pending drafts');
    });
  });

  // =========================================================================
  // review confirm - evolution: confirm with matchedExperienceId
  // =========================================================================
  describe('review confirm - evolution', () => {
    /**
     * Evolution logic: when a draft has `matchedExperienceId`, the confirm
     * flow should attempt to EVOLVE the existing experience instead of
     * creating a new one.
     *
     * Flow:
     *   1. Look up existing experience by matchedExperienceId
     *   2. Run LLM summarization on the new transcript (1st LLM call)
     *   3. Run LLM evolution judge comparing old vs new (2nd LLM call)
     *   4. If isBetter === true: update existing experience (evolve)
     *   5. If isBetter === false or LLM fails: create new experience (fallback)
     *
     * These tests define the expected behavior BEFORE the evolution
     * implementation exists. All tests should FAIL initially.
     */

    it('should evolve existing experience when matchedExperienceId is present and LLM says isBetter', async () => {
      // Arrange: 1. Store an existing experience
      const existingExp = {
        id: 'exp-existing',
        frustrationSignature: 'Old error pattern',
        failedApproaches: ['Old approach 1'],
        successfulApproach: 'Old solution',
        lessons: ['Old lesson'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 1,
      };
      sqliteStore.storeExperience(existingExp);
      const embedding = await llmProvider.generateEmbedding('Old error pattern');
      vectorStore.store('exp-existing', embedding, { frustrationSignature: 'Old error pattern' });

      // 2. Store a draft with matchedExperienceId pointing to the existing experience
      const draft = makeCandidate({
        id: 'draft-evo',
        matchedExperienceId: 'exp-existing',
        transcriptData: JSON.stringify({
          messages: [
            { role: 'user', content: 'This error again!' },
            { role: 'assistant', content: 'I found a better fix.' },
          ],
          toolCalls: [],
          errors: [],
        }),
      });
      sqliteStore.storeCandidate(draft);

      // 3. Mock LLM to return evolution-favorable responses
      //    First call: lessonSummarization -> extract new note fields
      //    Second call: evolutionJudge -> determine if new is better
      const mockProvider = new MockLLMProvider();
      let callCount = 0;
      mockProvider.generateCompletion = async (_system: string, _user: string) => {
        callCount++;
        if (callCount === 1) {
          // lessonSummarization response
          return JSON.stringify({
            frustrationSignature: 'New error pattern',
            failedApproaches: ['New approach 1'],
            successfulApproach: 'Better solution',
            lessons: ['Better lesson'],
          });
        }
        // evolutionJudge response
        return JSON.stringify({
          isBetter: true,
          reasoning: 'The new solution is more comprehensive',
          mergedLessons: ['Old lesson', 'Better lesson'],
          newFailedApproachNote: 'Old solution was partial',
        });
      };

      // Act
      await runCommand(['review', 'confirm', 'draft-evo'], {
        sqliteStore,
        vectorStore,
        llmProvider: mockProvider,
      });

      // Assert: existing experience was updated (evolved), not a new one created
      const updated = sqliteStore.getExperience('exp-existing');
      expect(updated).not.toBeNull();
      expect(updated!.revision).toBe(2);
      expect(updated!.lessons).toContain('Better lesson');

      // Assert: revision history was stored for rollback/audit
      const revisions = sqliteStore.getRevisions('exp-existing');
      expect(revisions.length).toBeGreaterThanOrEqual(1);

      // Assert: draft was cleaned up
      const drafts = sqliteStore.getPendingDrafts();
      expect(drafts.find((d) => d.id === 'draft-evo')).toBeUndefined();
    });

    it('should create new experience when matchedExperienceId is present but LLM says not better', async () => {
      // Arrange: 1. Store existing experience
      const existingExp = {
        id: 'exp-existing-2',
        frustrationSignature: 'Some error',
        failedApproaches: ['Approach A'],
        successfulApproach: 'Solution A',
        lessons: ['Lesson A'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 1,
      };
      sqliteStore.storeExperience(existingExp);

      // 2. Store draft with matchedExperienceId
      const draft = makeCandidate({
        id: 'draft-not-better',
        matchedExperienceId: 'exp-existing-2',
        transcriptData: JSON.stringify({
          messages: [
            { role: 'user', content: 'Error' },
            { role: 'assistant', content: 'Fixed' },
          ],
          toolCalls: [],
          errors: [],
        }),
      });
      sqliteStore.storeCandidate(draft);

      // 3. Mock LLM: summarization OK, evolution judge returns isBetter: false
      const mockProvider = new MockLLMProvider();
      let callCount = 0;
      mockProvider.generateCompletion = async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            frustrationSignature: 'New sig',
            failedApproaches: ['New approach'],
            successfulApproach: 'New solution',
            lessons: ['New lesson'],
          });
        }
        return JSON.stringify({
          isBetter: false,
          reasoning: 'The old solution was better',
          mergedLessons: [],
          newFailedApproachNote: '',
        });
      };

      // Act
      await runCommand(['review', 'confirm', 'draft-not-better'], {
        sqliteStore,
        vectorStore,
        llmProvider: mockProvider,
      });

      // Assert: existing experience was NOT modified
      const existing = sqliteStore.getExperience('exp-existing-2');
      expect(existing!.revision).toBe(1);

      // Assert: a NEW experience was created with the draft's id
      const newExp = sqliteStore.getExperience('draft-not-better');
      expect(newExp).not.toBeNull();

      // Assert: draft was cleaned up
      const drafts = sqliteStore.getPendingDrafts();
      expect(drafts.find((d) => d.id === 'draft-not-better')).toBeUndefined();
    });

    it('should create new experience when matchedExperienceId points to deleted experience', async () => {
      // Arrange: no existing experience stored for the referenced ID.
      // The matchedExperienceId references an experience that was since deleted.
      const draft = makeCandidate({
        id: 'draft-deleted-ref',
        matchedExperienceId: 'exp-deleted',
        transcriptData: JSON.stringify({
          messages: [
            { role: 'user', content: 'Error' },
            { role: 'assistant', content: 'Fixed' },
          ],
          toolCalls: [],
          errors: [],
        }),
      });
      sqliteStore.storeCandidate(draft);

      // Act: use the default mock provider (returns non-JSON completion)
      await runCommand(['review', 'confirm', 'draft-deleted-ref'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: new experience created (fallback to normal confirm flow)
      const newExp = sqliteStore.getExperience('draft-deleted-ref');
      expect(newExp).not.toBeNull();

      // Assert: draft was cleaned up
      const drafts = sqliteStore.getPendingDrafts();
      expect(drafts.find((d) => d.id === 'draft-deleted-ref')).toBeUndefined();
    });

    it('should fallback to new experience when evolution LLM call fails', async () => {
      // Arrange: 1. Store existing experience
      const existingExp = {
        id: 'exp-existing-3',
        frustrationSignature: 'Error pattern',
        failedApproaches: ['Approach'],
        successfulApproach: 'Solution',
        lessons: ['Lesson'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 1,
      };
      sqliteStore.storeExperience(existingExp);

      // 2. Store draft with matchedExperienceId
      const draft = makeCandidate({
        id: 'draft-llm-fail',
        matchedExperienceId: 'exp-existing-3',
        transcriptData: JSON.stringify({
          messages: [
            { role: 'user', content: 'Error' },
            { role: 'assistant', content: 'Fixed' },
          ],
          toolCalls: [],
          errors: [],
        }),
      });
      sqliteStore.storeCandidate(draft);

      // 3. Mock LLM: first call (summarization) OK, second call (evolution judge) throws
      const mockProvider = new MockLLMProvider();
      let callCount = 0;
      mockProvider.generateCompletion = async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            frustrationSignature: 'New sig',
            failedApproaches: [],
            successfulApproach: 'New solution',
            lessons: ['New lesson'],
          });
        }
        throw new Error('LLM service unavailable');
      };

      // Act
      await runCommand(['review', 'confirm', 'draft-llm-fail'], {
        sqliteStore,
        vectorStore,
        llmProvider: mockProvider,
      });

      // Assert: existing experience was NOT modified (graceful degradation)
      const existing = sqliteStore.getExperience('exp-existing-3');
      expect(existing!.revision).toBe(1);

      // Assert: new experience created as fallback
      const newExp = sqliteStore.getExperience('draft-llm-fail');
      expect(newExp).not.toBeNull();
    });

    it('should demote old successfulApproach to failedApproaches on evolution', async () => {
      // Arrange: store existing experience with a successful approach
      // that should be demoted when a better one is found
      const existingExp = {
        id: 'exp-demote',
        frustrationSignature: 'Error X',
        failedApproaches: ['Failed A'],
        successfulApproach: 'Old success (to be demoted)',
        lessons: ['Old lesson'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 1,
      };
      sqliteStore.storeExperience(existingExp);
      const emb = await llmProvider.generateEmbedding('Error X');
      vectorStore.store('exp-demote', emb, { frustrationSignature: 'Error X' });

      const draft = makeCandidate({
        id: 'draft-demote',
        matchedExperienceId: 'exp-demote',
        transcriptData: JSON.stringify({
          messages: [
            { role: 'user', content: 'Error X again' },
            { role: 'assistant', content: 'Better fix' },
          ],
          toolCalls: [],
          errors: [],
        }),
      });
      sqliteStore.storeCandidate(draft);

      // Mock LLM: summarization + evolution judge both succeed
      const mockProvider = new MockLLMProvider();
      let callCount = 0;
      mockProvider.generateCompletion = async () => {
        callCount++;
        if (callCount === 1) {
          // lessonSummarization: extract fields from new transcript
          return JSON.stringify({
            frustrationSignature: 'Error X improved',
            failedApproaches: ['New failed approach'],
            successfulApproach: 'Better solution',
            lessons: ['Better lesson'],
          });
        }
        // evolutionJudge: new is better, old success should be demoted
        return JSON.stringify({
          isBetter: true,
          reasoning: 'Better',
          mergedLessons: ['Old lesson', 'Better lesson'],
          newFailedApproachNote: 'Old success was partial fix',
        });
      };

      // Act
      await runCommand(['review', 'confirm', 'draft-demote'], {
        sqliteStore,
        vectorStore,
        llmProvider: mockProvider,
      });

      // Assert: the evolved experience should have the old successfulApproach
      // demoted to failedApproaches and the new one set
      const updated = sqliteStore.getExperience('exp-demote');
      expect(updated).not.toBeNull();
      // Old successfulApproach should now be in failedApproaches
      expect(updated!.failedApproaches).toContain('Old success (to be demoted)');
      // New successfulApproach should be set
      expect(updated!.successfulApproach).toBe('Better solution');
      // Revision should be incremented
      expect(updated!.revision).toBe(2);
    });
  });

  // =========================================================================
  // review list - evolution candidate display
  // =========================================================================
  describe('review list - evolution candidate display', () => {
    it('should show (evolution candidate) when draft has matchedExperienceId', async () => {
      // Arrange: store a draft with matchedExperienceId set
      sqliteStore.storeCandidate(makeCandidate({
        id: 'draft-evo-display',
        matchedExperienceId: 'exp-some',
      }));

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should indicate this is an evolution candidate
      expect(output).toContain('draft-evo-display');
      expect(output).toContain('(evolution candidate)');
    });

    it('should NOT show (evolution candidate) when draft has no matchedExperienceId', async () => {
      // Arrange: store a draft without matchedExperienceId
      sqliteStore.storeCandidate(makeCandidate({
        id: 'draft-normal-display',
      }));

      // Act
      const { output } = await runCommand(['review', 'list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: should show draft ID but NOT the evolution candidate tag
      expect(output).toContain('draft-normal-display');
      expect(output).not.toContain('(evolution candidate)');
    });
  });
});
