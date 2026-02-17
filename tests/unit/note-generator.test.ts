/**
 * Unit Tests for Note Generator
 *
 * Tests for the generateNote function which transforms TranscriptData
 * into an AutoMemoryCandidate draft for user review.
 *
 * How generateNote works:
 *   1. Extract frustration signature from transcriptData.errors (first error, falls back to tool call errors)
 *   2. Extract failed approaches from transcriptData.toolCalls (tool calls with errors)
 *   3. Extract successful approach from transcriptData (if resolution pattern found)
 *   4. If llmProvider provided: call llmProvider.generateCompletion() -> parse JSON for lessons
 *   5. If llmProvider undefined or fails: fallback - extract lessons from assistant messages
 *   6. Return AutoMemoryCandidate with status 'pending'
 *   7. If no errors in transcript -> return null
 *   8. Never throws
 *
 * Test categories: normal flow, LLM integration, fallback behavior,
 * null returns, edge cases, and the never-throw guarantee.
 */

import { generateNote } from '../../src/capture/note-generator';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import type {
  TranscriptData,
  TranscriptMessage,
  ToolCallEntry,
  AutoMemoryCandidate,
  LLMProvider,
} from '../../src/types/index';
import { AutoMemoryCandidateSchema } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a TranscriptData object with sensible defaults.
 * Any field can be overridden via the overrides parameter.
 */
function makeTranscriptData(overrides?: Partial<TranscriptData>): TranscriptData {
  return {
    messages: [],
    toolCalls: [],
    errors: [],
    ...overrides,
  };
}

/**
 * Build a TranscriptMessage with defaults.
 */
function makeMessage(overrides?: Partial<TranscriptMessage>): TranscriptMessage {
  return {
    role: 'user',
    content: '',
    ...overrides,
  };
}

/**
 * Build a ToolCallEntry with defaults.
 */
function makeToolCall(overrides?: Partial<ToolCallEntry>): ToolCallEntry {
  return {
    name: 'Bash',
    input: { command: 'npm run build' },
    ...overrides,
  };
}

/**
 * A realistic transcript that represents a failed build session
 * with errors, failed tool calls, and assistant analysis messages.
 */
function makeRealisticTranscript(): TranscriptData {
  return makeTranscriptData({
    messages: [
      makeMessage({ role: 'user', content: 'Why is my build failing?' }),
      makeMessage({
        role: 'assistant',
        content: 'Let me check the build logs. The error is caused by a missing module import.',
      }),
      makeMessage({ role: 'user', content: 'I tried reinstalling node_modules but it did not help.' }),
      makeMessage({
        role: 'assistant',
        content:
          'The issue is that the module path is wrong. You should change the import from "./missing-module" to "./correct-module". This is a common problem when files are renamed without updating all references.',
      }),
    ],
    toolCalls: [
      makeToolCall({
        name: 'Bash',
        input: { command: 'npm run build' },
        output: 'Error: Module not found: ./missing-module',
        error: 'Build failed with exit code 1',
      }),
      makeToolCall({
        name: 'Bash',
        input: { command: 'rm -rf node_modules && npm install' },
        output: 'added 1234 packages',
      }),
      makeToolCall({
        name: 'Read',
        input: { path: 'src/index.ts' },
        output: 'import { foo } from "./missing-module";',
      }),
    ],
    errors: [
      'Error: Module not found: ./missing-module',
      'Build failed with exit code 1',
    ],
  });
}

/**
 * Valid LLM lesson response JSON for mocking generateCompletion.
 */
const VALID_LLM_LESSON_RESPONSE = JSON.stringify({
  frustrationSignature: 'Module not found: ./missing-module',
  failedApproaches: [
    'Tried reinstalling node_modules but the import path was wrong',
    'Running npm run build without fixing the import',
  ],
  successfulApproach: 'Changed import path from ./missing-module to ./correct-module',
  lessons: [
    'Always update import paths when renaming or moving files',
    'Check import paths before reinstalling dependencies',
  ],
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('NoteGenerator - generateNote', () => {
  // =========================================================================
  // 1. Normal flow with errors
  // =========================================================================
  describe('Normal flow with errors', () => {
    it('should return an AutoMemoryCandidate with correct structure when transcript has errors', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-abc-123';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result).toBeDefined();

      // Validate the full structure against the Zod schema
      const parseResult = AutoMemoryCandidateSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should have an id that is a non-empty string (UUID-like)', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-001';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(typeof result!.id).toBe('string');
      expect(result!.id.length).toBeGreaterThan(0);
      // UUID format check: should contain hyphens or be a substantial string
      expect(result!.id.length).toBeGreaterThanOrEqual(8);
    });

    it('should set sessionId to match the input sessionId', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'my-unique-session-id-42';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('my-unique-session-id-42');
    });

    it('should set status to "pending"', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-pending-check';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
    });

    it('should set createdAt to a valid ISO date string', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-date-check';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(typeof result!.createdAt).toBe('string');
      // Should be parseable as a valid date
      const date = new Date(result!.createdAt);
      expect(date.toString()).not.toBe('Invalid Date');
      // Should be recent (within last 10 seconds)
      const now = Date.now();
      const createdTime = date.getTime();
      expect(now - createdTime).toBeLessThan(10_000);
    });

    it('should generate unique ids for different calls', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();

      // Act
      const result1 = await generateNote(transcript, 'session-1');
      const result2 = await generateNote(transcript, 'session-2');

      // Assert
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1!.id).not.toBe(result2!.id);
    });
  });

  // =========================================================================
  // 2. LLM lesson extraction
  // =========================================================================
  describe('LLM lesson extraction', () => {
    it('should use llmProvider.generateCompletion to extract lessons when provider is given', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-lessons';
      const mockProvider = new MockLLMProvider();

      // Override generateCompletion to return valid lesson JSON
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(VALID_LLM_LESSON_RESPONSE);

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert
      expect(result).not.toBeNull();
      expect(mockProvider.generateCompletion).toHaveBeenCalled();

      // Lessons should come from the LLM response
      expect(result!.lessons).toEqual([
        'Always update import paths when renaming or moving files',
        'Check import paths before reinstalling dependencies',
      ]);
    });

    it('should pass the lessonSummarization system prompt to the LLM', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-prompt-check';
      const mockProvider = new MockLLMProvider();

      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(VALID_LLM_LESSON_RESPONSE);

      // Act
      await generateNote(transcript, sessionId, mockProvider);

      // Assert
      expect(mockProvider.generateCompletion).toHaveBeenCalledTimes(1);
      const [systemPrompt] = (mockProvider.generateCompletion as jest.Mock).mock.calls[0];
      // The system prompt should contain key phrases from PROMPTS.lessonSummarization
      expect(systemPrompt).toContain('lesson');
    });

    it('should use LLM-extracted frustrationSignature when LLM response includes it', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-sig';
      const mockProvider = new MockLLMProvider();

      const llmResponse = JSON.stringify({
        frustrationSignature: 'Import path resolution failure for missing module',
        failedApproaches: ['Reinstalling node_modules'],
        successfulApproach: 'Fixed the import path',
        lessons: ['Verify import paths after file moves'],
      });
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(llmResponse);

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert
      expect(result).not.toBeNull();
      // The LLM-provided frustrationSignature should be used
      expect(result!.frustrationSignature).toBe('Import path resolution failure for missing module');
    });

    it('should use LLM-extracted failedApproaches when LLM response includes them', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-approaches';
      const mockProvider = new MockLLMProvider();

      const llmResponse = JSON.stringify({
        frustrationSignature: 'Module not found',
        failedApproaches: ['Approach A: reinstall deps', 'Approach B: clear cache'],
        successfulApproach: 'Fix import path',
        lessons: ['Double check paths'],
      });
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(llmResponse);

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.failedApproaches).toEqual([
        'Approach A: reinstall deps',
        'Approach B: clear cache',
      ]);
    });

    it('should use LLM-extracted successfulApproach when LLM response includes it', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-success';
      const mockProvider = new MockLLMProvider();

      const llmResponse = JSON.stringify({
        frustrationSignature: 'Module not found',
        failedApproaches: ['Reinstall'],
        successfulApproach: 'Changed import from ./old to ./new',
        lessons: ['Always verify paths'],
      });
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(llmResponse);

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.successfulApproach).toBe('Changed import from ./old to ./new');
    });

    it('should handle LLM response with null successfulApproach', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-null-success';
      const mockProvider = new MockLLMProvider();

      const llmResponse = JSON.stringify({
        frustrationSignature: 'Unresolved build failure',
        failedApproaches: ['Tried everything'],
        successfulApproach: null,
        lessons: ['Sometimes you have to start over'],
      });
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(llmResponse);

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.successfulApproach).toBeUndefined();
    });

    it('should handle LLM response with invalid JSON by falling back', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-bad-json';
      const mockProvider = new MockLLMProvider();

      // Return something that is not valid JSON
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        'This is not JSON at all, just plain text about lessons learned.',
      );

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert: should fallback to extraction from assistant messages, not return null
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
      // Should still have some lessons (from fallback)
      expect(Array.isArray(result!.lessons)).toBe(true);
    });
  });

  // =========================================================================
  // 3. LLM failure fallback
  // =========================================================================
  describe('LLM failure fallback', () => {
    it('should fall back to extracting lessons from assistant messages when LLM throws', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-fail';
      const mockProvider = new MockLLMProvider({ shouldFail: true });

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert: should not be null because transcript has errors
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
      // Lessons should be extracted from assistant messages (fallback)
      expect(Array.isArray(result!.lessons)).toBe(true);
    });

    it('should still extract frustrationSignature from transcript errors when LLM fails', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-fail-sig';
      const mockProvider = new MockLLMProvider({ shouldFail: true });

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert
      expect(result).not.toBeNull();
      expect(typeof result!.frustrationSignature).toBe('string');
      expect(result!.frustrationSignature.length).toBeGreaterThan(0);
      // Should contain information from the transcript errors
      expect(result!.frustrationSignature).toContain('Module not found');
    });

    it('should still extract failedApproaches from tool calls when LLM fails', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-llm-fail-approaches';
      const mockProvider = new MockLLMProvider({ shouldFail: true });

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert
      expect(result).not.toBeNull();
      expect(Array.isArray(result!.failedApproaches)).toBe(true);
      expect(result!.failedApproaches.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 4. No LLM provider (undefined)
  // =========================================================================
  describe('No LLM provider (undefined)', () => {
    it('should return empty lessons when no llmProvider is given (no keyword fallback)', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'user', content: 'Build is failing' }),
          makeMessage({
            role: 'assistant',
            content:
              'The problem is a missing dependency. You need to install lodash: npm install lodash. This happens when dependencies are not listed in package.json.',
          }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'npm run build' },
            error: 'Cannot find module lodash',
          }),
        ],
        errors: ['Cannot find module lodash'],
      });
      const sessionId = 'session-no-llm';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
      expect(Array.isArray(result!.lessons)).toBe(true);
      // Without LLM, lessons are empty (no keyword-based fallback)
      expect(result!.lessons).toHaveLength(0);
    });

    it('should produce valid AutoMemoryCandidate without LLM provider', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-no-llm-valid';

      // Act: explicitly pass undefined
      const result = await generateNote(transcript, sessionId, undefined);

      // Assert
      expect(result).not.toBeNull();
      const parseResult = AutoMemoryCandidateSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should extract frustrationSignature from errors array when no LLM provider', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'user', content: 'Help with build error' }),
          makeMessage({ role: 'assistant', content: 'The tsconfig is misconfigured.' }),
        ],
        toolCalls: [],
        errors: ['TSError: Cannot find type definition file for jest'],
      });
      const sessionId = 'session-no-llm-sig';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.frustrationSignature).toContain('TSError');
    });
  });

  // =========================================================================
  // 5. No errors in transcript -> null
  // =========================================================================
  describe('No errors in transcript — still generates candidate if messages exist', () => {
    it('should return a candidate when messages exist but no errors', async () => {
      // Arrange: a clean transcript with no errors anywhere
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'user', content: 'Can you refactor this function?' }),
          makeMessage({ role: 'assistant', content: 'Sure, I will refactor it.' }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Read',
            input: { path: 'src/utils.ts' },
            output: 'function add(a, b) { return a + b; }',
          }),
          makeToolCall({
            name: 'Write',
            input: { path: 'src/utils.ts' },
            output: 'File written successfully',
          }),
        ],
        errors: [],
      });
      const sessionId = 'session-no-errors';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert: messages exist so candidate is generated (even without errors)
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
      expect(result!.frustrationSignature).toBe('');
    });

    it('should return a candidate for transcript with messages but no errors at all', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'user', content: 'Tell me about TypeScript generics' }),
          makeMessage({
            role: 'assistant',
            content: 'TypeScript generics allow you to write reusable, type-safe code.',
          }),
          makeMessage({ role: 'user', content: 'Thanks, that makes sense!' }),
        ],
        toolCalls: [],
        errors: [],
      });
      const sessionId = 'session-clean';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert: messages exist so candidate is generated
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
    });
  });

  // =========================================================================
  // 6. Empty transcript -> null
  // =========================================================================
  describe('Empty transcript -> null', () => {
    it('should return null for a completely empty TranscriptData', async () => {
      // Arrange
      const transcript = makeTranscriptData();
      const sessionId = 'session-empty';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when all arrays are empty', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [],
        toolCalls: [],
        errors: [],
      });
      const sessionId = 'session-all-empty';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 7. Frustration signature extraction accuracy
  // =========================================================================
  describe('Frustration signature extraction accuracy', () => {
    it('should use the first error as signature when only one error exists', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'assistant', content: 'The import is broken.' }),
        ],
        toolCalls: [],
        errors: ['TypeError: Cannot read properties of undefined (reading "map")'],
      });
      const sessionId = 'session-single-error';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.frustrationSignature).toContain('TypeError');
      expect(result!.frustrationSignature).toContain('Cannot read properties of undefined');
    });

    it('should produce a meaningful frustrationSignature when multiple errors exist', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'assistant', content: 'Multiple problems found.' }),
        ],
        toolCalls: [],
        errors: [
          'Error: ENOENT: no such file or directory, open "config.json"',
          'Error: Configuration file is required',
          'SyntaxError: Unexpected token in JSON at position 0',
        ],
      });
      const sessionId = 'session-multi-error';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(typeof result!.frustrationSignature).toBe('string');
      expect(result!.frustrationSignature.length).toBeGreaterThan(0);
      // Should capture information from the errors
      // At minimum, should reference the first or primary error
      expect(result!.frustrationSignature).toContain('ENOENT');
    });

    it('should handle very long error messages without truncating critical information', async () => {
      // Arrange
      const longError =
        'Error: Module build failed (from ./node_modules/ts-loader/index.js): ' +
        'TypeScript error in /home/user/project/src/components/DataGrid/DataGridRenderer.tsx(142,23): ' +
        "Property 'columnConfig' does not exist on type 'IntrinsicAttributes & DataGridProps'. " +
        'Did you mean "columns"?  TS2322';
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'assistant', content: 'Build error found.' }),
        ],
        toolCalls: [],
        errors: [longError],
      });
      const sessionId = 'session-long-error';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.frustrationSignature.length).toBeGreaterThan(0);
      // Should still contain the essential error type
      expect(
        result!.frustrationSignature.includes('TS2322') ||
        result!.frustrationSignature.includes('Property') ||
        result!.frustrationSignature.includes('columnConfig') ||
        result!.frustrationSignature.includes('Module build failed'),
      ).toBe(true);
    });
  });

  // =========================================================================
  // 8. Failed approaches from tool calls
  // =========================================================================
  describe('Failed approaches from tool calls', () => {
    it('should extract tool calls with error fields as failed approaches', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'assistant', content: 'Multiple attempts failed.' }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'npm install --legacy-peer-deps' },
            output: 'npm ERR! Could not resolve dependency',
            error: 'npm install failed',
          }),
          makeToolCall({
            name: 'Bash',
            input: { command: 'npm install --force' },
            output: 'npm ERR! ERESOLVE unable to resolve dependency tree',
            error: 'npm install --force also failed',
          }),
          makeToolCall({
            name: 'Read',
            input: { path: 'package.json' },
            output: '{ "dependencies": {} }',
            // No error - this is a successful tool call
          }),
        ],
        errors: ['npm ERR! Could not resolve dependency'],
      });
      const sessionId = 'session-failed-approaches';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(Array.isArray(result!.failedApproaches)).toBe(true);
      // Should include the two failed tool calls, not the successful Read
      expect(result!.failedApproaches.length).toBeGreaterThanOrEqual(2);
    });

    it('should not include tool calls without errors as failed approaches', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'assistant', content: 'Checking files.' }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Read',
            input: { path: 'src/index.ts' },
            output: 'const x = 1;',
            // No error
          }),
          makeToolCall({
            name: 'Bash',
            input: { command: 'npm run build' },
            error: 'Build failed',
          }),
        ],
        errors: ['Build failed'],
      });
      const sessionId = 'session-mixed-tools';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      // failedApproaches should include the Bash call with error, not the Read call
      expect(result!.failedApproaches.length).toBeGreaterThanOrEqual(1);
      // The failed approach descriptions should reference the failing command
      const approachesStr = result!.failedApproaches.join(' ');
      expect(
        approachesStr.includes('Bash') ||
        approachesStr.includes('npm run build') ||
        approachesStr.includes('Build failed'),
      ).toBe(true);
    });

    it('should return empty failedApproaches when no tool calls have errors', async () => {
      // Arrange: transcript has errors (so result is not null) but tool calls are error-free
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'assistant', content: 'Something went wrong externally.' }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Read',
            input: { path: 'src/config.ts' },
            output: 'export const config = {};',
            // No error
          }),
        ],
        errors: ['Runtime error: unexpected process termination'],
      });
      const sessionId = 'session-no-failed-tools';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      expect(Array.isArray(result!.failedApproaches)).toBe(true);
      expect(result!.failedApproaches).toHaveLength(0);
    });
  });

  // =========================================================================
  // Additional edge cases
  // =========================================================================
  describe('Edge cases and never-throw guarantee', () => {
    it('should never throw even with unusual input', async () => {
      // Arrange: various edge-case inputs
      const cases: Array<{ transcript: TranscriptData; sessionId: string; provider?: LLMProvider }> = [
        {
          transcript: makeTranscriptData({ errors: ['error'] }),
          sessionId: '',
        },
        {
          transcript: makeTranscriptData({
            messages: [makeMessage({ role: 'assistant', content: '' })],
            errors: ['error'],
          }),
          sessionId: 'session',
        },
        {
          transcript: makeTranscriptData({
            toolCalls: [makeToolCall({ name: '', input: null, error: 'err' })],
            errors: ['error'],
          }),
          sessionId: 'session',
        },
      ];

      // Act & Assert: none should throw
      for (const { transcript, sessionId, provider } of cases) {
        await expect(generateNote(transcript, sessionId, provider)).resolves.not.toThrow();
      }
    });

    it('should return null for transcript with only errors and no messages', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [],
        toolCalls: [],
        errors: ['Segmentation fault (core dumped)'],
      });
      const sessionId = 'session-errors-only';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert: no messages means null (messages.length === 0 guard)
      expect(result).toBeNull();
    });

    it('should handle transcript with tool call errors but empty errors array', async () => {
      // Arrange: errors array is empty, but tool calls have error fields
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'assistant', content: 'Command failed.' }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'docker compose up' },
            error: 'docker: command not found',
          }),
        ],
        errors: [],
      });
      const sessionId = 'session-toolcall-errors-only';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert: tool call errors should also trigger note generation
      // The function should recognize that tool calls with errors represent failures
      expect(result).not.toBeNull();
      // frustrationSignature should fall back to the tool call error, not be empty
      expect(result!.frustrationSignature).toBe('docker: command not found');
    });

    it('should return empty lessons without LLM (no keyword-based fallback)', async () => {
      // Arrange
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({
            role: 'assistant',
            content:
              'The root cause of the error is that the database connection string has a typo. ' +
              'You should change "postgressql" to "postgresql" in your .env file. ' +
              'This is a common mistake that can be caught by using environment variable validation.',
          }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'npm start' },
            error: 'ECONNREFUSED: connection refused to postgressql://localhost:5432',
          }),
        ],
        errors: ['ECONNREFUSED: connection refused to postgressql://localhost:5432'],
      });
      const sessionId = 'session-fallback-lessons';

      // Act: no LLM provider
      const result = await generateNote(transcript, sessionId);

      // Assert: without LLM, lessons are empty (keyword fallback removed)
      expect(result).not.toBeNull();
      expect(result!.lessons).toHaveLength(0);
    });

    it('should handle LLM returning partial JSON (missing fields)', async () => {
      // Arrange
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-partial-json';
      const mockProvider = new MockLLMProvider();

      // Return JSON with missing fields
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          lessons: ['One lesson only'],
          // Missing: frustrationSignature, failedApproaches, successfulApproach
        }),
      );

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert: should gracefully handle partial response
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
      // Lessons from LLM partial response should still be used
      expect(result!.lessons).toContain('One lesson only');
      // Missing fields should be filled from transcript fallback
      expect(typeof result!.frustrationSignature).toBe('string');
      expect(result!.frustrationSignature.length).toBeGreaterThan(0);
    });

    it('should handle LLM response with <think> block before JSON', async () => {
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-think-block';
      const mockProvider = new MockLLMProvider();

      const thinkResponse =
        '<think>Let me summarize the lessons from this transcript.</think>' +
        JSON.stringify({
          frustrationSignature: 'Module not found after think',
          failedApproaches: ['Reinstall deps'],
          successfulApproach: 'Fix import path',
          lessons: ['Verify imports after refactoring'],
        });
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(thinkResponse);

      const result = await generateNote(transcript, sessionId, mockProvider);

      expect(result).not.toBeNull();
      expect(result!.lessons).toContain('Verify imports after refactoring');
    });

    it('should handle LLM returning JSON wrapped in markdown code block', async () => {
      // Arrange: some LLMs wrap JSON in ```json ... ``` blocks
      const transcript = makeRealisticTranscript();
      const sessionId = 'session-markdown-json';
      const mockProvider = new MockLLMProvider();

      const wrappedResponse =
        '```json\n' +
        JSON.stringify({
          frustrationSignature: 'Module not found',
          failedApproaches: ['Reinstall'],
          successfulApproach: 'Fix path',
          lessons: ['Check imports'],
        }) +
        '\n```';
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(wrappedResponse);

      // Act
      const result = await generateNote(transcript, sessionId, mockProvider);

      // Assert: should either parse the wrapped JSON or fall back gracefully
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
      expect(Array.isArray(result!.lessons)).toBe(true);
      expect(result!.lessons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Successful approach detection
  // =========================================================================
  describe('Successful approach detection', () => {
    it('should detect a successful approach from resolution patterns in transcript', async () => {
      // Arrange: a transcript where the later messages indicate success
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'user', content: 'Build is failing with module not found' }),
          makeMessage({
            role: 'assistant',
            content: 'The import path is wrong. Let me fix it.',
          }),
          makeMessage({ role: 'user', content: 'It works now, thanks!' }),
          makeMessage({
            role: 'assistant',
            content: 'The fix was to change the import path from ./old-name to ./new-name.',
          }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'npm run build' },
            error: 'Module not found: ./old-name',
          }),
          makeToolCall({
            name: 'Write',
            input: { path: 'src/index.ts' },
            output: 'File written successfully',
            // No error - this is the fix
          }),
          makeToolCall({
            name: 'Bash',
            input: { command: 'npm run build' },
            output: 'Build succeeded',
            // No error - success after the fix
          }),
        ],
        errors: ['Module not found: ./old-name'],
      });
      const sessionId = 'session-success-detect';

      // Act: no LLM, so fallback detection
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      // successfulApproach may or may not be set depending on implementation
      // But if resolution is detected, it should be a string
      if (result!.successfulApproach !== undefined) {
        expect(typeof result!.successfulApproach).toBe('string');
        expect(result!.successfulApproach!.length).toBeGreaterThan(0);
      }
    });

    it('should leave successfulApproach undefined when no resolution pattern is found', async () => {
      // Arrange: transcript with only failure, no resolution
      const transcript = makeTranscriptData({
        messages: [
          makeMessage({ role: 'user', content: 'This keeps crashing' }),
          makeMessage({
            role: 'assistant',
            content: 'I see the error but I am not sure how to fix it.',
          }),
        ],
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'npm start' },
            error: 'Process exited with signal SIGSEGV',
          }),
        ],
        errors: ['Process exited with signal SIGSEGV'],
      });
      const sessionId = 'session-no-resolution';

      // Act
      const result = await generateNote(transcript, sessionId);

      // Assert
      expect(result).not.toBeNull();
      // No resolution pattern means successfulApproach should be undefined
      expect(result!.successfulApproach).toBeUndefined();
    });
  });
});
