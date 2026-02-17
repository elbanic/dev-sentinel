/**
 * Unit Tests for Stop Hook Handler
 *
 * The handleStop function:
 *
 *   1. Read flag status for the given session_id
 *   2. If no flag or status !== 'capture' -> return '{"decision":"approve"}' immediately
 *   3. If status === 'capture':
 *      a. Parse the transcript file
 *      b. Find first frustrated turn for error summary + transcript slicing
 *      c. Slice transcript from the frustrated prompt onward
 *      d. Store the raw candidate (no LLM call — lazy summarization on confirm)
 *      e. Clear the flag (always, even when parse fails or storeCandidate fails)
 *   4. Always return '{"decision":"approve"}'
 *   5. NEVER throw
 *
 * Test points (11 total):
 *   1.  flag absent -> approve immediately, parseTranscriptFile NOT called
 *   2.  flag = 'frustrated' -> approve immediately, parseTranscriptFile NOT called
 *   3.  flag = 'capture' -> full pipeline -> approve (raw transcript stored)
 *   4.  flag = 'capture' + parseTranscript returns null -> approve, clearFlag called
 *   5.  flag = 'capture' + parseTranscript returns empty messages -> approve, clearFlag called
 *   6.  flag = 'capture' + frustrated turn found -> sliced transcript stored
 *   7.  parseTranscriptFile throws -> approve (graceful)
 *   8.  invalid input (missing session_id) -> approve
 *   9.  storeCandidate throws -> approve (graceful), clearFlag still called
 *   10. dedup: same session already has pending draft -> skip storeCandidate
 *   11. getFlag throws -> approve (graceful)
 */

import { handleStop } from '../../src/hook/stop-hook-handler';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import type { TranscriptData } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Module mocks: parseTranscriptFile (generateNote is NOT called in stop hook)
// ---------------------------------------------------------------------------
jest.mock('../../src/capture/transcript-parser', () => ({
  parseTranscriptFile: jest.fn(),
}));

// Mock debug-log to avoid filesystem side effects
jest.mock('../../src/utils/debug-log', () => ({
  debugLog: jest.fn(),
}));

import { parseTranscriptFile } from '../../src/capture/transcript-parser';

const mockedParseTranscriptFile = parseTranscriptFile as jest.MockedFunction<
  typeof parseTranscriptFile
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APPROVE_RESPONSE = '{"decision":"approve"}';

/**
 * Build a mock SqliteStore with jest.fn() for each method used by handleStop.
 */
function makeMockSqliteStore() {
  return {
    getFlag: jest.fn(),
    clearFlag: jest.fn(),
    storeCandidate: jest.fn(),
    getPendingDrafts: jest.fn().mockReturnValue([]),
    getTurnsBySession: jest.fn().mockReturnValue([]),
    // Other methods not used by handleStop but included for type completeness
    initialize: jest.fn(),
    close: jest.fn(),
    storeTurn: jest.fn(),
    setFlag: jest.fn(),
    upgradeFlag: jest.fn(),
    deleteCandidate: jest.fn(),
    updateCandidateStatus: jest.fn(),
    storeExperience: jest.fn(),
    getExperience: jest.fn(),
    runInTransaction: jest.fn(),
    getExperienceCount: jest.fn(),
  };
}

/**
 * Build a FlagRow with defaults.
 */
function makeFlagRow(overrides?: {
  session_id?: string;
  status?: string;
  flagged_at?: string;
  updated_at?: string;
}) {
  return {
    session_id: 'session-001',
    status: 'frustrated',
    flagged_at: '2026-02-16T12:00:00Z',
    updated_at: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

/**
 * Build a TranscriptData with sensible defaults.
 */
function makeTranscriptData(overrides?: Partial<TranscriptData>): TranscriptData {
  return {
    messages: [
      { role: 'user', content: 'Why is this failing?' },
      { role: 'assistant', content: 'Let me check the error logs.' },
    ],
    toolCalls: [
      {
        name: 'Bash',
        input: { command: 'npm run build' },
        error: 'Build failed with exit code 1',
      },
    ],
    errors: ['Build failed with exit code 1'],
    ...overrides,
  };
}

/**
 * Build a mock session turn with analysis JSON.
 */
function makeTurn(overrides?: {
  id?: string;
  session_id?: string;
  turn_number?: number;
  prompt?: string;
  analysis?: string;
  timestamp?: string;
}) {
  return {
    id: 'turn-001',
    session_id: 'session-001',
    turn_number: 1,
    prompt: 'Why is this failing?',
    analysis: JSON.stringify({ type: 'frustrated', confidence: 0.9, intent: 'Fix build failure' }),
    timestamp: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('StopHookHandler - handleStop', () => {
  let mockStore: ReturnType<typeof makeMockSqliteStore>;
  let mockLlmProvider: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = makeMockSqliteStore();
    mockLlmProvider = new MockLLMProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Flag absent -> approve immediately
  // =========================================================================
  describe('Test 1: flag absent -> approve immediately', () => {
    it('should return approve when getFlag returns null (no flag set)', async () => {
      mockStore.getFlag.mockReturnValue(null);

      const result = await handleStop({
        sessionId: 'session-no-flag',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should NOT call parseTranscriptFile when no flag is set', async () => {
      mockStore.getFlag.mockReturnValue(null);

      await handleStop({
        sessionId: 'session-no-flag',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
    });

    it('should NOT call clearFlag when no flag is set', async () => {
      mockStore.getFlag.mockReturnValue(null);

      await handleStop({
        sessionId: 'session-no-flag',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. Flag = 'frustrated' -> approve immediately
  // =========================================================================
  describe('Test 2: flag = frustrated -> approve immediately', () => {
    it('should return approve when flag status is frustrated', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));

      const result = await handleStop({
        sessionId: 'session-frustrated',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should NOT call parseTranscriptFile when flag is frustrated', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));

      await handleStop({
        sessionId: 'session-frustrated',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Flag = 'capture' -> full pipeline -> approve (raw transcript stored)
  // =========================================================================
  describe('Test 3: flag = capture -> full pipeline -> approve', () => {
    it('should return approve after completing the capture pipeline', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture', session_id: 'session-capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      const result = await handleStop({
        sessionId: 'session-capture',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should call parseTranscriptFile with the provided transcriptPath', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleStop({
        sessionId: 'session-001',
        transcriptPath: '/home/user/.claude/sessions/abc/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockedParseTranscriptFile).toHaveBeenCalledTimes(1);
      expect(mockedParseTranscriptFile).toHaveBeenCalledWith(
        '/home/user/.claude/sessions/abc/transcript.jsonl',
      );
    });

    it('should call storeCandidate with raw transcript data (no LLM)', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture', session_id: 'session-store' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleStop({
        sessionId: 'session-store',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.sessionId).toBe('session-store');
      expect(storedArg.status).toBe('pending');
      expect(storedArg.transcriptData).toBe(JSON.stringify(transcriptData));
      expect(storedArg.failedApproaches).toEqual([]);
      expect(storedArg.lessons).toEqual([]);
      expect(storedArg.id).toBeDefined();
      expect(storedArg.createdAt).toBeDefined();
    });

    it('should call clearFlag with the sessionId after storing the candidate', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture', session_id: 'session-clear' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleStop({
        sessionId: 'session-clear',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-clear');
    });
  });

  // =========================================================================
  // 4. Flag = 'capture' + parseTranscript returns null
  // =========================================================================
  describe('Test 4: flag = capture + parseTranscript returns null', () => {
    it('should return approve when parseTranscriptFile returns null', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(null);

      const result = await handleStop({
        sessionId: 'session-null-parse',
        transcriptPath: '/tmp/empty-transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should NOT call storeCandidate when parseTranscriptFile returns null', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(null);

      await handleStop({
        sessionId: 'session-null-parse',
        transcriptPath: '/tmp/empty-transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).not.toHaveBeenCalled();
    });

    it('should still call clearFlag when parseTranscriptFile returns null', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(null);

      await handleStop({
        sessionId: 'session-null-parse',
        transcriptPath: '/tmp/empty-transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-null-parse');
    });
  });

  // =========================================================================
  // 5. Flag = 'capture' + parseTranscript returns empty messages
  // =========================================================================
  describe('Test 5: flag = capture + parseTranscript returns empty messages', () => {
    it('should return approve when transcript has no messages', async () => {
      const emptyTranscript = makeTranscriptData({ messages: [] });

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(emptyTranscript);

      const result = await handleStop({
        sessionId: 'session-empty-msgs',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should NOT call storeCandidate when transcript has no messages', async () => {
      const emptyTranscript = makeTranscriptData({ messages: [] });

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(emptyTranscript);

      await handleStop({
        sessionId: 'session-empty-msgs',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).not.toHaveBeenCalled();
    });

    it('should still call clearFlag when transcript has no messages', async () => {
      const emptyTranscript = makeTranscriptData({ messages: [] });

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(emptyTranscript);

      await handleStop({
        sessionId: 'session-empty-msgs',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-empty-msgs');
    });
  });

  // =========================================================================
  // 6. Turn-based transcript slicing
  // =========================================================================
  describe('Test 6: turn-based transcript slicing', () => {
    it('should use frustrated turn intent as frustrationSignature', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.getTurnsBySession.mockReturnValue([
        makeTurn({ prompt: 'Why is this failing?', analysis: JSON.stringify({ type: 'frustrated', intent: 'Fix build failure' }) }),
      ]);

      await handleStop({
        sessionId: 'session-001',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.frustrationSignature).toBe('Fix build failure');
    });

    it('should slice transcript from frustrated prompt onward', async () => {
      const transcriptData = makeTranscriptData({
        messages: [
          { role: 'user', content: 'Fix the login bug' },
          { role: 'assistant', content: 'I found the issue in auth.ts' },
          { role: 'user', content: 'Why does the API keep failing with 500?' },
          { role: 'assistant', content: 'The database connection is timing out.' },
        ],
      });

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.getTurnsBySession.mockReturnValue([
        makeTurn({
          prompt: 'Why does the API keep failing with 500?',
          analysis: JSON.stringify({ type: 'frustrated', intent: 'Fix API 500 error' }),
        }),
      ]);

      await handleStop({
        sessionId: 'session-slice',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      const storedTranscript: TranscriptData = JSON.parse(storedArg.transcriptData);
      // Should only contain messages from the frustrated prompt onward (2 of 4)
      expect(storedTranscript.messages).toHaveLength(2);
      expect(storedTranscript.messages[0].content).toBe('Why does the API keep failing with 500?');
    });

    it('should use full transcript when no frustrated turn is found', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.getTurnsBySession.mockReturnValue([]); // no turns

      await handleStop({
        sessionId: 'session-no-turns',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      const storedTranscript: TranscriptData = JSON.parse(storedArg.transcriptData);
      expect(storedTranscript.messages).toHaveLength(transcriptData.messages.length);
    });

    it('should use empty string for frustrationSignature when no frustrated turn found', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.getTurnsBySession.mockReturnValue([]);

      await handleStop({
        sessionId: 'session-no-turns',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.frustrationSignature).toBe('');
    });

    it('should handle getTurnsBySession throwing gracefully', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.getTurnsBySession.mockImplementation(() => {
        throw new Error('DB read error');
      });

      await handleStop({
        sessionId: 'session-turn-err',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      // Should still store candidate with full transcript
      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.frustrationSignature).toBe('');
    });
  });

  // =========================================================================
  // 7. parseTranscriptFile throws
  // =========================================================================
  describe('Test 7: parseTranscriptFile throws', () => {
    it('should return approve when parseTranscriptFile throws an error', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockImplementation(() => {
        throw new Error('EACCES: permission denied, open transcript.jsonl');
      });

      const result = await handleStop({
        sessionId: 'session-parse-throws',
        transcriptPath: '/tmp/unreadable.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should NOT call storeCandidate when parseTranscriptFile throws', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockImplementation(() => {
        throw new Error('file read error');
      });

      await handleStop({
        sessionId: 'session-parse-throws',
        transcriptPath: '/tmp/bad-file.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).not.toHaveBeenCalled();
    });

    it('should still call clearFlag when parseTranscriptFile throws', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      await handleStop({
        sessionId: 'session-parse-throws',
        transcriptPath: '/tmp/missing.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-parse-throws');
    });
  });

  // =========================================================================
  // 8. Invalid input (missing sessionId)
  // =========================================================================
  describe('Test 8: invalid input (missing sessionId)', () => {
    it('should return approve when sessionId is an empty string', async () => {
      const result = await handleStop({
        sessionId: '',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should NOT call getFlag when sessionId is empty', async () => {
      await handleStop({
        sessionId: '',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.getFlag).not.toHaveBeenCalled();
    });

    it('should return approve when transcriptPath is an empty string', async () => {
      mockStore.getFlag.mockReturnValue(null);

      const result = await handleStop({
        sessionId: 'session-valid',
        transcriptPath: '',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });
  });

  // =========================================================================
  // 9. storeCandidate throws -> approve, clearFlag still called
  // =========================================================================
  describe('Test 9: storeCandidate throws -> approve, clearFlag still called', () => {
    it('should return approve when storeCandidate throws', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.storeCandidate.mockImplementation(() => {
        throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed');
      });

      const result = await handleStop({
        sessionId: 'session-store-fail',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should still call clearFlag when storeCandidate throws', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.storeCandidate.mockImplementation(() => {
        throw new Error('disk full');
      });

      await handleStop({
        sessionId: 'session-store-fail',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-store-fail');
    });
  });

  // =========================================================================
  // 10. Dedup: same session already has pending draft -> skip storeCandidate
  // =========================================================================
  describe('Test 10: dedup - same session already has pending draft', () => {
    it('should NOT call storeCandidate when session already has a pending draft', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture', session_id: 'session-dedup' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([{ sessionId: 'session-dedup', id: 'existing-draft-001' }]);

      await handleStop({
        sessionId: 'session-dedup',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).not.toHaveBeenCalled();
    });

    it('should still return approve when dedup prevents storing', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture', session_id: 'session-dedup' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([{ sessionId: 'session-dedup', id: 'existing-draft-002' }]);

      const result = await handleStop({
        sessionId: 'session-dedup',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should still call clearFlag when dedup prevents storing', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture', session_id: 'session-dedup' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([{ sessionId: 'session-dedup', id: 'existing-draft-003' }]);

      await handleStop({
        sessionId: 'session-dedup',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-dedup');
    });

    it('should call storeCandidate when pending drafts exist but for a DIFFERENT session', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture', session_id: 'session-new' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([{ sessionId: 'session-OTHER', id: 'other-draft' }]);

      await handleStop({
        sessionId: 'session-new',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.sessionId).toBe('session-new');
    });
  });

  // =========================================================================
  // 11. getFlag throws -> approve (graceful)
  // =========================================================================
  describe('Test 11: getFlag throws -> approve (graceful)', () => {
    it('should return approve when getFlag throws an error', async () => {
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Database is closed');
      });

      const result = await handleStop({
        sessionId: 'session-db-error',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should NOT call parseTranscriptFile when getFlag throws', async () => {
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Database is closed');
      });

      await handleStop({
        sessionId: 'session-db-error',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Additional edge cases: never-throw guarantee
  // =========================================================================
  describe('Never-throw guarantee', () => {
    it('should never reject the returned promise regardless of internal errors', async () => {
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('getFlag crash');
      });

      await expect(
        handleStop({
          sessionId: 'session-total-failure',
          transcriptPath: '/tmp/transcript.jsonl',
          llmProvider: mockLlmProvider,
          sqliteStore: mockStore as any,
        }),
      ).resolves.toBe(APPROVE_RESPONSE);
    });

    it('should return valid JSON string that parses to an object with decision: approve', async () => {
      mockStore.getFlag.mockReturnValue(null);

      const result = await handleStop({
        sessionId: 'session-json-check',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ decision: 'approve' });
    });

    it('should handle clearFlag itself throwing without breaking the approve response', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.clearFlag.mockImplementation(() => {
        throw new Error('clearFlag database error');
      });

      const result = await handleStop({
        sessionId: 'session-clearflag-fail',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should handle getPendingDrafts throwing without breaking the approve response', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockImplementation(() => {
        throw new Error('getPendingDrafts crash');
      });

      const result = await handleStop({
        sessionId: 'session-dedup-fail',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
    });

    it('should return the exact string \'{"decision":"approve"}\' with no extra whitespace', async () => {
      mockStore.getFlag.mockReturnValue(null);

      const result = await handleStop({
        sessionId: 'session-exact-string',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe('{"decision":"approve"}');
    });
  });

  // =========================================================================
  // Flag status edge cases
  // =========================================================================
  describe('Flag status edge cases', () => {
    it('should treat an unknown flag status the same as no flag (approve immediately)', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'processing' }));

      const result = await handleStop({
        sessionId: 'session-unknown-status',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
    });

    it('should handle flag status that is an empty string (approve immediately)', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: '' }));

      const result = await handleStop({
        sessionId: 'session-empty-status',
        transcriptPath: '/tmp/transcript.jsonl',
        llmProvider: mockLlmProvider,
        sqliteStore: mockStore as any,
      });

      expect(result).toBe(APPROVE_RESPONSE);
      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
    });
  });
});
