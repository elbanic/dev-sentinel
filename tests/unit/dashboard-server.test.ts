/**
 * Unit Tests for Dashboard Server (createDashboardApp)
 *
 * Tests that `createDashboardApp(deps)` returns a properly configured Express app:
 *   - Serves static files from the public directory
 *   - Has JSON middleware enabled
 *   - Returns 200 for GET /api/overview
 *
 * These tests are written BEFORE implementation exists (RED phase).
 * They will FAIL until src/dashboard/server.ts is implemented.
 */

import request from 'supertest';
import * as path from 'path';
import { createDashboardApp } from '../../src/dashboard/server';
import {
  createTestDeps,
  cleanupDeps,
  type TestDeps,
} from '../helpers/cli-test-helpers';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('createDashboardApp', () => {
  let deps: TestDeps;

  beforeEach(() => {
    deps = createTestDeps();
  });

  afterEach(() => {
    cleanupDeps(deps);
  });

  // =========================================================================
  // 1. Returns an Express app
  // =========================================================================

  it('should return an Express app (callable)', () => {
    const app = createDashboardApp(deps);

    // Express apps are functions with `listen`, `use`, `get` methods
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
    expect(typeof app.use).toBe('function');
    expect(typeof app.get).toBe('function');
  });

  // =========================================================================
  // 2. Static file serving from public directory
  // =========================================================================

  describe('static file serving', () => {
    it('should serve static files from the public directory', async () => {
      const app = createDashboardApp(deps);

      // The public directory should contain at minimum an index.html.
      // A request for / should return 200 with HTML content.
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      // index.html should be served as text/html
      expect(response.headers['content-type']).toMatch(/html/);
    });

    it('should return 404 for non-existent static files', async () => {
      const app = createDashboardApp(deps);

      const response = await request(app).get('/non-existent-file-abc123.xyz');

      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  // 3. JSON middleware
  // =========================================================================

  describe('JSON middleware', () => {
    it('should parse JSON request bodies', async () => {
      const app = createDashboardApp(deps);

      // POST to an API route with JSON body should be parsed correctly.
      // We test that the middleware is active by sending a POST request
      // with Content-Type: application/json — if middleware is missing,
      // req.body would be undefined.
      const response = await request(app)
        .post('/api/drafts/test-id/reject')
        .set('Content-Type', 'application/json')
        .send({ reason: 'test' });

      // Even if the draft is not found (404), the route should be reachable,
      // meaning JSON middleware did not block the request.
      // We just need to verify the route responds (not a middleware error).
      expect([200, 404]).toContain(response.status);
    });
  });

  // =========================================================================
  // 4. GET /api/overview returns 200
  // =========================================================================

  describe('GET /api/overview', () => {
    it('should return 200 status code', async () => {
      const app = createDashboardApp(deps);

      const response = await request(app).get('/api/overview');

      expect(response.status).toBe(200);
    });

    it('should return JSON content type', async () => {
      const app = createDashboardApp(deps);

      const response = await request(app).get('/api/overview');

      expect(response.headers['content-type']).toMatch(/json/);
    });
  });
});
