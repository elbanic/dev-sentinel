/**
 * Unit Tests for Dashboard API Routes (registerRoutes)
 *
 * Tests ALL REST API endpoints defined in the dashboard:
 *   GET  /api/overview          - Stats overview
 *   GET  /api/experiences       - All experiences
 *   GET  /api/experiences/:id   - Experience detail + revisions
 *   GET  /api/drafts            - Pending drafts
 *   GET  /api/drafts/:id        - Draft detail with transcript
 *   POST /api/drafts/:id/reject - Reject draft
 *   POST /api/drafts/:id/confirm - Confirm draft
 *
 * Uses supertest against an Express app with registerRoutes applied.
 * Uses createTestDeps() from cli-test-helpers for in-memory stores.
 *
 * These tests are written BEFORE implementation exists (RED phase).
 * They will FAIL until src/dashboard/routes.ts is implemented.
 */

import express from 'express';
import request from 'supertest';
import { registerRoutes } from '../../src/dashboard/routes';
import {
  createTestDeps,
  cleanupDeps,
  makeCandidate,
  type TestDeps,
} from '../helpers/cli-test-helpers';
import type {
  FailureExperience,
  ExperienceRevision,
  AutoMemoryCandidate,
} from '../../src/types/index';

// ---------------------------------------------------------------------------
// Mock confirmSingleDraft to avoid actual LLM calls during tests.
// NOTE: jest.mock() is hoisted, so this runs before any imports.
// ---------------------------------------------------------------------------

jest.mock('../../src/cli/confirm-experience', () => ({
  ...jest.requireActual('../../src/cli/confirm-experience'),
  confirmSingleDraft: jest.fn(),
}));

import { confirmSingleDraft } from '../../src/cli/confirm-experience';
const mockConfirmSingleDraft = confirmSingleDraft as jest.MockedFunction<typeof confirmSingleDraft>;

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
    failedApproaches: ['Tried clearing cache', 'Tried reinstalling'],
    successfulApproach: 'Updated dependency version',
    lessons: ['Always check dependency compatibility'],
    createdAt: '2026-02-20T12:00:00Z',
    revision: 1,
    ...overrides,
  };
}

function makeRevision(overrides: Partial<ExperienceRevision> = {}): ExperienceRevision {
  return {
    id: 'rev-001',
    experienceId: 'exp-001',
    revision: 1,
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried clearing cache'],
    successfulApproach: 'Tried reinstalling',
    lessons: ['Check cache first'],
    createdAt: '2026-02-18T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Dashboard API Routes', () => {
  let deps: TestDeps;

  beforeEach(() => {
    deps = createTestDeps();
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupDeps(deps);
  });

  // =========================================================================
  // GET /api/overview
  // =========================================================================

  describe('GET /api/overview', () => {
    it('should return overview stats with correct shape', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/overview');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('experienceCount');
      expect(response.body).toHaveProperty('evolvedCount');
      expect(response.body).toHaveProperty('pendingDraftCount');
      expect(response.body).toHaveProperty('systemErrors');
    });

    it('should return zeros when database is empty', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/overview');

      expect(response.status).toBe(200);
      expect(response.body.experienceCount).toBe(0);
      expect(response.body.evolvedCount).toBe(0);
      expect(response.body.pendingDraftCount).toBe(0);
    });

    it('should count experiences from getAllExperiences().length', async () => {
      const app = createAppWithRoutes(deps);

      // Store 3 experiences
      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-001' }));
      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-002' }));
      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-003' }));

      const response = await request(app).get('/api/overview');

      expect(response.body.experienceCount).toBe(3);
    });

    it('should count evolved experiences where revision > 1', async () => {
      const app = createAppWithRoutes(deps);

      // Store experiences: 2 evolved (revision > 1), 1 not evolved
      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-001', revision: 1 }));
      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-002', revision: 2 }));
      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-003', revision: 3 }));

      const response = await request(app).get('/api/overview');

      expect(response.body.evolvedCount).toBe(2);
    });

    it('should count pending drafts from getPendingDrafts().length', async () => {
      const app = createAppWithRoutes(deps);

      // Store 2 pending drafts
      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-001' }));
      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-002' }));

      const response = await request(app).get('/api/overview');

      expect(response.body.pendingDraftCount).toBe(2);
    });

    it('should include system errors from getPersistentErrors()', async () => {
      const app = createAppWithRoutes(deps);

      // getPersistentErrors returns errors that meet a threshold (default 3 in 1 hour).
      // With no errors recorded, it should return an empty array.
      const response = await request(app).get('/api/overview');

      expect(Array.isArray(response.body.systemErrors)).toBe(true);
    });
  });

  // =========================================================================
  // GET /api/experiences
  // =========================================================================

  describe('GET /api/experiences', () => {
    it('should return empty array when no experiences exist', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/experiences');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return all experiences as JSON array', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-001' }));
      deps.sqliteStore.storeExperience(makeExperience({
        id: 'exp-002',
        frustrationSignature: 'Docker build cache issue',
      }));

      const response = await request(app).get('/api/experiences');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });

    it('should include all expected fields for each experience', async () => {
      const app = createAppWithRoutes(deps);

      const exp = makeExperience({ id: 'exp-100' });
      deps.sqliteStore.storeExperience(exp);

      const response = await request(app).get('/api/experiences');

      expect(response.body).toHaveLength(1);
      const returned = response.body[0];
      expect(returned.id).toBe('exp-100');
      expect(returned.frustrationSignature).toBe(exp.frustrationSignature);
      expect(returned.failedApproaches).toEqual(exp.failedApproaches);
      expect(returned.successfulApproach).toBe(exp.successfulApproach);
      expect(returned.lessons).toEqual(exp.lessons);
      expect(returned.revision).toBe(1);
    });
  });

  // =========================================================================
  // GET /api/experiences/:id
  // =========================================================================

  describe('GET /api/experiences/:id', () => {
    it('should return experience detail with revisions when found', async () => {
      const app = createAppWithRoutes(deps);

      // Store experience and a revision
      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-001', revision: 2 }));
      deps.sqliteStore.storeRevision(makeRevision({
        id: 'rev-001',
        experienceId: 'exp-001',
        revision: 1,
      }));

      const response = await request(app).get('/api/experiences/exp-001');

      expect(response.status).toBe(200);
      expect(response.body.experience).toBeDefined();
      expect(response.body.experience.id).toBe('exp-001');
      expect(response.body.revisions).toBeDefined();
      expect(Array.isArray(response.body.revisions)).toBe(true);
      expect(response.body.revisions).toHaveLength(1);
      expect(response.body.revisions[0].experienceId).toBe('exp-001');
    });

    it('should return 404 when experience is not found', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/experiences/non-existent-id');

      expect(response.status).toBe(404);
    });

    it('should return empty revisions array when experience has no revisions', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeExperience(makeExperience({ id: 'exp-solo', revision: 1 }));

      const response = await request(app).get('/api/experiences/exp-solo');

      expect(response.status).toBe(200);
      expect(response.body.experience.id).toBe('exp-solo');
      expect(response.body.revisions).toEqual([]);
    });
  });

  // =========================================================================
  // GET /api/drafts
  // =========================================================================

  describe('GET /api/drafts', () => {
    it('should return empty array when no drafts exist', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/drafts');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return pending drafts as JSON array', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-001' }));
      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-002' }));

      const response = await request(app).get('/api/drafts');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });

    it('should include expected fields for each draft', async () => {
      const app = createAppWithRoutes(deps);

      const draft = makeCandidate({ id: 'draft-abc' });
      deps.sqliteStore.storeCandidate(draft);

      const response = await request(app).get('/api/drafts');

      expect(response.body).toHaveLength(1);
      const returned = response.body[0];
      expect(returned.id).toBe('draft-abc');
      expect(returned.frustrationSignature).toBe(draft.frustrationSignature);
      expect(returned.status).toBe('pending');
    });
  });

  // =========================================================================
  // GET /api/drafts/:id
  // =========================================================================

  describe('GET /api/drafts/:id', () => {
    it('should return a single draft when found', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeCandidate(makeCandidate({
        id: 'draft-findme',
        transcriptData: JSON.stringify({ messages: [], toolCalls: [], errors: [] }),
      }));

      const response = await request(app).get('/api/drafts/draft-findme');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('draft-findme');
    });

    it('should include transcriptData in the response', async () => {
      const app = createAppWithRoutes(deps);

      const transcriptJson = JSON.stringify({
        messages: [{ role: 'user', content: 'help me' }],
        toolCalls: [],
        errors: [],
      });
      deps.sqliteStore.storeCandidate(makeCandidate({
        id: 'draft-with-transcript',
        transcriptData: transcriptJson,
      }));

      const response = await request(app).get('/api/drafts/draft-with-transcript');

      expect(response.status).toBe(200);
      expect(response.body.transcriptData).toBeDefined();
    });

    it('should return 404 when draft is not found', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).get('/api/drafts/non-existent-draft');

      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  // POST /api/drafts/:id/reject
  // =========================================================================

  describe('POST /api/drafts/:id/reject', () => {
    it('should delete the draft and return success', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-to-reject' }));

      const response = await request(app).post('/api/drafts/draft-to-reject/reject');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });

      // Verify the draft was actually deleted
      const remaining = deps.sqliteStore.getPendingDrafts();
      const found = remaining.find((d) => d.id === 'draft-to-reject');
      expect(found).toBeUndefined();
    });

    it('should return 404 when draft is not found', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).post('/api/drafts/non-existent/reject');

      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  // POST /api/drafts/:id/confirm
  // =========================================================================

  describe('POST /api/drafts/:id/confirm', () => {
    it('should call confirmSingleDraft and return status', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-to-confirm' }));

      // Mock confirmSingleDraft to return 'stored' without actual LLM work
      mockConfirmSingleDraft.mockResolvedValue('stored');

      const response = await request(app).post('/api/drafts/draft-to-confirm/confirm');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('stored');
      expect(mockConfirmSingleDraft).toHaveBeenCalledTimes(1);
    });

    it('should return 404 when draft is not found', async () => {
      const app = createAppWithRoutes(deps);

      const response = await request(app).post('/api/drafts/non-existent/confirm');

      expect(response.status).toBe(404);
      expect(mockConfirmSingleDraft).not.toHaveBeenCalled();
    });

    it('should pass the correct draft to confirmSingleDraft', async () => {
      const app = createAppWithRoutes(deps);

      const draft = makeCandidate({ id: 'draft-verify-args' });
      deps.sqliteStore.storeCandidate(draft);

      mockConfirmSingleDraft.mockResolvedValue('stored');

      await request(app).post('/api/drafts/draft-verify-args/confirm');

      expect(mockConfirmSingleDraft).toHaveBeenCalledTimes(1);
      // First argument should be the draft object
      const calledWithDraft = mockConfirmSingleDraft.mock.calls[0][0];
      expect(calledWithDraft.id).toBe('draft-verify-args');
    });

    it('should handle evolved status from confirmSingleDraft', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-evolve' }));
      mockConfirmSingleDraft.mockResolvedValue('evolved');

      const response = await request(app).post('/api/drafts/draft-evolve/confirm');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('evolved');
    });

    it('should handle duplicate status from confirmSingleDraft', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-dup' }));
      mockConfirmSingleDraft.mockResolvedValue('duplicate');

      const response = await request(app).post('/api/drafts/draft-dup/confirm');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('duplicate');
    });

    it('should return 500 when confirmSingleDraft throws', async () => {
      const app = createAppWithRoutes(deps);

      deps.sqliteStore.storeCandidate(makeCandidate({ id: 'draft-error' }));
      mockConfirmSingleDraft.mockRejectedValue(new Error('LLM unavailable'));

      const response = await request(app).post('/api/drafts/draft-error/confirm');

      expect(response.status).toBe(500);
    });
  });
});
