/**
 * Unit Tests for UserPromptSubmit Handler
 *
 * TDD RED phase: These tests define the expected behavior of the
 * handleUserPromptSubmit function BEFORE the implementation exists.
 * All tests are expected to FAIL until the handler is properly implemented.
 *
 * How handleUserPromptSubmit works (specification):
 *   1. Receives { prompt, sessionId, llmProvider, sqliteStore, vectorStore }
 *   2. Calls analyzeFrustration(prompt, llmProvider) to classify the prompt
 *   3. Based on analysis type:
 *      - 'frustrated': setFlag(sessionId, 'frustrated'), then searchMemory(prompt, ...).
 *        If match found -> output systemMessage with suggestedAction.
 *        If no match -> output '{}'.
 *      - 'resolution' or 'abandonment': check getFlag(sessionId).
 *        If flag status is 'frustrated' -> upgradeFlag(sessionId, 'capture').
 *        If no flag or different status -> pass through.
 *      - 'normal': output '{}'.
 *   4. ALWAYS calls storeTurn(sessionId, prompt, JSON.stringify(analysis))
 *   5. Checks getPendingDrafts() from other sessions -> adds notification to systemMessage
 *   6. Returns JSON string: '{}' or '{"systemMessage": "..."}'
 *   7. NEVER throws -- all errors gracefully return '{}'
 *
 * Test categories:
 *   1. frustrated + memory match -> systemMessage with suggestedAction
 *   2. frustrated + no match -> '{}', flag set to 'frustrated'
 *   3. resolution + existing frustrated flag -> upgradeFlag('capture') called
 *   4. resolution + no existing flag -> pass through, no upgradeFlag
 *   5. abandonment + existing frustrated flag -> upgradeFlag('capture') called
 *   6. normal -> output '{}'
 *   7. pending drafts from other sessions -> notification in systemMessage
 *   8. storeTurn is always called regardless of analysis type
 *   9. analyzeFrustration throws -> output '{}'
 *  10. searchMemory throws -> output '{}', flag still set
 *  11. invalid input (missing prompt) -> output '{}'
 *  12. frustrated + match + pending drafts -> systemMessage has both
 */

import { handleUserPromptSubmit } from '../../src/hook/user-prompt-submit-handler';
import { analyzeFrustration } from '../../src/analysis/frustration-analyzer';
import { searchMemory } from '../../src/recall/memory-matcher';
import type { LLMProvider, FrustrationAnalysis, MatchResult, FailureExperience, AutoMemoryCandidate } from '../../src/types/index';
import type { SqliteStore } from '../../src/storage/sqlite-store';
import type { VectorStore } from '../../src/storage/vector-store';

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

jest.mock('../../src/analysis/frustration-analyzer', () => ({
  analyzeFrustration: jest.fn(),
}));

jest.mock('../../src/recall/memory-matcher', () => ({
  searchMemory: jest.fn(),
}));

const mockedAnalyzeFrustration = analyzeFrustration as jest.MockedFunction<typeof analyzeFrustration>;
const mockedSearchMemory = searchMemory as jest.MockedFunction<typeof searchMemory>;

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

/**
 * Creates a FrustrationAnalysis with sensible defaults that can be overridden.
 */
function makeAnalysis(overrides: Partial<FrustrationAnalysis> = {}): FrustrationAnalysis {
  return {
    type: 'normal',
    confidence: 0.9,
    reasoning: 'Default test analysis',
    ...overrides,
  };
}

/**
 * Creates a FailureExperience with sensible defaults.
 */
function makeExperience(overrides: Partial<FailureExperience> = {}): FailureExperience {
  return {
    id: 'exp-001',
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried adding null check', 'Tried optional chaining'],
    successfulApproach: 'Initialized the variable before use',
    lessons: ['Always check initialization order'],
    createdAt: '2026-02-15T10:00:00Z',
    ...overrides,
  };
}

/**
 * Creates a MatchResult with sensible defaults.
 */
function makeMatchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    experience: makeExperience(),
    confidence: 0.85,
    suggestedAction: 'Initialize the variable before accessing its properties.',
    ...overrides,
  };
}

/**
 * Creates an AutoMemoryCandidate (pending draft) with sensible defaults.
 */
function makePendingDraft(overrides: Partial<AutoMemoryCandidate> = {}): AutoMemoryCandidate {
  return {
    id: 'draft-001',
    sessionId: 'other-session-999',
    frustrationSignature: 'ENOENT: no such file or directory',
    failedApproaches: ['Checked wrong directory'],
    successfulApproach: 'Used absolute path',
    lessons: ['Always verify file paths'],
    status: 'pending',
    createdAt: '2026-02-15T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock store factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock SqliteStore with jest.fn() for each method.
 */
function createMockSqliteStore(): jest.Mocked<Pick<SqliteStore,
  'setFlag' | 'getFlag' | 'upgradeFlag' | 'clearFlag' |
  'storeTurn' | 'getTurnsBySession' |
  'getPendingDrafts' | 'storeCandidate' | 'deleteCandidate' | 'updateCandidateStatus' |
  'storeExperience' | 'getExperience' |
  'getAdvisedExperienceIds' | 'recordAdvice' |
  'initialize' | 'close' | 'runInTransaction'
>> & SqliteStore {
  return {
    setFlag: jest.fn(),
    getFlag: jest.fn().mockReturnValue(null),
    upgradeFlag: jest.fn(),
    clearFlag: jest.fn(),
    storeTurn: jest.fn(),
    getTurnsBySession: jest.fn().mockReturnValue([]),
    getPendingDrafts: jest.fn().mockReturnValue([]),
    storeCandidate: jest.fn(),
    deleteCandidate: jest.fn(),
    updateCandidateStatus: jest.fn(),
    storeExperience: jest.fn(),
    getExperience: jest.fn().mockReturnValue(null),
    getAdvisedExperienceIds: jest.fn().mockReturnValue([]),
    recordAdvice: jest.fn(),
    initialize: jest.fn(),
    close: jest.fn(),
    runInTransaction: jest.fn(),
  } as unknown as jest.Mocked<Pick<SqliteStore,
    'setFlag' | 'getFlag' | 'upgradeFlag' | 'clearFlag' |
    'storeTurn' | 'getTurnsBySession' |
    'getPendingDrafts' | 'storeCandidate' | 'deleteCandidate' | 'updateCandidateStatus' |
    'storeExperience' | 'getExperience' |
    'getAdvisedExperienceIds' | 'recordAdvice' |
    'initialize' | 'close' | 'runInTransaction'
  >> & SqliteStore;
}

/**
 * Creates a mock VectorStore with jest.fn() for each method.
 */
function createMockVectorStore(): jest.Mocked<Pick<VectorStore,
  'search' | 'store' | 'delete' | 'clearVectors' | 'initialize' | 'close'
>> & VectorStore {
  return {
    search: jest.fn().mockReturnValue([]),
    store: jest.fn(),
    delete: jest.fn(),
    clearVectors: jest.fn(),
    initialize: jest.fn(),
    close: jest.fn(),
  } as unknown as jest.Mocked<Pick<VectorStore,
    'search' | 'store' | 'delete' | 'clearVectors' | 'initialize' | 'close'
  >> & VectorStore;
}

/**
 * Creates a mock LLMProvider with jest.fn() for each method.
 */
function createMockLLMProvider(): jest.Mocked<LLMProvider> {
  return {
    getModelName: jest.fn().mockReturnValue('mock'),
    generateCompletion: jest.fn().mockResolvedValue('{}'),
    generateEmbedding: jest.fn().mockResolvedValue(new Array(128).fill(0)),
    isAvailable: jest.fn().mockResolvedValue(true),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('UserPromptSubmitHandler - handleUserPromptSubmit', () => {
  let mockLLM: jest.Mocked<LLMProvider>;
  let mockSqliteStore: ReturnType<typeof createMockSqliteStore>;
  let mockVectorStore: ReturnType<typeof createMockVectorStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLLM = createMockLLMProvider();
    mockSqliteStore = createMockSqliteStore();
    mockVectorStore = createMockVectorStore();

    // Default: analyzeFrustration returns 'normal'
    mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
    // Default: searchMemory returns null (no match)
    mockedSearchMemory.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. frustrated + memory match -> systemMessage with suggestedAction
  // =========================================================================
  describe('frustrated + memory match', () => {
    it('should return a JSON string containing systemMessage when frustrated and a memory match is found', async () => {
      // Arrange
      const analysis = makeAnalysis({ type: 'frustrated', confidence: 0.9, reasoning: 'User is frustrated' });
      const match = makeMatchResult({ suggestedAction: 'Try initializing the variable first.' });
      mockedAnalyzeFrustration.mockResolvedValue(analysis);
      mockedSearchMemory.mockResolvedValue(match);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'This TypeError keeps happening again!',
        sessionId: 'session-001',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      const parsed = JSON.parse(result);
      expect(parsed.systemMessage).toBeDefined();
      expect(parsed.systemMessage).toContain('Try initializing the variable first.');
    });

    it('should call setFlag with "frustrated" when analysis type is frustrated', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(makeMatchResult());

      // Act
      await handleUserPromptSubmit({
        prompt: 'This error is driving me crazy',
        sessionId: 'session-002',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.setFlag).toHaveBeenCalledWith('session-002', 'frustrated');
    });

    it('should call searchMemory with the prompt, llmProvider, vectorStore, sqliteStore, and exclusion list', async () => {
      // Arrange
      const prompt = 'Why does this keep failing?';
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(null);
      // No prior advices
      (mockSqliteStore.getAdvisedExperienceIds as jest.Mock).mockReturnValue([]);

      // Act
      await handleUserPromptSubmit({
        prompt,
        sessionId: 'session-003',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert: searchMemory should be called with empty exclusion list
      expect(mockedSearchMemory).toHaveBeenCalledWith(
        prompt,
        mockLLM,
        mockVectorStore,
        mockSqliteStore,
        [],
      );
    });

    it('should include experience details in systemMessage when match is found', async () => {
      // Arrange
      const experience = makeExperience({
        frustrationSignature: 'ENOENT: no such file or directory',
        lessons: ['Always use absolute paths'],
      });
      const match = makeMatchResult({
        experience,
        suggestedAction: 'Use path.resolve() to construct absolute paths.',
        confidence: 0.92,
      });
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(match);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'File not found error again',
        sessionId: 'session-004',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      const parsed = JSON.parse(result);
      expect(parsed.systemMessage).toBeDefined();
      expect(parsed.systemMessage).toContain('Use path.resolve()');
    });
  });

  // =========================================================================
  // 2. frustrated + no match -> '{}', flag set to 'frustrated'
  // =========================================================================
  describe('frustrated + no memory match', () => {
    it('should return "{}" when analysis is frustrated but no memory match is found', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(null);
      // No pending drafts either
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Something is broken but this is a new error',
        sessionId: 'session-010',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should still set the flag to "frustrated" even when no match is found', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'New error I have not seen before',
        sessionId: 'session-011',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.setFlag).toHaveBeenCalledWith('session-011', 'frustrated');
    });
  });

  // =========================================================================
  // 3. resolution + existing frustrated flag -> upgradeFlag('capture')
  // =========================================================================
  describe('resolution + existing frustrated flag', () => {
    it('should call upgradeFlag with "capture" when analysis is resolution and flag is "frustrated"', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'resolution' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue({
        session_id: 'session-020',
        status: 'frustrated',
        flagged_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T00:00:00Z',
      });

      // Act
      await handleUserPromptSubmit({
        prompt: 'It works now! The fix was to add the missing import.',
        sessionId: 'session-020',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.upgradeFlag).toHaveBeenCalledWith('session-020', 'capture');
    });

    it('should call getFlag with the correct sessionId for resolution type', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'resolution' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue({
        session_id: 'session-021',
        status: 'frustrated',
        flagged_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T00:00:00Z',
      });

      // Act
      await handleUserPromptSubmit({
        prompt: 'Fixed it.',
        sessionId: 'session-021',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.getFlag).toHaveBeenCalledWith('session-021');
    });

    it('should NOT call searchMemory when analysis type is resolution', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'resolution' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue({
        session_id: 'session-022',
        status: 'frustrated',
        flagged_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T00:00:00Z',
      });

      // Act
      await handleUserPromptSubmit({
        prompt: 'Found the solution!',
        sessionId: 'session-022',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockedSearchMemory).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. resolution + no existing flag -> pass through, no upgradeFlag
  // =========================================================================
  describe('resolution + no existing flag', () => {
    it('should NOT call upgradeFlag when analysis is resolution but no flag exists', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'resolution' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'This works perfectly.',
        sessionId: 'session-030',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.upgradeFlag).not.toHaveBeenCalled();
    });

    it('should return "{}" when resolution with no prior flag and no pending drafts', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'resolution' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue(null);
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Everything is fine now.',
        sessionId: 'session-031',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should NOT call upgradeFlag when flag exists but status is not "frustrated"', async () => {
      // Arrange: flag exists with status 'capture' (already upgraded)
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'resolution' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue({
        session_id: 'session-032',
        status: 'capture',
        flagged_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T00:00:00Z',
      });

      // Act
      await handleUserPromptSubmit({
        prompt: 'Resolved the issue.',
        sessionId: 'session-032',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.upgradeFlag).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. abandonment + existing frustrated flag -> upgradeFlag('capture')
  // =========================================================================
  describe('abandonment + existing frustrated flag', () => {
    it('should call upgradeFlag with "capture" when analysis is abandonment and flag is "frustrated"', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'abandonment' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue({
        session_id: 'session-040',
        status: 'frustrated',
        flagged_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T00:00:00Z',
      });

      // Act
      await handleUserPromptSubmit({
        prompt: 'Forget it, let me try a completely different approach.',
        sessionId: 'session-040',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.upgradeFlag).toHaveBeenCalledWith('session-040', 'capture');
    });

    it('should NOT call upgradeFlag when abandonment but no flag exists', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'abandonment' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Giving up on this approach.',
        sessionId: 'session-041',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.upgradeFlag).not.toHaveBeenCalled();
    });

    it('should NOT call searchMemory when analysis type is abandonment', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'abandonment' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue({
        session_id: 'session-042',
        status: 'frustrated',
        flagged_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T00:00:00Z',
      });

      // Act
      await handleUserPromptSubmit({
        prompt: 'Switching to plan B.',
        sessionId: 'session-042',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockedSearchMemory).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 6. normal -> output '{}'
  // =========================================================================
  describe('normal analysis type', () => {
    it('should return "{}" when analysis type is normal and no pending drafts', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Can you add a unit test for this function?',
        sessionId: 'session-050',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should NOT call setFlag when analysis type is normal', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));

      // Act
      await handleUserPromptSubmit({
        prompt: 'Refactor this function.',
        sessionId: 'session-051',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.setFlag).not.toHaveBeenCalled();
    });

    it('should NOT call searchMemory when analysis type is normal', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));

      // Act
      await handleUserPromptSubmit({
        prompt: 'Add error handling here.',
        sessionId: 'session-052',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockedSearchMemory).not.toHaveBeenCalled();
    });

    it('should NOT call upgradeFlag when analysis type is normal', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));

      // Act
      await handleUserPromptSubmit({
        prompt: 'Write documentation.',
        sessionId: 'session-053',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.upgradeFlag).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. pending drafts from other sessions -> notification in systemMessage
  // =========================================================================
  describe('pending drafts notification', () => {
    it('should include draft notification in systemMessage when pending drafts exist from other sessions', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
      const drafts = [
        makePendingDraft({ id: 'draft-100', sessionId: 'other-session-100' }),
        makePendingDraft({ id: 'draft-101', sessionId: 'other-session-101' }),
      ];
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue(drafts);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Regular prompt.',
        sessionId: 'session-060',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      const parsed = JSON.parse(result);
      expect(parsed.systemMessage).toBeDefined();
      // The notification should mention pending drafts or review
      expect(typeof parsed.systemMessage).toBe('string');
      expect(parsed.systemMessage.length).toBeGreaterThan(0);
    });

    it('should NOT include draft notification when drafts are from the same session', async () => {
      // Arrange: all pending drafts are from the current session
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
      const drafts = [
        makePendingDraft({ id: 'draft-200', sessionId: 'session-061' }),
      ];
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue(drafts);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Regular prompt.',
        sessionId: 'session-061',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert: no notification since all drafts are from the current session
      expect(result).toBe('{}');
    });

    it('should call getPendingDrafts to check for pending drafts', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));

      // Act
      await handleUserPromptSubmit({
        prompt: 'Any prompt.',
        sessionId: 'session-062',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.getPendingDrafts).toHaveBeenCalled();
    });

    it('should return "{}" when there are no pending drafts and analysis is normal', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Normal prompt, no drafts.',
        sessionId: 'session-063',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });
  });

  // =========================================================================
  // 8. storeTurn is always called regardless of analysis type
  // =========================================================================
  describe('storeTurn always called', () => {
    it('should call storeTurn for "normal" analysis type', async () => {
      // Arrange
      const analysis = makeAnalysis({ type: 'normal' });
      mockedAnalyzeFrustration.mockResolvedValue(analysis);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Normal prompt.',
        sessionId: 'session-070',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.storeTurn).toHaveBeenCalledWith(
        'session-070',
        'Normal prompt.',
        JSON.stringify(analysis),
      );
    });

    it('should call storeTurn for "frustrated" analysis type', async () => {
      // Arrange
      const analysis = makeAnalysis({ type: 'frustrated', confidence: 0.88 });
      mockedAnalyzeFrustration.mockResolvedValue(analysis);
      mockedSearchMemory.mockResolvedValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Frustrated prompt!',
        sessionId: 'session-071',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.storeTurn).toHaveBeenCalledWith(
        'session-071',
        'Frustrated prompt!',
        JSON.stringify(analysis),
      );
    });

    it('should call storeTurn for "resolution" analysis type', async () => {
      // Arrange
      const analysis = makeAnalysis({ type: 'resolution' });
      mockedAnalyzeFrustration.mockResolvedValue(analysis);
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Resolution prompt.',
        sessionId: 'session-072',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.storeTurn).toHaveBeenCalledWith(
        'session-072',
        'Resolution prompt.',
        JSON.stringify(analysis),
      );
    });

    it('should call storeTurn for "abandonment" analysis type', async () => {
      // Arrange
      const analysis = makeAnalysis({ type: 'abandonment' });
      mockedAnalyzeFrustration.mockResolvedValue(analysis);
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Abandonment prompt.',
        sessionId: 'session-073',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.storeTurn).toHaveBeenCalledWith(
        'session-073',
        'Abandonment prompt.',
        JSON.stringify(analysis),
      );
    });

    it('should call storeTurn with the prompt and the JSON-stringified analysis', async () => {
      // Arrange
      const analysis = makeAnalysis({
        type: 'frustrated',
        confidence: 0.77,
        intent: 'Fixing a build error',
        context: 'Third attempt',
        reasoning: 'Repeated failure indicators',
      });
      mockedAnalyzeFrustration.mockResolvedValue(analysis);
      mockedSearchMemory.mockResolvedValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Build error yet again.',
        sessionId: 'session-074',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.storeTurn).toHaveBeenCalledTimes(1);
      const [sessionId, prompt, analysisStr] = (mockSqliteStore.storeTurn as jest.Mock).mock.calls[0];
      expect(sessionId).toBe('session-074');
      expect(prompt).toBe('Build error yet again.');
      expect(JSON.parse(analysisStr)).toEqual(analysis);
    });
  });

  // =========================================================================
  // 9. analyzeFrustration throws -> output '{}'
  // =========================================================================
  describe('analyzeFrustration throws', () => {
    it('should return "{}" when analyzeFrustration throws an error', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockRejectedValue(new Error('LLM connection failed'));

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Some prompt.',
        sessionId: 'session-080',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should never throw even when analyzeFrustration rejects', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockRejectedValue(new Error('Unexpected failure'));

      // Act & Assert: must resolve, never reject
      await expect(
        handleUserPromptSubmit({
          prompt: 'Some prompt.',
          sessionId: 'session-081',
          llmProvider: mockLLM,
          sqliteStore: mockSqliteStore,
          vectorStore: mockVectorStore,
        }),
      ).resolves.toBeDefined();
    });

    it('should return "{}" when analyzeFrustration rejects with a non-Error value', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockRejectedValue('string error');

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Another prompt.',
        sessionId: 'session-082',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });
  });

  // =========================================================================
  // 10. searchMemory throws -> output '{}', flag still set
  // =========================================================================
  describe('searchMemory throws', () => {
    it('should return "{}" when searchMemory throws an error', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockRejectedValue(new Error('Vector DB crashed'));
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Frustrated prompt.',
        sessionId: 'session-090',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should still call setFlag before searchMemory throws', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockRejectedValue(new Error('Search failed'));

      // Act
      await handleUserPromptSubmit({
        prompt: 'Frustrated prompt with search error.',
        sessionId: 'session-091',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert: setFlag should have been called before searchMemory was attempted
      expect(mockSqliteStore.setFlag).toHaveBeenCalledWith('session-091', 'frustrated');
    });

    it('should never throw when searchMemory rejects', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockRejectedValue(new Error('Catastrophic failure'));

      // Act & Assert
      await expect(
        handleUserPromptSubmit({
          prompt: 'Error prompt.',
          sessionId: 'session-092',
          llmProvider: mockLLM,
          sqliteStore: mockSqliteStore,
          vectorStore: mockVectorStore,
        }),
      ).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // 11. invalid input (missing prompt) -> output '{}'
  // =========================================================================
  describe('invalid input', () => {
    it('should return "{}" when prompt is an empty string', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: '',
        sessionId: 'session-100',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should return "{}" when prompt is undefined (cast as any)', async () => {
      // Arrange: simulate missing prompt via type assertion
      // Act
      const result = await handleUserPromptSubmit({
        prompt: undefined as any,
        sessionId: 'session-101',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should return "{}" when sessionId is an empty string', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Some prompt.',
        sessionId: '',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should never throw regardless of invalid input', async () => {
      // Act & Assert: must resolve, never reject
      await expect(
        handleUserPromptSubmit({
          prompt: null as any,
          sessionId: null as any,
          llmProvider: null as any,
          sqliteStore: null as any,
          vectorStore: null as any,
        }),
      ).resolves.toBe('{}');
    });
  });

  // =========================================================================
  // 12. frustrated + match + pending drafts -> systemMessage has both
  // =========================================================================
  describe('frustrated + match + pending drafts combined', () => {
    it('should include BOTH match advice AND draft notification in systemMessage', async () => {
      // Arrange
      const analysis = makeAnalysis({ type: 'frustrated', confidence: 0.95 });
      const match = makeMatchResult({
        suggestedAction: 'Check the file path encoding.',
        confidence: 0.88,
      });
      const drafts = [
        makePendingDraft({ id: 'draft-300', sessionId: 'other-session-300' }),
      ];
      mockedAnalyzeFrustration.mockResolvedValue(analysis);
      mockedSearchMemory.mockResolvedValue(match);
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue(drafts);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'This file path error keeps happening!',
        sessionId: 'session-110',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      const parsed = JSON.parse(result);
      expect(parsed.systemMessage).toBeDefined();
      // systemMessage should contain the match advice
      expect(parsed.systemMessage).toContain('Check the file path encoding.');
      // systemMessage should also contain some draft notification
      // (we check that the message is longer than just the match advice, implying both are present)
      expect(parsed.systemMessage.length).toBeGreaterThan('Check the file path encoding.'.length);
    });

    it('should produce valid JSON output when both match and drafts are present', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(makeMatchResult());
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([
        makePendingDraft({ sessionId: 'other-session-400' }),
      ]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Error again!',
        sessionId: 'session-111',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert: result must be valid JSON
      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(typeof parsed).toBe('object');
    });
  });

  // =========================================================================
  // Per-experience dedup: getAdvisedExperienceIds + exclusion
  // =========================================================================
  describe('per-experience dedup with getAdvisedExperienceIds', () => {
    it('should pass already-advised experience IDs to searchMemory as exclusion list', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(null);
      (mockSqliteStore.getAdvisedExperienceIds as jest.Mock).mockReturnValue(['exp-001', 'exp-002']);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Error again!',
        sessionId: 'session-dedup-001',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert: searchMemory should receive the exclusion list
      expect(mockedSearchMemory).toHaveBeenCalledWith(
        'Error again!',
        mockLLM,
        mockVectorStore,
        mockSqliteStore,
        ['exp-001', 'exp-002'],
      );
    });

    it('should call getAdvisedExperienceIds with the sessionId', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Frustrated prompt',
        sessionId: 'session-dedup-002',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockSqliteStore.getAdvisedExperienceIds).toHaveBeenCalledWith('session-dedup-002');
    });

    it('should still allow search when some advices exist but below max limit', async () => {
      // Arrange: 2 advices, max is 5 (default)
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      (mockSqliteStore.getAdvisedExperienceIds as jest.Mock).mockReturnValue(['exp-001', 'exp-002']);
      const match = makeMatchResult({ experience: makeExperience({ id: 'exp-003' }) });
      mockedSearchMemory.mockResolvedValue(match);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Another error!',
        sessionId: 'session-dedup-003',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert: searchMemory should be called (not skipped)
      expect(mockedSearchMemory).toHaveBeenCalled();
      const parsed = JSON.parse(result);
      expect(parsed.systemMessage).toBeDefined();
    });
  });

  // =========================================================================
  // Max advice limit per session
  // =========================================================================
  describe('max advice limit per session', () => {
    it('should skip searchMemory when advised count reaches maxAdvicesPerSession', async () => {
      // Arrange: 5 advices already (default max is 5)
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      (mockSqliteStore.getAdvisedExperienceIds as jest.Mock).mockReturnValue(
        ['exp-1', 'exp-2', 'exp-3', 'exp-4', 'exp-5']
      );
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Yet another error!',
        sessionId: 'session-max-001',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert: searchMemory should NOT be called
      expect(mockedSearchMemory).not.toHaveBeenCalled();
      expect(result).toBe('{}');
    });

    it('should respect custom maxAdvicesPerSession from input', async () => {
      // Arrange: 2 advices already, max set to 2
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      (mockSqliteStore.getAdvisedExperienceIds as jest.Mock).mockReturnValue(['exp-1', 'exp-2']);
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Error prompt',
        sessionId: 'session-max-002',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
        maxAdvicesPerSession: 2,
      });

      // Assert: searchMemory should NOT be called (at limit)
      expect(mockedSearchMemory).not.toHaveBeenCalled();
    });

    it('should allow searchMemory when under custom maxAdvicesPerSession', async () => {
      // Arrange: 1 advice, max is 2
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      (mockSqliteStore.getAdvisedExperienceIds as jest.Mock).mockReturnValue(['exp-1']);
      mockedSearchMemory.mockResolvedValue(null);

      // Act
      await handleUserPromptSubmit({
        prompt: 'Error prompt',
        sessionId: 'session-max-003',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
        maxAdvicesPerSession: 2,
      });

      // Assert: searchMemory should be called
      expect(mockedSearchMemory).toHaveBeenCalled();
    });

    it('should still set flag even when max limit is reached', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      (mockSqliteStore.getAdvisedExperienceIds as jest.Mock).mockReturnValue(
        ['exp-1', 'exp-2', 'exp-3', 'exp-4', 'exp-5']
      );

      // Act
      await handleUserPromptSubmit({
        prompt: 'Error!',
        sessionId: 'session-max-004',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert: flag should still be set
      expect(mockSqliteStore.setFlag).toHaveBeenCalledWith('session-max-004', 'frustrated');
    });
  });

  // =========================================================================
  // Output format validation
  // =========================================================================
  describe('output format', () => {
    it('should always return valid JSON string', async () => {
      // Arrange: various scenarios
      const scenarios: Array<{ type: FrustrationAnalysis['type']; match: MatchResult | null }> = [
        { type: 'normal', match: null },
        { type: 'frustrated', match: null },
        { type: 'frustrated', match: makeMatchResult() },
        { type: 'resolution', match: null },
        { type: 'abandonment', match: null },
      ];

      for (const scenario of scenarios) {
        mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: scenario.type }));
        mockedSearchMemory.mockResolvedValue(scenario.match);
        if (scenario.type === 'resolution' || scenario.type === 'abandonment') {
          (mockSqliteStore.getFlag as jest.Mock).mockReturnValue(null);
        }
        (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

        const result = await handleUserPromptSubmit({
          prompt: `Test prompt for ${scenario.type}`,
          sessionId: 'session-120',
          llmProvider: mockLLM,
          sqliteStore: mockSqliteStore,
          vectorStore: mockVectorStore,
        });

        // Assert: must be valid JSON
        expect(() => JSON.parse(result)).not.toThrow();
      }
    });

    it('should only contain "systemMessage" key when present, no extra keys', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      mockedSearchMemory.mockResolvedValue(makeMatchResult());
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'Frustrated!',
        sessionId: 'session-130',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      const parsed = JSON.parse(result);
      const keys = Object.keys(parsed);
      // Should only have 'systemMessage' or be empty
      expect(keys.every(k => k === 'systemMessage')).toBe(true);
    });
  });

  // =========================================================================
  // Interaction: analyzeFrustration receives correct arguments
  // =========================================================================
  describe('analyzeFrustration receives correct arguments', () => {
    it('should pass the prompt and llmProvider to analyzeFrustration', async () => {
      // Arrange
      const prompt = 'Test prompt for analyzer';
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));

      // Act
      await handleUserPromptSubmit({
        prompt,
        sessionId: 'session-140',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockedAnalyzeFrustration).toHaveBeenCalledWith(prompt, mockLLM);
    });

    it('should call analyzeFrustration exactly once per invocation', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));

      // Act
      await handleUserPromptSubmit({
        prompt: 'Single call check.',
        sessionId: 'session-141',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(mockedAnalyzeFrustration).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Never-throw guarantee
  // =========================================================================
  describe('never-throw guarantee', () => {
    it('should return "{}" when storeTurn throws', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
      (mockSqliteStore.storeTurn as jest.Mock).mockImplementation(() => {
        throw new Error('DB write failed');
      });
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockReturnValue([]);

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'StoreTurn failure test.',
        sessionId: 'session-150',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should return "{}" when getPendingDrafts throws', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'normal' }));
      (mockSqliteStore.getPendingDrafts as jest.Mock).mockImplementation(() => {
        throw new Error('DB read failed');
      });

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'GetPendingDrafts failure test.',
        sessionId: 'session-151',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should return "{}" when setFlag throws during frustrated flow', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'frustrated' }));
      (mockSqliteStore.setFlag as jest.Mock).mockImplementation(() => {
        throw new Error('DB write failed');
      });

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'SetFlag failure test.',
        sessionId: 'session-152',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });

    it('should return "{}" when upgradeFlag throws during resolution flow', async () => {
      // Arrange
      mockedAnalyzeFrustration.mockResolvedValue(makeAnalysis({ type: 'resolution' }));
      (mockSqliteStore.getFlag as jest.Mock).mockReturnValue({
        session_id: 'session-153',
        status: 'frustrated',
        flagged_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T00:00:00Z',
      });
      (mockSqliteStore.upgradeFlag as jest.Mock).mockImplementation(() => {
        throw new Error('DB update failed');
      });

      // Act
      const result = await handleUserPromptSubmit({
        prompt: 'UpgradeFlag failure test.',
        sessionId: 'session-153',
        llmProvider: mockLLM,
        sqliteStore: mockSqliteStore,
        vectorStore: mockVectorStore,
      });

      // Assert
      expect(result).toBe('{}');
    });
  });
});
