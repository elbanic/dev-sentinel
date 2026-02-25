/**
 * Unit Tests for Pattern Analyzer
 *
 * Tests the three exported functions:
 *   - buildAnalysisInput(experiences, trendData)
 *   - analyzePatterns(llmProvider, sqliteStore)
 *   - getOrTranslatePattern(analysisId, language, llmProvider, sqliteStore)
 */

import {
  createTestDeps,
  cleanupDeps,
  type TestDeps,
} from '../helpers/cli-test-helpers';
import type { EffectivenessStats, FailureExperience } from '../../src/types/index';
import {
  buildAnalysisInput,
  analyzePatterns,
  getOrTranslatePattern,
} from '../../src/dashboard/pattern-analyzer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExperience(overrides: Partial<FailureExperience> = {}): FailureExperience {
  return {
    id: 'exp-001',
    frustrationSignature: 'Jest mock leaking between tests',
    failedApproaches: ['Cleared Jest cache', 'Restarted test runner'],
    successfulApproach: 'Used jest.isolateModules()',
    lessons: ['Check for singleton modules when mocks leak'],
    createdAt: '2026-02-20T12:00:00Z',
    revision: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pattern Analyzer', () => {
  let deps: TestDeps;

  beforeEach(() => {
    deps = createTestDeps();
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupDeps(deps);
  });

  // =========================================================================
  // buildAnalysisInput
  // =========================================================================

  describe('buildAnalysisInput', () => {
    it('should include experience frustration signatures', () => {
      const experiences = [makeExperience({ id: 'e1' }), makeExperience({ id: 'e2', frustrationSignature: 'Docker cache issue' })];
      const trend = [{ date: '2026-02-20', count: 3 }];

      const input = buildAnalysisInput(experiences, trend);

      expect(input).toContain('Jest mock leaking between tests');
      expect(input).toContain('Docker cache issue');
    });

    it('should include trend data', () => {
      const experiences = [makeExperience()];
      const trend = [{ date: '2026-02-20', count: 5 }];

      const input = buildAnalysisInput(experiences, trend);

      expect(input).toContain('2026-02-20');
      expect(input).toContain('5');
    });

    it('should handle empty experiences', () => {
      const input = buildAnalysisInput([], []);
      expect(typeof input).toBe('string');
    });

    it('should include effectiveness data when effectivenessMap is provided', () => {
      const experiences = [makeExperience({ id: 'e1' })];
      const trend = [{ date: '2026-02-20', count: 3 }];
      const effectivenessMap = new Map<string, EffectivenessStats>([
        ['e1', { experienceId: 'e1', effective: 3, ineffective: 1, unknown: 1, effectivenessRate: 0.75 }],
      ]);

      const input = buildAnalysisInput(experiences, trend, effectivenessMap);

      expect(input).toContain('Advice Effectiveness');
      expect(input).toContain('3 effective');
      expect(input).toContain('1 ineffective');
      expect(input).toContain('75%');
    });

    it('should not include effectiveness line when effectivenessMap is not provided', () => {
      const experiences = [makeExperience({ id: 'e1' })];
      const trend: Array<{ date: string; count: number }> = [];

      const input = buildAnalysisInput(experiences, trend);

      expect(input).not.toContain('Advice Effectiveness');
    });
  });

  // =========================================================================
  // analyzePatterns
  // =========================================================================

  describe('analyzePatterns', () => {
    it('should throw when no experiences exist', async () => {
      await expect(
        analyzePatterns(deps.llmProvider, deps.sqliteStore),
      ).rejects.toThrow();
    });

    it('should call LLM and return analysis result when experiences exist', async () => {
      // Store experiences
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e1' }));
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e2', frustrationSignature: 'Docker issue' }));

      // Mock LLM to return valid PatternAnalysisResult JSON
      const mockResult = {
        insight: 'You struggle with testing infrastructure.',
        weakAreas: [{ category: 'Testing', count: 2, description: 'Mock-related issues' }],
        resolutionRate: 80,
      };
      deps.llmProvider.generateCompletion = jest.fn().mockResolvedValue(JSON.stringify(mockResult));

      const result = await analyzePatterns(deps.llmProvider, deps.sqliteStore);

      expect(result.id).toBeDefined();
      expect(result.analysis).toEqual(mockResult);
      expect(result.experienceCount).toBe(2);
      expect(result.createdAt).toBeDefined();
    });

    it('should store analysis in DB', async () => {
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e1' }));

      const mockResult = {
        insight: 'Test insight',
        weakAreas: [],
        resolutionRate: 100,
      };
      deps.llmProvider.generateCompletion = jest.fn().mockResolvedValue(JSON.stringify(mockResult));

      const result = await analyzePatterns(deps.llmProvider, deps.sqliteStore);

      const stored = deps.sqliteStore.getLatestPatternAnalysis();
      expect(stored).not.toBeNull();
      expect(stored!.id).toBe(result.id);
    });

    it('should throw when LLM returns invalid JSON', async () => {
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e1' }));
      deps.llmProvider.generateCompletion = jest.fn().mockResolvedValue('not json');

      await expect(
        analyzePatterns(deps.llmProvider, deps.sqliteStore),
      ).rejects.toThrow();
    });

    it('should throw when LLM returns JSON not matching schema', async () => {
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e1' }));
      deps.llmProvider.generateCompletion = jest.fn().mockResolvedValue(
        JSON.stringify({ insight: 'ok', weakAreas: 'not an array' }),
      );

      await expect(
        analyzePatterns(deps.llmProvider, deps.sqliteStore),
      ).rejects.toThrow();
    });

    it('should strip think blocks from LLM output', async () => {
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e1' }));

      const mockResult = {
        insight: 'Insight after thinking',
        weakAreas: [],
        resolutionRate: 50,
      };
      deps.llmProvider.generateCompletion = jest.fn().mockResolvedValue(
        '<think>some reasoning</think>' + JSON.stringify(mockResult),
      );

      const result = await analyzePatterns(deps.llmProvider, deps.sqliteStore);
      expect(result.analysis.insight).toBe('Insight after thinking');
    });
  });

  // =========================================================================
  // getOrTranslatePattern
  // =========================================================================

  describe('getOrTranslatePattern', () => {
    it('should return cached translation if available', async () => {
      const analysis = {
        insight: 'Original',
        weakAreas: [],
        resolutionRate: 50,
      };
      deps.sqliteStore.storePatternAnalysis('pa-1', JSON.stringify(analysis), 1);
      deps.sqliteStore.storePatternTranslation('pa-1', 'ko', JSON.stringify({
        insight: 'Cached Korean',
        weakAreas: [],
        resolutionRate: 50,
      }));

      const result = await getOrTranslatePattern('pa-1', 'ko', deps.llmProvider, deps.sqliteStore);

      expect(result.insight).toBe('Cached Korean');
      // LLM should NOT have been called
      expect(deps.llmProvider.calls.filter(c => c.method === 'generateCompletion')).toHaveLength(0);
    });

    it('should call LLM for translation when not cached', async () => {
      const analysis = {
        insight: 'English insight',
        weakAreas: [{ category: 'Testing', count: 2, description: 'Mock issues' }],
        resolutionRate: 75,
      };
      deps.sqliteStore.storePatternAnalysis('pa-2', JSON.stringify(analysis), 1);

      const translatedResult = {
        insight: 'Korean insight',
        weakAreas: [{ category: 'Testing', count: 2, description: 'Mock problems in Korean' }],
        resolutionRate: 75,
      };
      deps.llmProvider.generateCompletion = jest.fn().mockResolvedValue(JSON.stringify(translatedResult));

      const result = await getOrTranslatePattern('pa-2', 'ko', deps.llmProvider, deps.sqliteStore);

      expect(result.insight).toBe('Korean insight');
    });

    it('should cache translation after LLM call', async () => {
      const analysis = {
        insight: 'English',
        weakAreas: [],
        resolutionRate: 50,
      };
      deps.sqliteStore.storePatternAnalysis('pa-3', JSON.stringify(analysis), 1);

      const translated = {
        insight: 'Japanese',
        weakAreas: [],
        resolutionRate: 50,
      };
      deps.llmProvider.generateCompletion = jest.fn().mockResolvedValue(JSON.stringify(translated));

      await getOrTranslatePattern('pa-3', 'ja', deps.llmProvider, deps.sqliteStore);

      const cached = deps.sqliteStore.getPatternTranslation('pa-3', 'ja');
      expect(cached).not.toBeNull();
    });

    it('should throw when analysis_id does not exist and LLM returns invalid data', async () => {
      deps.llmProvider.generateCompletion = jest.fn().mockResolvedValue('not json');

      // Non-existent analysis but since there is no base analysis data,
      // we expect it to throw or handle gracefully
      await expect(
        getOrTranslatePattern('non-existent', 'ko', deps.llmProvider, deps.sqliteStore),
      ).rejects.toThrow();
    });
  });
});
