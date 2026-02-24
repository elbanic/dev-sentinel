/**
 * Unit Tests for CLI `enabled: false` Early Exit Behavior
 *
 * TDD RED phase: These tests define the expected behavior when
 * `settings.enabled === false`. The `createProgram` factory should
 * accept an `enabled` field in `CreateProgramDeps` to control
 * whether hooks are active.
 *
 * Requirements:
 *   1. When `enabled: false` AND in hook mode (`--hook`):
 *      - Return immediately with NO stdout output (empty string, not '{}')
 *      - Do NOT call any hook handlers (handleUserPromptSubmit, handleStop)
 *      - Do NOT initialize or interact with DB, LLM, or VectorStore
 *   2. When `enabled: false` AND NOT in hook mode (CLI commands):
 *      - CLI commands (status, review list, etc.) should still work normally
 *      - The `enabled` flag only disables hooks, not the CLI
 *   3. When `enabled: true` (default):
 *      - Hooks should work as before (no behavior change)
 *   4. When `enabled` is not specified (undefined):
 *      - Should default to `true` (backward compatibility)
 *
 * Test points (18 individual tests across 9 categories):
 *   1.  enabled=false + --hook user-prompt-submit -> empty output, handler NOT called
 *   2.  enabled=false + --hook stop -> empty output, handler NOT called
 *   3.  enabled=false + --hook unknown -> empty output (no error either)
 *   4.  enabled=false + CLI command (status) -> works normally
 *   5.  enabled=false + CLI command (review list) -> works normally
 *   6.  enabled=false + CLI command (list) -> works normally
 *   7.  enabled=true + --hook user-prompt-submit -> handler called (normal behavior)
 *   8.  enabled=true + --hook stop -> handler called (normal behavior)
 *   9.  enabled=undefined (default) + --hook -> handler called (backward compat)
 *  10.  enabled=false + --hook: output is EXACTLY empty string (not '{}', not whitespace)
 *  11.  enabled=false + --hook: no error output either
 *  12.  enabled=false + --hook: no LLM/embedding calls made
 *
 * Testing strategy:
 *   - Use createProgram with `enabled` field in deps (via type assertion
 *     since the interface hasn't been extended yet -- this is the RED phase)
 *   - Mock hook handlers to detect if they were called
 *   - Capture stdout/stderr via configureOutput
 *   - Real SqliteStore with :memory: for CLI command tests
 *
 * Assumptions:
 *   - `CreateProgramDeps` will be extended with an optional `enabled?: boolean` field
 *   - Default value is `true` when `enabled` is undefined
 *   - The early exit happens inside `runHook()` before any handler logic
 */

import { createProgram } from '../../src/cli';
import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';

// ---------------------------------------------------------------------------
// Module mocks for hook handlers
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

/**
 * Parse a Commander program for the given command args with the `enabled` flag.
 * Returns captured output and any thrown CommanderError.
 *
 * NOTE: Uses `as any` cast because `CreateProgramDeps` does not yet include
 * the `enabled` field. This is intentional for the RED phase -- the tests
 * define the EXPECTED interface before the implementation exists.
 */
async function runCommand(
  args: string[],
  deps: {
    sqliteStore: SqliteStore;
    vectorStore: VectorStore;
    llmProvider: MockLLMProvider;
    stdinData?: string;
    enabled?: boolean;
  },
): Promise<{ output: string; errorOutput: string; exitCode?: number }> {
  let output = '';
  let errorOutput = '';
  let exitCode: number | undefined;

  // Use `as any` to pass `enabled` since CreateProgramDeps hasn't been
  // extended yet. Once the implementer adds `enabled?: boolean` to the
  // interface, this cast can be removed.
  const program = createProgram({
    sqliteStore: deps.sqliteStore,
    vectorStore: deps.vectorStore,
    llmProvider: deps.llmProvider,
    stdin: deps.stdinData,
    enabled: deps.enabled,
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

describe('CLI - enabled flag early exit', () => {
  let sqliteStore: SqliteStore;
  let vectorStore: VectorStore;
  let llmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();

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
  // 1. enabled=false + --hook user-prompt-submit -> empty output, no handler
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
  // 2. enabled=false + --hook stop -> empty output, no handler
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
  // 3. enabled=false + --hook unknown -> empty output (no error)
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
  // 4-6. enabled=false + CLI commands -> work normally
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
  // 7-8. enabled=true + --hook -> handlers called (normal behavior)
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
  // 9. enabled=undefined (default) + --hook -> handlers called (backward compat)
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
  // 10. enabled=false + --hook: output is EXACTLY empty string
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
  // 11. enabled=false + --hook: no error output either
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
  // 12. enabled=false + --hook: no LLM/embedding calls made
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
