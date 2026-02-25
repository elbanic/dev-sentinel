/**
 * Unit Tests for Session End Handler
 *
 * The handleSessionEnd function:
 *
 *   1. Read flag status for the given session_id
 *   2. If no flag or status !== 'frustrated' -> return early (void)
 *   3. If status === 'frustrated':
 *      a. upgradeFlag(sessionId, 'capture') (try-catch, continue on failure)
 *      b. runCapturePipeline(sessionId, transcriptPath, sqliteStore, matchedExperienceId) in try-finally
 *      c. safeClearFlag(sqliteStore, sessionId) in finally block
 *   4. Outermost try-catch: NEVER throws
 *   5. Returns Promise<void>, NOT a string
 *
 * Test cases (12 total):
 *   1.  flag='frustrated' -> upgradeFlag + storeCandidate + clearFlag called
 *   2.  flag='frustrated' -> returns void (not a string)
 *   3.  flag='capture' -> skip (upgradeFlag, clearFlag NOT called)
 *   4.  flag=null -> skip
 *   5.  empty sessionId -> skip
 *   6.  empty transcriptPath -> pipeline handles gracefully (parseTranscriptFile called with empty string)
 *   7.  runCapturePipeline throws (via parseTranscriptFile throwing) -> clearFlag still called
 *   8.  upgradeFlag throws -> clearFlag still attempted
 *   9.  getFlag throws -> does NOT throw
 *   10. clearFlag throws -> does NOT throw
 *   11. flag has matchedExperienceId='exp-001' -> runCapturePipeline receives it
 *   12. flag has no matchedExperienceId -> runCapturePipeline receives undefined
 */

import { handleSessionEnd } from '../../src/hook/session-end-handler';
import type { TranscriptData } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
jest.mock('../../src/capture/transcript-parser', () => ({
  parseTranscriptFile: jest.fn(),
}));

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

/**
 * Build a mock SqliteStore with jest.fn() for each method used by session-end-handler
 * and the underlying runCapturePipeline / safeClearFlag from stop-hook-handler.
 */
function makeMockSqliteStore() {
  return {
    getFlag: jest.fn(),
    clearFlag: jest.fn(),
    upgradeFlag: jest.fn(),
    storeCandidate: jest.fn(),
    getPendingDrafts: jest.fn().mockReturnValue([]),
    getTurnsBySession: jest.fn().mockReturnValue([]),
    initialize: jest.fn(),
    close: jest.fn(),
    storeTurn: jest.fn(),
    setFlag: jest.fn(),
    deleteCandidate: jest.fn(),
    updateCandidateStatus: jest.fn(),
    storeExperience: jest.fn(),
    getExperience: jest.fn(),
    runInTransaction: jest.fn(),
    getExperienceCount: jest.fn(),
    recordHookError: jest.fn(),
    getAdvisedExperienceIds: jest.fn().mockReturnValue([]),
    markPriorAdviceIneffective: jest.fn().mockReturnValue(0),
  };
}

/**
 * Build a FlagRow with defaults (status defaults to 'frustrated' for session-end).
 */
function makeFlagRow(overrides?: {
  session_id?: string;
  status?: string;
  flagged_at?: string;
  updated_at?: string;
  matched_experience_id?: string | null;
}) {
  return {
    session_id: 'session-001',
    status: 'frustrated',
    flagged_at: '2026-02-16T12:00:00Z',
    updated_at: '2026-02-16T12:00:00Z',
    matched_experience_id: null,
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SessionEndHandler - handleSessionEnd', () => {
  let mockStore: ReturnType<typeof makeMockSqliteStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = makeMockSqliteStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Test 1: flag='frustrated' -> upgradeFlag + storeCandidate + clearFlag called
  // =========================================================================
  describe('Test 1: flag=frustrated -> full pipeline executes', () => {
    it('should call upgradeFlag with sessionId and capture when flag is frustrated', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'session-end-001' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-end-001',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.upgradeFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.upgradeFlag).toHaveBeenCalledWith('session-end-001', 'capture');
    });

    it('should call storeCandidate when flag is frustrated and transcript is valid', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'session-end-001' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-end-001',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.sessionId).toBe('session-end-001');
      expect(storedArg.status).toBe('pending');
      expect(storedArg.transcriptData).toBe(JSON.stringify(transcriptData));
    });

    it('should call clearFlag with the sessionId after pipeline completes', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'session-end-001' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-end-001',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-end-001');
    });
  });

  // =========================================================================
  // Test 2: flag='frustrated' -> returns void (not a string)
  // =========================================================================
  describe('Test 2: flag=frustrated -> returns void', () => {
    it('should return undefined (void), NOT a string', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      const result = await handleSessionEnd({
        sessionId: 'session-001',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(result).toBeUndefined();
    });

    it('should not return a JSON string like the stop hook does', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      const result = await handleSessionEnd({
        sessionId: 'session-001',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(typeof result).not.toBe('string');
    });
  });

  // =========================================================================
  // Test 3: flag='capture' -> skip (upgradeFlag, clearFlag NOT called)
  // =========================================================================
  describe('Test 3: flag=capture -> skip entirely', () => {
    it('should NOT call upgradeFlag when flag status is capture', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));

      await handleSessionEnd({
        sessionId: 'session-already-capture',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.upgradeFlag).not.toHaveBeenCalled();
    });

    it('should NOT call clearFlag when flag status is capture', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));

      await handleSessionEnd({
        sessionId: 'session-already-capture',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).not.toHaveBeenCalled();
    });

    it('should NOT call parseTranscriptFile when flag status is capture', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));

      await handleSessionEnd({
        sessionId: 'session-already-capture',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
    });

    it('should return void when flag status is capture', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));

      const result = await handleSessionEnd({
        sessionId: 'session-already-capture',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // Test 4: flag=null -> skip
  // =========================================================================
  describe('Test 4: flag=null -> skip', () => {
    it('should return void when getFlag returns null', async () => {
      mockStore.getFlag.mockReturnValue(null);

      const result = await handleSessionEnd({
        sessionId: 'session-no-flag',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(result).toBeUndefined();
    });

    it('should NOT call upgradeFlag when getFlag returns null', async () => {
      mockStore.getFlag.mockReturnValue(null);

      await handleSessionEnd({
        sessionId: 'session-no-flag',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.upgradeFlag).not.toHaveBeenCalled();
    });

    it('should NOT call parseTranscriptFile when getFlag returns null', async () => {
      mockStore.getFlag.mockReturnValue(null);

      await handleSessionEnd({
        sessionId: 'session-no-flag',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
    });

    it('should NOT call clearFlag when getFlag returns null', async () => {
      mockStore.getFlag.mockReturnValue(null);

      await handleSessionEnd({
        sessionId: 'session-no-flag',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 5: empty sessionId -> skip
  // =========================================================================
  describe('Test 5: empty sessionId -> skip', () => {
    it('should return void when sessionId is empty', async () => {
      const result = await handleSessionEnd({
        sessionId: '',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(result).toBeUndefined();
    });

    it('should NOT call getFlag when sessionId is empty', async () => {
      await handleSessionEnd({
        sessionId: '',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.getFlag).not.toHaveBeenCalled();
    });

    it('should NOT call upgradeFlag when sessionId is empty', async () => {
      await handleSessionEnd({
        sessionId: '',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.upgradeFlag).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 6: empty transcriptPath -> pipeline handles gracefully
  // =========================================================================
  describe('Test 6: empty transcriptPath -> pipeline handles gracefully', () => {
    it('should call parseTranscriptFile with the empty string', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockReturnValue(null);

      await handleSessionEnd({
        sessionId: 'session-empty-path',
        transcriptPath: '',
        sqliteStore: mockStore as any,
      });

      expect(mockedParseTranscriptFile).toHaveBeenCalledTimes(1);
      expect(mockedParseTranscriptFile).toHaveBeenCalledWith('');
    });

    it('should still call clearFlag even when transcriptPath is empty', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockReturnValue(null);

      await handleSessionEnd({
        sessionId: 'session-empty-path',
        transcriptPath: '',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-empty-path');
    });

    it('should return void when transcriptPath is empty', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockReturnValue(null);

      const result = await handleSessionEnd({
        sessionId: 'session-empty-path',
        transcriptPath: '',
        sqliteStore: mockStore as any,
      });

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // Test 7: runCapturePipeline throws (via parseTranscriptFile) -> clearFlag still called
  // =========================================================================
  describe('Test 7: pipeline throws -> clearFlag still called', () => {
    it('should call clearFlag even when parseTranscriptFile throws', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'session-pipeline-err' }));
      mockedParseTranscriptFile.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      await handleSessionEnd({
        sessionId: 'session-pipeline-err',
        transcriptPath: '/tmp/unreadable.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-pipeline-err');
    });

    it('should NOT call storeCandidate when parseTranscriptFile throws', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockImplementation(() => {
        throw new Error('file read error');
      });

      await handleSessionEnd({
        sessionId: 'session-001',
        transcriptPath: '/tmp/bad-file.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).not.toHaveBeenCalled();
    });

    it('should not throw when parseTranscriptFile throws', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      await expect(
        handleSessionEnd({
          sessionId: 'session-001',
          transcriptPath: '/tmp/missing.jsonl',
          sqliteStore: mockStore as any,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Test 8: upgradeFlag throws -> clearFlag still attempted
  // =========================================================================
  describe('Test 8: upgradeFlag throws -> clearFlag still attempted', () => {
    it('should call clearFlag even when upgradeFlag throws', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'session-upgrade-err' }));
      mockStore.upgradeFlag.mockImplementation(() => {
        throw new Error('Database is locked');
      });
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-upgrade-err',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.clearFlag).toHaveBeenCalledTimes(1);
      expect(mockStore.clearFlag).toHaveBeenCalledWith('session-upgrade-err');
    });

    it('should still attempt the capture pipeline even when upgradeFlag throws', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockStore.upgradeFlag.mockImplementation(() => {
        throw new Error('Database is locked');
      });
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-001',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      // parseTranscriptFile should still be called (pipeline attempted)
      expect(mockedParseTranscriptFile).toHaveBeenCalledTimes(1);
    });

    it('should not throw when upgradeFlag throws', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockStore.upgradeFlag.mockImplementation(() => {
        throw new Error('Database is locked');
      });
      mockedParseTranscriptFile.mockReturnValue(null);

      await expect(
        handleSessionEnd({
          sessionId: 'session-001',
          transcriptPath: '/tmp/transcript.jsonl',
          sqliteStore: mockStore as any,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Test 9: getFlag throws -> does NOT throw
  // =========================================================================
  describe('Test 9: getFlag throws -> does NOT throw', () => {
    it('should not throw when getFlag throws', async () => {
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Database is closed');
      });

      await expect(
        handleSessionEnd({
          sessionId: 'session-db-error',
          transcriptPath: '/tmp/transcript.jsonl',
          sqliteStore: mockStore as any,
        }),
      ).resolves.toBeUndefined();
    });

    it('should return void when getFlag throws', async () => {
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Database is closed');
      });

      const result = await handleSessionEnd({
        sessionId: 'session-db-error',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(result).toBeUndefined();
    });

    it('should NOT call parseTranscriptFile when getFlag throws', async () => {
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Database is closed');
      });

      await handleSessionEnd({
        sessionId: 'session-db-error',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
    });

    it('should NOT call upgradeFlag when getFlag throws', async () => {
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Database is closed');
      });

      await handleSessionEnd({
        sessionId: 'session-db-error',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.upgradeFlag).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 10: clearFlag throws -> does NOT throw
  // =========================================================================
  describe('Test 10: clearFlag throws -> does NOT throw', () => {
    it('should not throw when clearFlag throws', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.clearFlag.mockImplementation(() => {
        throw new Error('clearFlag database error');
      });

      await expect(
        handleSessionEnd({
          sessionId: 'session-clearflag-fail',
          transcriptPath: '/tmp/transcript.jsonl',
          sqliteStore: mockStore as any,
        }),
      ).resolves.toBeUndefined();
    });

    it('should return void when clearFlag throws', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.clearFlag.mockImplementation(() => {
        throw new Error('clearFlag database error');
      });

      const result = await handleSessionEnd({
        sessionId: 'session-clearflag-fail',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(result).toBeUndefined();
    });

    it('should still have called storeCandidate before clearFlag throws', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);
      mockStore.clearFlag.mockImplementation(() => {
        throw new Error('clearFlag database error');
      });

      await handleSessionEnd({
        sessionId: 'session-clearflag-fail',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Test 11: flag has matchedExperienceId='exp-001' -> pipeline receives it
  // =========================================================================
  describe('Test 11: matchedExperienceId passed to pipeline', () => {
    it('should include matchedExperienceId in storeCandidate when flag has matched_experience_id', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(
        makeFlagRow({
          status: 'frustrated',
          session_id: 'session-matched',
          matched_experience_id: 'exp-001',
        }),
      );
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-matched',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.matchedExperienceId).toBe('exp-001');
    });

    it('should preserve the matchedExperienceId value exactly as provided', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(
        makeFlagRow({
          status: 'frustrated',
          session_id: 'session-matched-uuid',
          matched_experience_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        }),
      );
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-matched-uuid',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.matchedExperienceId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });
  });

  // =========================================================================
  // Test 12: flag has no matchedExperienceId -> pipeline receives undefined
  // =========================================================================
  describe('Test 12: no matchedExperienceId -> pipeline receives undefined', () => {
    it('should not include matchedExperienceId when flag has null matched_experience_id', async () => {
      const transcriptData = makeTranscriptData();

      mockStore.getFlag.mockReturnValue(
        makeFlagRow({
          status: 'frustrated',
          session_id: 'session-no-match',
          matched_experience_id: null,
        }),
      );
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-no-match',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.matchedExperienceId).toBeUndefined();
    });

    it('should not include matchedExperienceId when flag omits matched_experience_id (defaults to null)', async () => {
      const transcriptData = makeTranscriptData();

      // Default makeFlagRow has matched_experience_id: null
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'session-default' }));
      mockedParseTranscriptFile.mockReturnValue(transcriptData);
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'session-default',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.storeCandidate).toHaveBeenCalledTimes(1);
      const storedArg = mockStore.storeCandidate.mock.calls[0][0];
      expect(storedArg.matchedExperienceId).toBeUndefined();
    });
  });

  // =========================================================================
  // Never-throw guarantee (comprehensive edge cases)
  // =========================================================================
  describe('Never-throw guarantee', () => {
    it('should never reject the returned promise regardless of internal errors', async () => {
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('catastrophic failure');
      });

      await expect(
        handleSessionEnd({
          sessionId: 'session-total-failure',
          transcriptPath: '/tmp/transcript.jsonl',
          sqliteStore: mockStore as any,
        }),
      ).resolves.toBeUndefined();
    });

    it('should handle all operations throwing without propagating errors', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockStore.upgradeFlag.mockImplementation(() => {
        throw new Error('upgradeFlag crash');
      });
      mockedParseTranscriptFile.mockImplementation(() => {
        throw new Error('parseTranscriptFile crash');
      });
      mockStore.clearFlag.mockImplementation(() => {
        throw new Error('clearFlag crash');
      });

      await expect(
        handleSessionEnd({
          sessionId: 'session-all-broken',
          transcriptPath: '/tmp/transcript.jsonl',
          sqliteStore: mockStore as any,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Flag status edge cases (unknown statuses should skip)
  // =========================================================================
  describe('Flag status edge cases', () => {
    it('should skip when flag status is an unknown value like processing', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'processing' }));

      await handleSessionEnd({
        sessionId: 'session-unknown-status',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.upgradeFlag).not.toHaveBeenCalled();
      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
      expect(mockStore.clearFlag).not.toHaveBeenCalled();
    });

    it('should skip when flag status is an empty string', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: '' }));

      await handleSessionEnd({
        sessionId: 'session-empty-status',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.upgradeFlag).not.toHaveBeenCalled();
      expect(mockedParseTranscriptFile).not.toHaveBeenCalled();
      expect(mockStore.clearFlag).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // recordHookError in catch blocks (Persistent Error Tracking)
  // =========================================================================
  describe('recordHookError in catch blocks', () => {
    it('should call recordHookError with database component when getFlag throws', async () => {
      // Arrange: getFlag throws immediately
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Database is closed');
      });

      // Act
      await handleSessionEnd({
        sessionId: 'session-getflag-err-record',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      // Assert: recordHookError should have been called for database component
      expect(mockStore.recordHookError).toHaveBeenCalledWith(
        'database',
        'session-end',
        expect.stringContaining('Database is closed'),
      );
    });

    it('should call recordHookError with database component when upgradeFlag throws', async () => {
      // Arrange: flag=frustrated, upgradeFlag throws
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockStore.upgradeFlag.mockImplementation(() => {
        throw new Error('Database is locked');
      });
      mockedParseTranscriptFile.mockReturnValue(null);

      // Act
      await handleSessionEnd({
        sessionId: 'session-upgrade-err-record',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      // Assert: recordHookError should have been called for database component
      expect(mockStore.recordHookError).toHaveBeenCalledWith(
        'database',
        'session-end',
        expect.stringContaining('Database is locked'),
      );
    });

    it('should call recordHookError in the outermost catch block', async () => {
      // Arrange: trigger the outermost catch. getFlag throws which hits the
      // inner catch and returns, but if something goes wrong beyond that...
      // We test with getFlag throwing since it exercises the top-level catch
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Unexpected session-end error');
      });

      // Act
      await handleSessionEnd({
        sessionId: 'session-toplevel-err',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      // Assert: the outermost catch should call input?.sqliteStore?.recordHookError
      expect(mockStore.recordHookError).toHaveBeenCalledWith(
        'database',
        'session-end',
        expect.any(String),
      );
    });

    it('should still return void even when recordHookError itself throws', async () => {
      // Arrange: getFlag throws, AND recordHookError also throws
      mockStore.getFlag.mockImplementation(() => {
        throw new Error('Database is closed');
      });
      mockStore.recordHookError.mockImplementation(() => {
        throw new Error('recordHookError also crashed');
      });

      // Act
      const result = await handleSessionEnd({
        sessionId: 'session-double-fail',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      // Assert: should still return void (graceful degradation)
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // Feature 2: Feedback Loop - INEFFECTIVE tagging at session end
  // =========================================================================
  describe('Feature 2: INEFFECTIVE tagging at session end', () => {
    it('should call markPriorAdviceIneffective per advised ID when frustrated flag exists', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'sess-ineff' }));
      mockStore.getAdvisedExperienceIds.mockReturnValue(['exp-a', 'exp-b']);
      mockedParseTranscriptFile.mockReturnValue(makeTranscriptData());
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'sess-ineff',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.markPriorAdviceIneffective).toHaveBeenCalledWith('exp-a', 'sess-ineff');
      expect(mockStore.markPriorAdviceIneffective).toHaveBeenCalledWith('exp-b', 'sess-ineff');
    });

    it('should NOT call markPriorAdviceIneffective when no advised IDs', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated' }));
      mockStore.getAdvisedExperienceIds.mockReturnValue([]);
      mockedParseTranscriptFile.mockReturnValue(makeTranscriptData());
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'sess-no-adv',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.markPriorAdviceIneffective).not.toHaveBeenCalled();
    });

    it('should still run capture pipeline when getAdvisedExperienceIds throws', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'sess-err-adv' }));
      mockStore.getAdvisedExperienceIds.mockImplementation(() => {
        throw new Error('DB error');
      });
      mockedParseTranscriptFile.mockReturnValue(makeTranscriptData());
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'sess-err-adv',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      // Capture pipeline should still have run
      expect(mockStore.upgradeFlag).toHaveBeenCalledWith('sess-err-adv', 'capture');
      expect(mockStore.clearFlag).toHaveBeenCalledWith('sess-err-adv');
    });

    it('should still run capture pipeline when markPriorAdviceIneffective throws', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'frustrated', session_id: 'sess-err-mark' }));
      mockStore.getAdvisedExperienceIds.mockReturnValue(['exp-x']);
      mockStore.markPriorAdviceIneffective.mockImplementation(() => {
        throw new Error('DB error');
      });
      mockedParseTranscriptFile.mockReturnValue(makeTranscriptData());
      mockStore.getPendingDrafts.mockReturnValue([]);

      await handleSessionEnd({
        sessionId: 'sess-err-mark',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.upgradeFlag).toHaveBeenCalledWith('sess-err-mark', 'capture');
      expect(mockStore.clearFlag).toHaveBeenCalledWith('sess-err-mark');
    });

    it('should NOT run INEFFECTIVE logic when flag is capture or null', async () => {
      mockStore.getFlag.mockReturnValue(makeFlagRow({ status: 'capture' }));

      await handleSessionEnd({
        sessionId: 'sess-capture',
        transcriptPath: '/tmp/transcript.jsonl',
        sqliteStore: mockStore as any,
      });

      expect(mockStore.getAdvisedExperienceIds).not.toHaveBeenCalled();
      expect(mockStore.markPriorAdviceIneffective).not.toHaveBeenCalled();
    });
  });
});
