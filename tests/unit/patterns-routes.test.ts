/**
 * Unit Tests for Patterns API Routes
 *
 * Tests the 4 new endpoints:
 *   GET  /api/patterns           - Cached analysis + meta
 *   POST /api/patterns/analyze   - Run new analysis
 *   GET  /api/patterns/translate/:lang - Get/create translation
 *   GET  /api/patterns/trend     - Frustration trend data
 */

import express from 'express';
import request from 'supertest';
import { registerRoutes } from '../../src/dashboard/routes';
import {
  createTestDeps,
  cleanupDeps,
  type TestDeps,
} from '../helpers/cli-test-helpers';
import type { FailureExperience } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Mock pattern-analyzer module
// ---------------------------------------------------------------------------

jest.mock('../../src/dashboard/pattern-analyzer', () => ({
  analyzePatterns: jest.fn(),
  getOrTranslatePattern: jest.fn(),
}));

jest.mock('../../src/cli/confirm-experience', () => ({
  confirmSingleDraft: jest.fn(),
}));

import { analyzePatterns, getOrTranslatePattern } from '../../src/dashboard/pattern-analyzer';
const mockAnalyzePatterns = analyzePatterns as jest.MockedFunction<typeof analyzePatterns>;
const mockGetOrTranslatePattern = getOrTranslatePattern as jest.MockedFunction<typeof getOrTranslatePattern>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAppWithRoutes(deps: TestDeps): express.Express {
  const app = express();
  app.use(express.json());
  registerRoutes(app, deps);
  return app;
}

function makeExperience(overrides: Partial<FailureExperience> = {}): FailureExperience {
  return {
    id: 'exp-001',
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried clearing cache'],
    successfulApproach: 'Updated dependency version',
    lessons: ['Always check compatibility'],
    createdAt: '2026-02-20T12:00:00Z',
    revision: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Patterns API Routes', () => {
  let deps: TestDeps;

  beforeEach(() => {
    deps = createTestDeps();
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupDeps(deps);
  });

  // =========================================================================
  // GET /api/patterns
  // =========================================================================

  describe('GET /api/patterns', () => {
    it('should return null analysis when none exists', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/patterns');

      expect(response.status).toBe(200);
      expect(response.body.analysis).toBeNull();
      expect(response.body.currentExperienceCount).toBe(0);
    });

    it('should return cached analysis with meta when one exists', async () => {
      const app = createAppWithRoutes(deps);

      const analysisResult = {
        insight: 'Test insight',
        weakAreas: [],
        resolutionRate: 50,
      };
      deps.sqliteStore.storePatternAnalysis('pa-1', JSON.stringify(analysisResult), 3);

      // Add more experiences since the analysis
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e1' }));
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e2' }));
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e3' }));
      deps.sqliteStore.storeExperience(makeExperience({ id: 'e4' }));

      const response = await request(app).get('/api/patterns');

      expect(response.status).toBe(200);
      expect(response.body.analysis).not.toBeNull();
      expect(response.body.analysis.id).toBe('pa-1');
      expect(response.body.analysis.result).toEqual(analysisResult);
      expect(response.body.currentExperienceCount).toBe(4);
      expect(response.body.newSinceAnalysis).toBe(1); // 4 current - 3 at analysis time
    });
  });

  // =========================================================================
  // POST /api/patterns/analyze
  // =========================================================================

  describe('POST /api/patterns/analyze', () => {
    it('should call analyzePatterns and return result', async () => {
      const app = createAppWithRoutes(deps);

      const mockResult = {
        id: 'pa-new',
        analysis: {
          insight: 'New insight',
          weakAreas: [],
          resolutionRate: 80,
          },
        experienceCount: 5,
        createdAt: '2026-02-24T12:00:00Z',
      };
      mockAnalyzePatterns.mockResolvedValue(mockResult);

      const response = await request(app).post('/api/patterns/analyze');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('pa-new');
      expect(response.body.analysis).toEqual(mockResult.analysis);
      expect(mockAnalyzePatterns).toHaveBeenCalledTimes(1);
    });

    it('should return 500 when analyzePatterns throws', async () => {
      const app = createAppWithRoutes(deps);

      mockAnalyzePatterns.mockRejectedValue(new Error('No experiences found'));

      const response = await request(app).post('/api/patterns/analyze');

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // GET /api/patterns/translate/:lang
  // =========================================================================

  describe('GET /api/patterns/translate/:lang', () => {
    it('should return translation for valid language', async () => {
      const app = createAppWithRoutes(deps);

      // Need a cached analysis first
      deps.sqliteStore.storePatternAnalysis('pa-1', '{}', 1);

      const translated = {
        insight: 'Korean insight',
        weakAreas: [],
        resolutionRate: 50,
      };
      mockGetOrTranslatePattern.mockResolvedValue(translated);

      const response = await request(app).get('/api/patterns/translate/ko');

      expect(response.status).toBe(200);
      expect(response.body.insight).toBe('Korean insight');
      expect(mockGetOrTranslatePattern).toHaveBeenCalledWith('pa-1', 'ko', expect.anything(), deps.sqliteStore);
    });

    it('should return 400 for invalid language code', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/patterns/translate/invalid');

      expect(response.status).toBe(400);
    });

    it('should accept ko, ja, zh, es as valid languages', async () => {
      const app = createAppWithRoutes(deps);
      deps.sqliteStore.storePatternAnalysis('pa-1', '{}', 1);

      const mockTranslation = {
        insight: 'translated',
        weakAreas: [],
        resolutionRate: 50,
      };
      mockGetOrTranslatePattern.mockResolvedValue(mockTranslation);

      for (const lang of ['ko', 'ja', 'zh', 'es']) {
        const response = await request(app).get('/api/patterns/translate/' + lang);
        expect(response.status).toBe(200);
      }
    });

    it('should return 404 when no analysis exists', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/patterns/translate/ko');

      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  // GET /api/patterns/trend
  // =========================================================================

  describe('GET /api/patterns/trend', () => {
    it('should return trend data', async () => {
      const app = createAppWithRoutes(deps);

      // Store some frustrated turns
      deps.sqliteStore.storeTurn('s1', 'help', JSON.stringify({ type: 'frustrated' }));
      deps.sqliteStore.storeTurn('s1', 'again', JSON.stringify({ type: 'frustrated' }));

      const response = await request(app).get('/api/patterns/trend');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return empty array when no frustration data exists', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/patterns/trend');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });
});
