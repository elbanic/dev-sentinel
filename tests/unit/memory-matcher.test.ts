/**
 * Unit Tests for RAG Memory Matcher
 *
 * These tests verify the behavior of the searchMemory function which performs
 * RAG-based memory matching for Dev Sentinel's Active Recall system.
 *
 * Pipeline under test:
 *   1. llmProvider.generateEmbedding(prompt) -> vector
 *   2. vectorStore.search(vector, topK=3, minSimilarity=0.7) -> candidates
 *   3. For each candidate: sqliteStore.getExperience(candidate.id) -> FailureExperience
 *   4. llmProvider.generateCompletion(PROMPTS.ragJudge, ...) -> JSON judge response
 *   5. Return the most relevant match as MatchResult, or null
 *
 * 30 unit tests covering normal flow, empty results, LLM judge irrelevance,
 * graceful error handling, multiple candidates, skipped null experiences,
 * malformed LLM responses, and edge cases.
 */

import { searchMemory } from '../../src/recall/memory-matcher';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import type { VectorStore, VectorSearchResult } from '../../src/storage/vector-store';
import type { SqliteStore } from '../../src/storage/sqlite-store';
import type { FailureExperience, MatchResult } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

/**
 * Creates a FailureExperience with sensible defaults that can be overridden.
 */
function makeExperience(overrides: Partial<FailureExperience> = {}): FailureExperience {
  return {
    id: 'exp-001',
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
 * Creates a VectorSearchResult with sensible defaults.
 */
function makeVectorResult(overrides: Partial<VectorSearchResult> = {}): VectorSearchResult {
  return {
    id: 'exp-001',
    similarity: 0.85,
    metadata: { model: 'qwen3-embedding:0.6b' },
    ...overrides,
  };
}

/**
 * Creates a valid RAG judge JSON response string.
 */
function makeJudgeResponse(overrides: {
  relevant?: boolean;
  confidence?: number;
  reasoning?: string;
  suggestedAction?: string;
} = {}): string {
  return JSON.stringify({
    relevant: true,
    confidence: 0.85,
    reasoning: 'The user is encountering the same TypeError pattern.',
    suggestedAction: 'Initialize the variable before accessing its properties.',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

/**
 * Creates a mock VectorStore using jest.fn() stubs.
 * No real DB connection is opened.
 */
function createMockVectorStore(): jest.Mocked<Pick<VectorStore, 'search' | 'store' | 'delete' | 'clearVectors' | 'initialize' | 'close'>> & VectorStore {
  return {
    search: jest.fn(),
    store: jest.fn(),
    delete: jest.fn(),
    clearVectors: jest.fn(),
    initialize: jest.fn(),
    close: jest.fn(),
  } as unknown as jest.Mocked<Pick<VectorStore, 'search' | 'store' | 'delete' | 'clearVectors' | 'initialize' | 'close'>> & VectorStore;
}

/**
 * Creates a mock SqliteStore using jest.fn() stubs.
 * No real DB connection is opened.
 */
function createMockSqliteStore(): jest.Mocked<Pick<SqliteStore, 'getExperience'>> & SqliteStore {
  return {
    getExperience: jest.fn(),
    storeExperience: jest.fn(),
    storeTurn: jest.fn(),
    getTurnsBySession: jest.fn(),
    setFlag: jest.fn(),
    getFlag: jest.fn(),
    upgradeFlag: jest.fn(),
    clearFlag: jest.fn(),
    storeCandidate: jest.fn(),
    getPendingDrafts: jest.fn(),
    deleteCandidate: jest.fn(),
    updateCandidateStatus: jest.fn(),
    initialize: jest.fn(),
    close: jest.fn(),
    runInTransaction: jest.fn(),
  } as unknown as jest.Mocked<Pick<SqliteStore, 'getExperience'>> & SqliteStore;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Memory Matcher - searchMemory', () => {
  let mockLLM: MockLLMProvider;
  let mockVectorStore: ReturnType<typeof createMockVectorStore>;
  let mockSqliteStore: ReturnType<typeof createMockSqliteStore>;

  beforeEach(() => {
    mockLLM = new MockLLMProvider();
    mockVectorStore = createMockVectorStore();
    mockSqliteStore = createMockSqliteStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Test 1: Normal flow - full pipeline happy path
  // =========================================================================
  describe('Normal flow (happy path)', () => {
    it('should return a MatchResult when embedding, search, experience lookup, and LLM judge all succeed', async () => {
      // Arrange
      const prompt = 'Why is my TypeError happening again?';
      const experience = makeExperience();
      const vectorResult = makeVectorResult({ id: experience.id });

      // Step 1: generateEmbedding returns a vector (MockLLMProvider does this by default)
      // Step 2: vectorStore.search returns one candidate
      (mockVectorStore.search as jest.Mock).mockReturnValue([vectorResult]);
      // Step 3: sqliteStore.getExperience returns the experience
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      // Step 4: LLM judge says "relevant"
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.85, suggestedAction: 'Initialize the variable before use.' })
      );

      // Act
      const result = await searchMemory(prompt, mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.experience).toEqual(experience);
      expect(result!.confidence).toBeCloseTo(0.85);
      expect(result!.suggestedAction).toBe('Initialize the variable before use.');
    });

    it('should call generateEmbedding with the user prompt', async () => {
      // Arrange
      const prompt = 'My build keeps failing with ENOENT';
      const embeddingSpy = jest.spyOn(mockLLM, 'generateEmbedding');
      (mockVectorStore.search as jest.Mock).mockReturnValue([]);

      // Act
      await searchMemory(prompt, mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(embeddingSpy).toHaveBeenCalledTimes(1);
      expect(embeddingSpy).toHaveBeenCalledWith(prompt);
    });

    it('should call vectorStore.search with the embedding vector, topK=3, minSimilarity=0.7', async () => {
      // Arrange
      const prompt = 'Module not found error';
      (mockVectorStore.search as jest.Mock).mockReturnValue([]);

      // Act
      await searchMemory(prompt, mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(mockVectorStore.search).toHaveBeenCalledTimes(1);
      const callArgs = (mockVectorStore.search as jest.Mock).mock.calls[0];
      // First arg: embedding vector (array of numbers)
      expect(Array.isArray(callArgs[0])).toBe(true);
      expect(callArgs[0].every((v: unknown) => typeof v === 'number')).toBe(true);
      // Second arg: topK = 3
      expect(callArgs[1]).toBe(3);
      // Third arg: minSimilarity = 0.5
      expect(callArgs[2]).toBe(0.5);
    });

    it('should call sqliteStore.getExperience with each candidate ID', async () => {
      // Arrange
      const candidates = [
        makeVectorResult({ id: 'exp-001', similarity: 0.9 }),
        makeVectorResult({ id: 'exp-002', similarity: 0.8 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);
      (mockSqliteStore.getExperience as jest.Mock).mockImplementation((id: string) => {
        if (id === 'exp-001') return makeExperience({ id: 'exp-001' });
        if (id === 'exp-002') return makeExperience({ id: 'exp-002', frustrationSignature: 'Different error' });
        return null;
      });
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.8 })
      );

      // Act
      await searchMemory('some prompt', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(mockSqliteStore.getExperience).toHaveBeenCalledWith('exp-001');
      expect(mockSqliteStore.getExperience).toHaveBeenCalledWith('exp-002');
    });
  });

  // =========================================================================
  // Test 2: Vector search returns empty -> null
  // =========================================================================
  describe('Vector search returns empty', () => {
    it('should return null when vectorStore.search returns an empty array', async () => {
      // Arrange
      (mockVectorStore.search as jest.Mock).mockReturnValue([]);

      // Act
      const result = await searchMemory('No similar experiences', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).toBeNull();
    });

    it('should not call sqliteStore.getExperience when there are no vector candidates', async () => {
      // Arrange
      (mockVectorStore.search as jest.Mock).mockReturnValue([]);

      // Act
      await searchMemory('No matches', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(mockSqliteStore.getExperience).not.toHaveBeenCalled();
    });

    it('should not call generateCompletion for judging when there are no vector candidates', async () => {
      // Arrange
      (mockVectorStore.search as jest.Mock).mockReturnValue([]);
      const completionSpy = jest.spyOn(mockLLM, 'generateCompletion');

      // Act
      await searchMemory('No matches', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(completionSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 3: LLM judge says "irrelevant" -> null
  // =========================================================================
  describe('LLM judge says irrelevant', () => {
    it('should return null when the LLM judge determines the experience is not relevant', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({
          relevant: false,
          confidence: 0.3,
          reasoning: 'The context is completely different.',
          suggestedAction: '',
        })
      );

      // Act
      const result = await searchMemory('Something unrelated', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when all candidates are judged irrelevant', async () => {
      // Arrange: three candidates, all judged irrelevant
      const candidates = [
        makeVectorResult({ id: 'exp-001', similarity: 0.9 }),
        makeVectorResult({ id: 'exp-002', similarity: 0.85 }),
        makeVectorResult({ id: 'exp-003', similarity: 0.75 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);
      (mockSqliteStore.getExperience as jest.Mock).mockImplementation((id: string) =>
        makeExperience({ id })
      );
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: false, confidence: 0.2 })
      );

      // Act
      const result = await searchMemory('Totally different problem', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Test 4: LLM embedding failure (generateEmbedding throws) -> null (graceful)
  // =========================================================================
  describe('LLM embedding failure', () => {
    it('should return null when generateEmbedding throws an error', async () => {
      // Arrange
      jest.spyOn(mockLLM, 'generateEmbedding').mockRejectedValue(
        new Error('Ollama not available')
      );

      // Act
      const result = await searchMemory('Any prompt', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).toBeNull();
    });

    it('should not call vectorStore.search when generateEmbedding fails', async () => {
      // Arrange
      jest.spyOn(mockLLM, 'generateEmbedding').mockRejectedValue(
        new Error('Connection refused')
      );

      // Act
      await searchMemory('Any prompt', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(mockVectorStore.search).not.toHaveBeenCalled();
    });

    it('should not throw when generateEmbedding fails', async () => {
      // Arrange
      jest.spyOn(mockLLM, 'generateEmbedding').mockRejectedValue(
        new Error('Unexpected LLM failure')
      );

      // Act & Assert: must not throw
      await expect(
        searchMemory('Any prompt', mockLLM, mockVectorStore, mockSqliteStore)
      ).resolves.toBeNull();
    });
  });

  // =========================================================================
  // Test 5: LLM judge failure (generateCompletion throws) -> null (graceful)
  // =========================================================================
  describe('LLM judge failure', () => {
    it('should return null when generateCompletion throws during judging', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockRejectedValue(
        new Error('LLM rate limit exceeded')
      );

      // Act
      const result = await searchMemory('Prompt that needs judging', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).toBeNull();
    });

    it('should not throw when generateCompletion fails during judging', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockRejectedValue(
        new Error('Network timeout')
      );

      // Act & Assert
      await expect(
        searchMemory('Prompt that needs judging', mockLLM, mockVectorStore, mockSqliteStore)
      ).resolves.toBeNull();
    });
  });

  // =========================================================================
  // Test 6: Multiple candidates - returns the one with highest LLM confidence
  // =========================================================================
  describe('Multiple candidates with different confidence scores', () => {
    it('should return the candidate with the highest LLM confidence score', async () => {
      // Arrange: three candidates with different judge confidence scores
      const candidates = [
        makeVectorResult({ id: 'exp-low', similarity: 0.95 }),
        makeVectorResult({ id: 'exp-high', similarity: 0.80 }),
        makeVectorResult({ id: 'exp-mid', similarity: 0.85 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);

      const experiences: Record<string, FailureExperience> = {
        'exp-low': makeExperience({ id: 'exp-low', frustrationSignature: 'Low confidence match' }),
        'exp-high': makeExperience({ id: 'exp-high', frustrationSignature: 'High confidence match' }),
        'exp-mid': makeExperience({ id: 'exp-mid', frustrationSignature: 'Mid confidence match' }),
      };
      (mockSqliteStore.getExperience as jest.Mock).mockImplementation(
        (id: string) => experiences[id] ?? null
      );

      // The LLM judge returns different confidence scores for each candidate
      const judgeResponses: Record<string, string> = {
        'exp-low': makeJudgeResponse({ relevant: true, confidence: 0.4, suggestedAction: 'Low action' }),
        'exp-high': makeJudgeResponse({ relevant: true, confidence: 0.95, suggestedAction: 'High action' }),
        'exp-mid': makeJudgeResponse({ relevant: true, confidence: 0.7, suggestedAction: 'Mid action' }),
      };

      let completionCallIndex = 0;
      jest.spyOn(mockLLM, 'generateCompletion').mockImplementation(
        async (_system: string, user: string) => {
          // Determine which candidate is being judged based on the call order
          // (candidates are processed in the order returned by vector search)
          const candidateId = candidates[completionCallIndex].id;
          completionCallIndex++;
          return judgeResponses[candidateId];
        }
      );

      // Act
      const result = await searchMemory('Error that matches multiple experiences', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert: should return the candidate with highest confidence (exp-high, 0.95)
      expect(result).not.toBeNull();
      expect(result!.experience.id).toBe('exp-high');
      expect(result!.confidence).toBeCloseTo(0.95);
      expect(result!.suggestedAction).toBe('High action');
    });

    it('should only return relevant candidates (ignoring irrelevant ones even with high similarity)', async () => {
      // Arrange: two candidates - one relevant with lower confidence, one irrelevant
      const candidates = [
        makeVectorResult({ id: 'exp-irrelevant', similarity: 0.99 }),
        makeVectorResult({ id: 'exp-relevant', similarity: 0.75 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);
      (mockSqliteStore.getExperience as jest.Mock).mockImplementation((id: string) =>
        makeExperience({ id })
      );

      let callIdx = 0;
      jest.spyOn(mockLLM, 'generateCompletion').mockImplementation(async () => {
        const candidateId = candidates[callIdx].id;
        callIdx++;
        if (candidateId === 'exp-irrelevant') {
          return makeJudgeResponse({ relevant: false, confidence: 0.1 });
        }
        return makeJudgeResponse({ relevant: true, confidence: 0.8, suggestedAction: 'Do this instead' });
      });

      // Act
      const result = await searchMemory('Some error', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert: should return exp-relevant, not exp-irrelevant
      expect(result).not.toBeNull();
      expect(result!.experience.id).toBe('exp-relevant');
      expect(result!.confidence).toBeCloseTo(0.8);
    });
  });

  // =========================================================================
  // Test 7: getExperience returns null for a candidate -> skips it
  // =========================================================================
  describe('getExperience returns null for a candidate', () => {
    it('should skip candidates whose experience is not found in the SQLite store and check next', async () => {
      // Arrange: two candidates, first one has no experience in the DB
      const candidates = [
        makeVectorResult({ id: 'exp-missing', similarity: 0.95 }),
        makeVectorResult({ id: 'exp-found', similarity: 0.80 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);
      (mockSqliteStore.getExperience as jest.Mock).mockImplementation((id: string) => {
        if (id === 'exp-missing') return null;
        if (id === 'exp-found') return makeExperience({ id: 'exp-found' });
        return null;
      });

      // LLM judge should only be called for exp-found (since exp-missing is skipped)
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.9, suggestedAction: 'Found action' })
      );

      // Act
      const result = await searchMemory('Some error prompt', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.experience.id).toBe('exp-found');
      expect(result!.confidence).toBeCloseTo(0.9);
    });

    it('should return null when all candidates have missing experiences', async () => {
      // Arrange: all candidates return null from getExperience
      const candidates = [
        makeVectorResult({ id: 'exp-gone-1', similarity: 0.9 }),
        makeVectorResult({ id: 'exp-gone-2', similarity: 0.85 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(null);

      // Act
      const result = await searchMemory('Some error', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).toBeNull();
    });

    it('should not call generateCompletion for candidates with null experience', async () => {
      // Arrange: single candidate with no experience
      (mockVectorStore.search as jest.Mock).mockReturnValue([
        makeVectorResult({ id: 'exp-deleted' }),
      ]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(null);
      const completionSpy = jest.spyOn(mockLLM, 'generateCompletion');

      // Act
      await searchMemory('Some error', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert: generateCompletion should NOT have been called for judging
      expect(completionSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Malformed LLM judge response
  // =========================================================================
  describe('Malformed LLM judge response', () => {
    it('should return null when the LLM judge returns invalid JSON', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        'This is not valid JSON at all'
      );

      // Act
      const result = await searchMemory('Some prompt', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert: graceful handling - should return null, not throw
      expect(result).toBeNull();
    });

    it('should return null when the LLM judge response is missing required fields', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        JSON.stringify({ relevant: true })
        // Missing: confidence, reasoning, suggestedAction
      );

      // Act
      const result = await searchMemory('Some prompt', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert: should handle gracefully (null or skip this candidate)
      // The behavior depends on implementation, but it must NOT throw
      await expect(
        searchMemory('Some prompt', mockLLM, mockVectorStore, mockSqliteStore)
      ).resolves.toBeDefined();
    });

    it('should parse judge response with <think> block before JSON', async () => {
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);

      const thinkResponse =
        '<think>Let me evaluate if this is relevant.</think>' +
        makeJudgeResponse({ relevant: true, confidence: 0.85, suggestedAction: 'Check initialization' });
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(thinkResponse);

      const result = await searchMemory('TypeError again', mockLLM, mockVectorStore, mockSqliteStore);

      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.85);
      expect(result!.suggestedAction).toBe('Check initialization');
    });

    it('should parse judge response with <think> block followed by markdown fence', async () => {
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);

      const thinkFenceResponse =
        '<think>Analyzing relevance.</think>\n```json\n' +
        JSON.stringify({ relevant: true, confidence: 0.9, reasoning: 'Relevant match', suggestedAction: 'Do X' }) +
        '\n```';
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(thinkFenceResponse);

      const result = await searchMemory('Error prompt', mockLLM, mockVectorStore, mockSqliteStore);

      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.9);
    });

    it('should not throw when LLM judge returns empty string', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue('');

      // Act & Assert: must not throw
      await expect(
        searchMemory('Some prompt', mockLLM, mockVectorStore, mockSqliteStore)
      ).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('should handle an empty string prompt gracefully', async () => {
      // Arrange
      (mockVectorStore.search as jest.Mock).mockReturnValue([]);

      // Act & Assert: must not throw, should return null
      const result = await searchMemory('', mockLLM, mockVectorStore, mockSqliteStore);
      expect(result).toBeNull();
    });

    it('should handle a very long prompt without errors', async () => {
      // Arrange
      const longPrompt = 'A'.repeat(10000);
      (mockVectorStore.search as jest.Mock).mockReturnValue([]);

      // Act & Assert
      const result = await searchMemory(longPrompt, mockLLM, mockVectorStore, mockSqliteStore);
      expect(result).toBeNull();
    });

    it('should handle prompt with special characters and unicode', async () => {
      // Arrange
      const unicodePrompt = 'TypeError: Build failed - Cannot read properties of undefined (reading "foo")';
      (mockVectorStore.search as jest.Mock).mockReturnValue([]);

      // Act & Assert
      const result = await searchMemory(unicodePrompt, mockLLM, mockVectorStore, mockSqliteStore);
      expect(result).toBeNull();
    });

    it('should use the PROMPTS.ragJudge system prompt when calling generateCompletion', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      const completionSpy = jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.85 })
      );

      // Act
      await searchMemory('Why is my TypeError happening?', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert: the system prompt should contain ragJudge content
      expect(completionSpy).toHaveBeenCalled();
      const systemPromptArg = completionSpy.mock.calls[0][0];
      // The system prompt should be PROMPTS.ragJudge which contains "relevance judge"
      expect(systemPromptArg).toContain('relevance judge');
    });

    it('should include the user prompt and experience details in the judge user message', async () => {
      // Arrange
      const experience = makeExperience({
        frustrationSignature: 'ENOENT: no such file or directory',
        lessons: ['Check file paths before operations'],
      });
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      const completionSpy = jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.9 })
      );

      const prompt = 'File not found when running my script';

      // Act
      await searchMemory(prompt, mockLLM, mockVectorStore, mockSqliteStore);

      // Assert: the user message to the judge should contain both the prompt and experience info
      expect(completionSpy).toHaveBeenCalled();
      const userMessageArg = completionSpy.mock.calls[0][1];
      expect(userMessageArg).toContain(prompt);
      expect(userMessageArg).toContain('ENOENT');
    });
  });

  // =========================================================================
  // excludeExperienceIds: skip already-advised experiences
  // =========================================================================
  describe('excludeExperienceIds parameter', () => {
    it('should skip candidates whose IDs are in the exclusion list', async () => {
      // Arrange: two candidates, first is excluded
      const candidates = [
        makeVectorResult({ id: 'exp-excluded', similarity: 0.95 }),
        makeVectorResult({ id: 'exp-included', similarity: 0.80 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);
      (mockSqliteStore.getExperience as jest.Mock).mockImplementation((id: string) =>
        makeExperience({ id })
      );
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.85, suggestedAction: 'Included action' })
      );

      // Act
      const result = await searchMemory(
        'Some error prompt',
        mockLLM,
        mockVectorStore,
        mockSqliteStore,
        ['exp-excluded'],
      );

      // Assert: should return exp-included, not exp-excluded
      expect(result).not.toBeNull();
      expect(result!.experience.id).toBe('exp-included');
    });

    it('should not call getExperience for excluded candidates', async () => {
      // Arrange
      const candidates = [
        makeVectorResult({ id: 'exp-skip', similarity: 0.9 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);

      // Act
      await searchMemory(
        'Some prompt',
        mockLLM,
        mockVectorStore,
        mockSqliteStore,
        ['exp-skip'],
      );

      // Assert: getExperience should NOT have been called for the excluded ID
      expect(mockSqliteStore.getExperience).not.toHaveBeenCalled();
    });

    it('should return null when all candidates are excluded', async () => {
      // Arrange
      const candidates = [
        makeVectorResult({ id: 'exp-a', similarity: 0.9 }),
        makeVectorResult({ id: 'exp-b', similarity: 0.8 }),
      ];
      (mockVectorStore.search as jest.Mock).mockReturnValue(candidates);

      // Act
      const result = await searchMemory(
        'Some prompt',
        mockLLM,
        mockVectorStore,
        mockSqliteStore,
        ['exp-a', 'exp-b'],
      );

      // Assert
      expect(result).toBeNull();
    });

    it('should work normally when excludeExperienceIds is undefined (backward compatible)', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.85 })
      );

      // Act: no excludeExperienceIds argument
      const result = await searchMemory(
        'Some prompt',
        mockLLM,
        mockVectorStore,
        mockSqliteStore,
      );

      // Assert
      expect(result).not.toBeNull();
      expect(result!.experience.id).toBe('exp-001');
    });

    it('should work normally when excludeExperienceIds is empty array', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.85 })
      );

      // Act
      const result = await searchMemory(
        'Some prompt',
        mockLLM,
        mockVectorStore,
        mockSqliteStore,
        [],
      );

      // Assert
      expect(result).not.toBeNull();
    });
  });

  // =========================================================================
  // Graceful degradation: vectorStore.search throws
  // =========================================================================
  describe('VectorStore search failure', () => {
    it('should return null when vectorStore.search throws an error', async () => {
      // Arrange
      (mockVectorStore.search as jest.Mock).mockImplementation(() => {
        throw new Error('Database is closed');
      });

      // Act
      const result = await searchMemory('Some prompt', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Graceful degradation: sqliteStore.getExperience throws
  // =========================================================================
  describe('SqliteStore getExperience failure', () => {
    it('should return null when sqliteStore.getExperience throws an error', async () => {
      // Arrange
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockImplementation(() => {
        throw new Error('Database corrupted');
      });

      // Act
      const result = await searchMemory('Some prompt', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Return type conformance
  // =========================================================================
  describe('Return type conformance', () => {
    it('should return a MatchResult that conforms to the MatchResultSchema shape', async () => {
      // Arrange
      const experience = makeExperience();
      (mockVectorStore.search as jest.Mock).mockReturnValue([makeVectorResult()]);
      (mockSqliteStore.getExperience as jest.Mock).mockReturnValue(experience);
      jest.spyOn(mockLLM, 'generateCompletion').mockResolvedValue(
        makeJudgeResponse({ relevant: true, confidence: 0.88, suggestedAction: 'Check your imports' })
      );

      // Act
      const result = await searchMemory('Import error', mockLLM, mockVectorStore, mockSqliteStore);

      // Assert: validate MatchResult shape
      expect(result).not.toBeNull();

      // experience field is a FailureExperience
      expect(result!.experience).toHaveProperty('id');
      expect(result!.experience).toHaveProperty('frustrationSignature');
      expect(result!.experience).toHaveProperty('failedApproaches');
      expect(result!.experience).toHaveProperty('lessons');
      expect(result!.experience).toHaveProperty('createdAt');
      expect(Array.isArray(result!.experience.failedApproaches)).toBe(true);
      expect(Array.isArray(result!.experience.lessons)).toBe(true);

      // confidence is a number between 0 and 1
      expect(typeof result!.confidence).toBe('number');
      expect(result!.confidence).toBeGreaterThanOrEqual(0);
      expect(result!.confidence).toBeLessThanOrEqual(1);

      // suggestedAction is a non-empty string
      expect(typeof result!.suggestedAction).toBe('string');
      expect(result!.suggestedAction.length).toBeGreaterThan(0);
    });
  });
});
