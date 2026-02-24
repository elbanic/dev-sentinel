/**
 * Unit Tests for CLI experience commands
 *
 * Extracted from cli.test.ts to reduce file size.
 * Tests experience-related commands:
 *   - add <path>: import markdown files as experiences
 *   - list: show stored experiences
 *   - delete <id>: remove individual experience
 *   - reset: clear all data
 *   - detail <id>: show full experience details
 *   - list - revision display
 *   - detail - revision display
 *   - history command
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import {
  runCommand,
  makeCandidate,
  createTestDeps,
  cleanupDeps,
} from '../helpers/cli-test-helpers';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CLI - experience commands', () => {
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
        revision: 1,
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
        revision: 1,
      });
      sqliteStore.storeExperience({
        id: 'exp-B',
        frustrationSignature: 'Error B',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-17T11:00:00Z',
        revision: 1,
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
        revision: 1,
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
        revision: 1,
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
        revision: 1,
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
        revision: 1,
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
        revision: 1,
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
        revision: 1,
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
  // 20. list - revision display
  // =========================================================================
  describe('list - revision display', () => {
    it('should show (v2) next to experience ID when revision > 1', async () => {
      // Arrange: store an experience at revision 2
      sqliteStore.storeExperience({
        id: 'exp-v2',
        frustrationSignature: 'Evolved error',
        failedApproaches: ['Old approach'],
        successfulApproach: 'New solution',
        lessons: ['Evolved lesson'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 2,
      });

      // Act
      const { output } = await runCommand(['list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should contain the ID and a (v2) version tag
      expect(output).toContain('exp-v2');
      expect(output).toContain('(v2)');
    });

    it('should NOT show version tag for revision 1', async () => {
      // Arrange: store an experience at the default revision 1
      sqliteStore.storeExperience({
        id: 'exp-v1',
        frustrationSignature: 'Normal error',
        failedApproaches: [],
        successfulApproach: 'Solution',
        lessons: ['Lesson'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 1,
      });

      // Act
      const { output } = await runCommand(['list'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: should show the ID but NOT a (v1) tag
      expect(output).toContain('exp-v1');
      expect(output).not.toContain('(v1)');
    });
  });

  // =========================================================================
  // 21. detail - revision display
  // =========================================================================
  describe('detail - revision display', () => {
    it('should show revision number in detail view', async () => {
      // Arrange: store an experience at revision 3
      sqliteStore.storeExperience({
        id: 'exp-detail-rev',
        frustrationSignature: 'Multi-evolved error',
        failedApproaches: ['Old approach'],
        successfulApproach: 'Latest solution',
        lessons: ['Latest lesson'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 3,
      });

      // Act
      const { output } = await runCommand(['detail', 'exp-detail-rev'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should contain the revision number
      expect(output).toContain('exp-detail-rev');
      expect(output).toMatch(/[Rr]evision.*3|v3/);
    });
  });

  // =========================================================================
  // 23. history command: show revision history for an experience
  // =========================================================================
  describe('history command', () => {
    it('should show revision history for an experience', async () => {
      // Arrange: store experience at revision 2 and its revision 1 snapshot
      sqliteStore.storeExperience({
        id: 'exp-history',
        frustrationSignature: 'Current state',
        failedApproaches: ['approach 1', 'old success'],
        successfulApproach: 'New solution',
        lessons: ['New lesson'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 2,
      });

      sqliteStore.storeRevision({
        id: 'rev-001',
        experienceId: 'exp-history',
        revision: 1,
        frustrationSignature: 'Original state',
        failedApproaches: ['approach 1'],
        successfulApproach: 'Old solution',
        lessons: ['Old lesson'],
        createdAt: '2026-01-01T00:00:00Z',
      });

      // Act
      const { output } = await runCommand(['history', 'exp-history'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: output should contain revision history details
      expect(output).toContain('exp-history');
      expect(output).toContain('v1');
      expect(output).toContain('Original state');
      expect(output).toContain('Old solution');
    });

    it('should show error message for non-existent experience', async () => {
      // Arrange: no experience stored

      // Act
      const { output, errorOutput } = await runCommand(['history', 'non-existent'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: should indicate the experience was not found
      const combinedOutput = (output + errorOutput).toLowerCase();
      expect(combinedOutput).toContain('not found');
    });

    it('should show message when no revision history exists', async () => {
      // Arrange: store experience at revision 1 (no revisions table entries)
      sqliteStore.storeExperience({
        id: 'exp-no-history',
        frustrationSignature: 'Some error',
        failedApproaches: [],
        successfulApproach: 'Solution',
        lessons: ['Lesson'],
        createdAt: '2026-01-01T00:00:00Z',
        revision: 1,
      });

      // Act
      const { output } = await runCommand(['history', 'exp-no-history'], {
        sqliteStore,
        vectorStore,
        llmProvider,
      });

      // Assert: should indicate no revision history
      expect(output).toContain('No revision history');
    });
  });
});
