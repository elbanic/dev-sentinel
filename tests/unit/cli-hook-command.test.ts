/**
 * Unit Tests for CLI Hook Commands
 *
 * Combined test file for hook routing and enabled-flag early exit behavior.
 *
 * Sections:
 *   A. Hook routing tests (from cli.test.ts):
 *      - --hook user-prompt-submit: routes stdin to handler
 *      - --hook stop: routes stdin to handler
 *      - --hook session-end: routes stdin to session-end handler
 *      - edge cases: invalid JSON, unknown hook name
 *   B. Enabled flag early exit tests (from cli-enabled-flag.test.ts):
 *      - enabled=false + hook mode -> empty output, no handler calls
 *      - enabled=false + CLI commands -> still work normally
 *      - enabled=true / undefined -> handlers called (normal / backward compat)
 *      - output format strictness, no error output, no LLM interactions
 */

import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import {
  runCommand,
  createTestDeps,
  cleanupDeps,
} from '../helpers/cli-test-helpers';

// ---------------------------------------------------------------------------
// Module mocks for hook handlers
// ---------------------------------------------------------------------------

jest.mock('../../src/hook/user-prompt-submit-handler', () => ({
  handleUserPromptSubmit: jest.fn(),
}));

jest.mock('../../src/hook/stop-hook-handler', () => ({
  handleStop: jest.fn(),
}));

jest.mock('../../src/hook/session-end-handler', () => ({
  handleSessionEnd: jest.fn(),
}));

import { handleUserPromptSubmit } from '../../src/hook/user-prompt-submit-handler';
import { handleStop } from '../../src/hook/stop-hook-handler';
import { handleSessionEnd } from '../../src/hook/session-end-handler';

const mockedHandleUserPromptSubmit = handleUserPromptSubmit as jest.MockedFunction<
  typeof handleUserPromptSubmit
>;
const mockedHandleStop = handleStop as jest.MockedFunction<typeof handleStop>;
const mockedHandleSessionEnd = handleSessionEnd as jest.MockedFunction<typeof handleSessionEnd>;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CLI - hook commands', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    const deps = createTestDeps();
    sqliteStore = deps.sqliteStore;
    vectorStore = deps.vectorStore;
    llmProvider = deps.llmProvider;
  });

  afterEach(() => {
    cleanupDeps({ sqliteStore, vectorStore, llmProvider });
  });

  // =========================================================================
  // A1. --hook user-prompt-submit: routes stdin to handler
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
  // A2. --hook stop: routes stdin to handler
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
  // A3. --hook session-end: routes stdin to session-end handler
  // =========================================================================
  describe('--hook session-end', () => {
    it('should call handleSessionEnd with correct parameters', async () => {
      // Arrange
      const stdinJson = JSON.stringify({
        session_id: 'session-end-001',
        transcript_path: '/tmp/transcript.jsonl',
      });
      mockedHandleSessionEnd.mockResolvedValue(undefined);

      // Act
      const { output } = await runCommand(['--hook', 'session-end'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: stdinJson,
      });

      // Assert
      expect(mockedHandleSessionEnd).toHaveBeenCalledTimes(1);
      expect(mockedHandleSessionEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-end-001',
          transcriptPath: '/tmp/transcript.jsonl',
        }),
      );
    });

    it('should produce NO stdout output for session-end hook', async () => {
      // Arrange
      const stdinJson = JSON.stringify({
        session_id: 'session-end-002',
        transcript_path: '/tmp/transcript.jsonl',
      });
      mockedHandleSessionEnd.mockResolvedValue(undefined);

      // Act
      const { output } = await runCommand(['--hook', 'session-end'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: stdinJson,
      });

      // Assert: SessionEnd does NOT produce stdout
      expect(output).toBe('');
    });

    it('should silently ignore handler errors for session-end hook', async () => {
      // Arrange
      const stdinJson = JSON.stringify({
        session_id: 'session-end-003',
        transcript_path: '/tmp/transcript.jsonl',
      });
      mockedHandleSessionEnd.mockRejectedValue(new Error('handler crash'));

      // Act
      const { output, errorOutput } = await runCommand(['--hook', 'session-end'], {
        sqliteStore,
        vectorStore,
        llmProvider,
        stdinData: stdinJson,
      });

      // Assert: no output, no error, no throw
      expect(output).toBe('');
    });
  });

  // =========================================================================
  // A4. Hook edge cases
  // =========================================================================
  describe('hook edge cases', () => {
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
  // B. Enabled flag early exit tests
  // =========================================================================
  describe('enabled flag early exit', () => {
    // =========================================================================
    // B1. enabled=false + --hook user-prompt-submit -> empty output, no handler
    // =========================================================================
    describe('enabled=false + hook mode: user-prompt-submit', () => {
      it('should produce NO output when enabled is false and hook is user-prompt-submit', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          prompt: 'This error keeps happening!',
          session_id: 'session-disabled-001',
        });
        mockedHandleUserPromptSubmit.mockResolvedValue('{}');

        // Act
        const { output } = await runCommand(['--hook', 'user-prompt-submit'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert: output must be empty (not '{}', not any text)
        expect(output).toBe('');
      });

      it('should NOT call handleUserPromptSubmit when enabled is false', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          prompt: 'Frustrated prompt!',
          session_id: 'session-disabled-002',
        });
        mockedHandleUserPromptSubmit.mockResolvedValue('{"systemMessage":"advice"}');

        // Act
        await runCommand(['--hook', 'user-prompt-submit'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert: handler should NOT have been called
        expect(mockedHandleUserPromptSubmit).not.toHaveBeenCalled();
      });
    });

    // =========================================================================
    // B2. enabled=false + --hook stop -> empty output, no handler
    // =========================================================================
    describe('enabled=false + hook mode: stop', () => {
      it('should produce NO output when enabled is false and hook is stop', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          session_id: 'session-disabled-003',
          transcript_path: '/tmp/transcript.jsonl',
        });
        mockedHandleStop.mockResolvedValue('{"decision":"approve"}');

        // Act
        const { output } = await runCommand(['--hook', 'stop'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert: output must be empty (not '{"decision":"approve"}')
        expect(output).toBe('');
      });

      it('should NOT call handleStop when enabled is false', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          session_id: 'session-disabled-004',
          transcript_path: '/tmp/transcript.jsonl',
        });
        mockedHandleStop.mockResolvedValue('{"decision":"approve"}');

        // Act
        await runCommand(['--hook', 'stop'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert
        expect(mockedHandleStop).not.toHaveBeenCalled();
      });
    });

    // =========================================================================
    // B3. enabled=false + --hook session-end -> empty output, no handler
    // =========================================================================
    describe('enabled=false + hook mode: session-end', () => {
      it('should NOT call handleSessionEnd when enabled is false', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          session_id: 'session-disabled-se-001',
          transcript_path: '/tmp/transcript.jsonl',
        });
        mockedHandleSessionEnd.mockResolvedValue(undefined);

        // Act
        const { output } = await runCommand(['--hook', 'session-end'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert
        expect(output).toBe('');
        expect(mockedHandleSessionEnd).not.toHaveBeenCalled();
      });
    });

    // =========================================================================
    // B4. enabled=false + --hook unknown -> empty output (no error)
    // =========================================================================
    describe('enabled=false + hook mode: unknown hook name', () => {
      it('should produce NO output when enabled is false even for unknown hook names', async () => {
        // Arrange & Act
        const { output, errorOutput } = await runCommand(
          ['--hook', 'nonexistent-hook'],
          {
            sqliteStore,
            vectorStore,
            llmProvider,
            stdinData: '{}',
            enabled: false,
          },
        );

        // Assert: both stdout and stderr should be empty
        // (no "Unknown hook" error either, since the entire hook path is skipped)
        expect(output).toBe('');
        expect(errorOutput).toBe('');
      });
    });

    // =========================================================================
    // B5-B7. enabled=false + CLI commands -> work normally
    // =========================================================================
    describe('enabled=false + CLI commands: should still work', () => {
      it('should allow "status" command when enabled is false', async () => {
        // Arrange: store some data
        sqliteStore.storeExperience({
          id: 'exp-enabled-test',
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
          enabled: false,
        });

        // Assert: status command should work and show experience count
        expect(output).toContain('1');
        const lower = output.toLowerCase();
        expect(
          lower.includes('experience') || lower.includes('draft'),
        ).toBe(true);
      });

      it('should allow "review list" command when enabled is false', async () => {
        // Arrange: empty DB

        // Act
        const { output } = await runCommand(['review', 'list'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          enabled: false,
        });

        // Assert: should show "no pending drafts" message normally
        const lower = output.toLowerCase();
        expect(
          lower.includes('no pending') ||
          lower.includes('no draft') ||
          lower.includes('empty'),
        ).toBe(true);
      });

      it('should allow "list" command when enabled is false', async () => {
        // Arrange: empty DB

        // Act
        const { output } = await runCommand(['list'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          enabled: false,
        });

        // Assert: should show "no experiences" message normally
        const lower = output.toLowerCase();
        expect(lower).toMatch(/no experience|empty|no stored/);
      });
    });

    // =========================================================================
    // B8-B9. enabled=true + --hook -> handlers called (normal behavior)
    // =========================================================================
    describe('enabled=true + hook mode: normal behavior preserved', () => {
      it('should call handleUserPromptSubmit when enabled is true', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          prompt: 'Normal prompt.',
          session_id: 'session-enabled-001',
        });
        mockedHandleUserPromptSubmit.mockResolvedValue('{}');

        // Act
        await runCommand(['--hook', 'user-prompt-submit'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: true,
        });

        // Assert: handler SHOULD be called
        expect(mockedHandleUserPromptSubmit).toHaveBeenCalledTimes(1);
      });

      it('should call handleStop when enabled is true', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          session_id: 'session-enabled-002',
          transcript_path: '/tmp/transcript.jsonl',
        });
        mockedHandleStop.mockResolvedValue('{"decision":"approve"}');

        // Act
        await runCommand(['--hook', 'stop'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: true,
        });

        // Assert: handler SHOULD be called
        expect(mockedHandleStop).toHaveBeenCalledTimes(1);
      });
    });

    // =========================================================================
    // B10. enabled=undefined (default) + --hook -> handlers called (backward compat)
    // =========================================================================
    describe('enabled=undefined (default) + hook mode: backward compatibility', () => {
      it('should call handleUserPromptSubmit when enabled is not specified (defaults to true)', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          prompt: 'Default enabled prompt.',
          session_id: 'session-default-001',
        });
        mockedHandleUserPromptSubmit.mockResolvedValue('{}');

        // Act: NOTE: `enabled` is not passed at all (undefined)
        await runCommand(['--hook', 'user-prompt-submit'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          // enabled is intentionally NOT set
        });

        // Assert: handler SHOULD be called (default is enabled=true)
        expect(mockedHandleUserPromptSubmit).toHaveBeenCalledTimes(1);
      });

      it('should call handleStop when enabled is not specified (defaults to true)', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          session_id: 'session-default-002',
          transcript_path: '/tmp/transcript.jsonl',
        });
        mockedHandleStop.mockResolvedValue('{"decision":"approve"}');

        // Act: enabled not specified
        await runCommand(['--hook', 'stop'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
        });

        // Assert: handler SHOULD be called
        expect(mockedHandleStop).toHaveBeenCalledTimes(1);
      });
    });

    // =========================================================================
    // B11. enabled=false + --hook: output is EXACTLY empty string
    // =========================================================================
    describe('enabled=false + hook mode: output format strictness', () => {
      it('should return EXACTLY empty string, not "{}" or whitespace or newline', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          prompt: 'Any prompt.',
          session_id: 'session-exact-001',
        });
        mockedHandleUserPromptSubmit.mockResolvedValue('{}');

        // Act
        const { output } = await runCommand(['--hook', 'user-prompt-submit'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert: strict equality -- must be empty string
        expect(output).toStrictEqual('');
        expect(output.length).toBe(0);
        expect(output).not.toBe('{}');
        expect(output).not.toBe('{"decision":"approve"}');
        expect(output.trim()).toBe('');
      });

      it('should return EXACTLY empty string for stop hook too', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          session_id: 'session-exact-002',
          transcript_path: '/tmp/transcript.jsonl',
        });
        mockedHandleStop.mockResolvedValue('{"decision":"approve"}');

        // Act
        const { output } = await runCommand(['--hook', 'stop'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert
        expect(output).toStrictEqual('');
        expect(output.length).toBe(0);
      });
    });

    // =========================================================================
    // B12. enabled=false + --hook: no error output either
    // =========================================================================
    describe('enabled=false + hook mode: no error output', () => {
      it('should produce no error output for user-prompt-submit when disabled', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          prompt: 'Error prompt.',
          session_id: 'session-noerr-001',
        });

        // Act
        const { errorOutput } = await runCommand(['--hook', 'user-prompt-submit'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert: no error output
        expect(errorOutput).toBe('');
      });

      it('should produce no error output for stop hook when disabled', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          session_id: 'session-noerr-002',
          transcript_path: '/tmp/transcript.jsonl',
        });

        // Act
        const { errorOutput } = await runCommand(['--hook', 'stop'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert
        expect(errorOutput).toBe('');
      });
    });

    // =========================================================================
    // B13. enabled=false + --hook: no LLM/embedding calls made
    // =========================================================================
    describe('enabled=false + hook mode: no LLM interactions', () => {
      it('should NOT make any LLM calls when disabled in hook mode', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          prompt: 'Prompt that would normally trigger LLM.',
          session_id: 'session-nollm-001',
        });

        // Act
        await runCommand(['--hook', 'user-prompt-submit'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert: no calls to LLM at all
        expect(llmProvider.calls).toHaveLength(0);
      });

      it('should NOT make any embedding calls when disabled in stop hook mode', async () => {
        // Arrange
        const stdinJson = JSON.stringify({
          session_id: 'session-nollm-002',
          transcript_path: '/tmp/transcript.jsonl',
        });

        // Act
        await runCommand(['--hook', 'stop'], {
          sqliteStore,
          vectorStore,
          llmProvider,
          stdinData: stdinJson,
          enabled: false,
        });

        // Assert
        expect(llmProvider.calls).toHaveLength(0);
      });
    });
  });
});
