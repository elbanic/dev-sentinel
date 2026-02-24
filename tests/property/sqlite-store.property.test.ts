/**
 * Property-Based Tests for SqliteStore
 *
 * TDD RED phase: These property tests use fast-check to verify that the
 * SqliteStore round-trip operations preserve data integrity across a wide
 * range of randomly generated inputs.
 *
 * The target module (src/storage/sqlite-store.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Properties tested:
 *   1. storeTurn/getTurnsBySession round-trip: data stored equals data retrieved
 *   2. storeCandidate/getPendingDrafts round-trip: pending candidates appear in drafts
 *   3. storeExperience/getExperience round-trip: data stored equals data retrieved
 *   4. setFlag/getFlag round-trip: flag status matches what was set
 *   5. Candidate JSON serialization: array fields survive round-trip unchanged
 *   6. Session isolation: turns for different sessions never leak
 *   7. Flag UPSERT: last setFlag wins
 *   8. clearFlag idempotency: clearing an already-cleared flag is safe
 */

import fc from 'fast-check';
import { SqliteStore } from '../../src/storage/sqlite-store';
import type { AutoMemoryCandidate, FailureExperience } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Shared setup: fresh in-memory DB per property assertion
// ---------------------------------------------------------------------------

/**
 * Creates a fresh SqliteStore backed by an in-memory DB.
 * The caller is responsible for calling close() after use.
 */
function freshStore(): SqliteStore {
  const store = new SqliteStore(':memory:');
  store.initialize();
  return store;
}

// ---------------------------------------------------------------------------
// Arbitraries (fast-check generators)
// ---------------------------------------------------------------------------

/** Non-empty string for IDs and session IDs (empty IDs are not meaningful). */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary string that can include unicode, special chars, etc. */
const anyStringArb = fc.string({ maxLength: 1000 });

/** Arbitrary non-empty array of strings (for failedApproaches and lessons). */
const stringArrayArb = fc.array(fc.string({ maxLength: 200 }), { minLength: 0, maxLength: 10 });

/** Arbitrary for a valid flag status. */
const flagStatusArb = fc.constantFrom('frustrated' as const, 'capture' as const);

/** Arbitrary for AutoMemoryCandidate with status='pending'. */
const pendingCandidateArb = fc.record({
  id: nonEmptyStringArb,
  sessionId: nonEmptyStringArb,
  frustrationSignature: anyStringArb,
  failedApproaches: stringArrayArb,
  successfulApproach: fc.option(anyStringArb, { nil: undefined }),
  lessons: stringArrayArb,
  status: fc.constant('pending' as const),
  createdAt: nonEmptyStringArb,
});

/** Arbitrary for FailureExperience. */
const failureExperienceArb = fc.record({
  id: nonEmptyStringArb,
  frustrationSignature: anyStringArb,
  failedApproaches: stringArrayArb,
  successfulApproach: fc.option(anyStringArb, { nil: undefined }),
  lessons: stringArrayArb,
  createdAt: nonEmptyStringArb,
  revision: fc.integer({ min: 1, max: 100 }),
});

// ---------------------------------------------------------------------------
// Property 1: storeTurn/getTurnsBySession round-trip
// ---------------------------------------------------------------------------
describe('Property 1: storeTurn/getTurnsBySession round-trip', () => {
  it('should preserve sessionId, prompt, and analysis through a store/retrieve cycle', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb, // sessionId
        anyStringArb,      // prompt
        anyStringArb,      // analysis
        (sessionId, prompt, analysis) => {
          const store = freshStore();
          try {
            store.storeTurn(sessionId, prompt, analysis);
            const turns = store.getTurnsBySession(sessionId);

            // Exactly one turn stored
            expect(turns).toHaveLength(1);
            expect(turns[0].session_id).toBe(sessionId);
            expect(turns[0].prompt).toBe(prompt);
            expect(turns[0].analysis).toBe(analysis);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should accumulate multiple turns in insertion order for the same session', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        fc.array(
          fc.record({ prompt: anyStringArb, analysis: anyStringArb }),
          { minLength: 1, maxLength: 10 },
        ),
        (sessionId, entries) => {
          const store = freshStore();
          try {
            for (const entry of entries) {
              store.storeTurn(sessionId, entry.prompt, entry.analysis);
            }

            const turns = store.getTurnsBySession(sessionId);

            expect(turns).toHaveLength(entries.length);
            for (let i = 0; i < entries.length; i++) {
              expect(turns[i].prompt).toBe(entries[i].prompt);
              expect(turns[i].analysis).toBe(entries[i].analysis);
            }
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: storeCandidate/getPendingDrafts round-trip
// ---------------------------------------------------------------------------
describe('Property 2: storeCandidate/getPendingDrafts round-trip', () => {
  it('should include a pending candidate in getPendingDrafts after storing', () => {
    fc.assert(
      fc.property(
        pendingCandidateArb,
        (candidate) => {
          const store = freshStore();
          try {
            store.storeCandidate(candidate);
            const drafts = store.getPendingDrafts();

            expect(drafts).toHaveLength(1);
            expect(drafts[0].id).toBe(candidate.id);
            expect(drafts[0].sessionId).toBe(candidate.sessionId);
            expect(drafts[0].frustrationSignature).toBe(candidate.frustrationSignature);
            expect(drafts[0].failedApproaches).toEqual(candidate.failedApproaches);
            expect(drafts[0].lessons).toEqual(candidate.lessons);
            expect(drafts[0].status).toBe('pending');
            expect(drafts[0].createdAt).toBe(candidate.createdAt);

            // successfulApproach: if undefined was stored, retrieved should also be undefined/null
            if (candidate.successfulApproach === undefined) {
              expect(drafts[0].successfulApproach == null).toBe(true);
            } else {
              expect(drafts[0].successfulApproach).toBe(candidate.successfulApproach);
            }
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should not include non-pending candidates in getPendingDrafts', () => {
    fc.assert(
      fc.property(
        pendingCandidateArb,
        fc.constantFrom('confirmed' as const, 'rejected' as const),
        (candidate, nonPendingStatus) => {
          const store = freshStore();
          try {
            const modified: AutoMemoryCandidate = { ...candidate, status: nonPendingStatus };
            store.storeCandidate(modified);
            const drafts = store.getPendingDrafts();

            expect(drafts).toHaveLength(0);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: storeExperience/getExperience round-trip
// ---------------------------------------------------------------------------
describe('Property 3: storeExperience/getExperience round-trip', () => {
  it('should preserve all fields through a store/retrieve cycle', () => {
    fc.assert(
      fc.property(
        failureExperienceArb,
        (experience) => {
          const store = freshStore();
          try {
            store.storeExperience(experience);
            const retrieved = store.getExperience(experience.id);

            expect(retrieved).not.toBeNull();
            expect(retrieved!.id).toBe(experience.id);
            expect(retrieved!.frustrationSignature).toBe(experience.frustrationSignature);
            expect(retrieved!.failedApproaches).toEqual(experience.failedApproaches);
            expect(retrieved!.lessons).toEqual(experience.lessons);
            expect(retrieved!.createdAt).toBe(experience.createdAt);

            // successfulApproach: undefined -> null/undefined is acceptable
            if (experience.successfulApproach === undefined) {
              expect(retrieved!.successfulApproach == null).toBe(true);
            } else {
              expect(retrieved!.successfulApproach).toBe(experience.successfulApproach);
            }
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return null for any ID that was never stored', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        (randomId) => {
          const store = freshStore();
          try {
            const result = store.getExperience(randomId);
            expect(result).toBeNull();
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: setFlag/getFlag round-trip
// ---------------------------------------------------------------------------
describe('Property 4: setFlag/getFlag round-trip', () => {
  it('should return the correct status for any valid sessionId and flag status', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        flagStatusArb,
        (sessionId, status) => {
          const store = freshStore();
          try {
            store.setFlag(sessionId, status);
            const flag = store.getFlag(sessionId);

            expect(flag).not.toBeNull();
            expect(flag!.session_id).toBe(sessionId);
            expect(flag!.status).toBe(status);
            expect(flag!.flagged_at).toBeDefined();
            expect(flag!.updated_at).toBeDefined();
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return null for any sessionId that never had a flag set', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        (sessionId) => {
          const store = freshStore();
          try {
            const flag = store.getFlag(sessionId);
            expect(flag).toBeNull();
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Candidate JSON serialization round-trip
// ---------------------------------------------------------------------------
describe('Property 5: Candidate JSON array fields survive round-trip', () => {
  it('should preserve failedApproaches and lessons arrays through serialization', () => {
    fc.assert(
      fc.property(
        stringArrayArb, // failedApproaches
        stringArrayArb, // lessons
        (failedApproaches, lessons) => {
          const store = freshStore();
          try {
            const candidate: AutoMemoryCandidate = {
              id: 'json-test',
              sessionId: 'session-json',
              frustrationSignature: 'Error: test',
              failedApproaches,
              lessons,
              status: 'pending',
              createdAt: '2026-01-01T00:00:00Z',
            };
            store.storeCandidate(candidate);
            const drafts = store.getPendingDrafts();

            expect(drafts).toHaveLength(1);
            expect(drafts[0].failedApproaches).toEqual(failedApproaches);
            expect(drafts[0].lessons).toEqual(lessons);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Session isolation for turns
// ---------------------------------------------------------------------------
describe('Property 6: Session isolation for turns', () => {
  it('should never return turns from a different session', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb, // sessionA
        nonEmptyStringArb, // sessionB
        anyStringArb,      // promptA
        anyStringArb,      // promptB
        (sessionA, sessionB, promptA, promptB) => {
          // Skip if sessions happen to be the same (they would share turns)
          fc.pre(sessionA !== sessionB);

          const store = freshStore();
          try {
            store.storeTurn(sessionA, promptA, 'analysis-A');
            store.storeTurn(sessionB, promptB, 'analysis-B');

            const turnsA = store.getTurnsBySession(sessionA);
            const turnsB = store.getTurnsBySession(sessionB);

            expect(turnsA).toHaveLength(1);
            expect(turnsB).toHaveLength(1);
            expect(turnsA[0].prompt).toBe(promptA);
            expect(turnsB[0].prompt).toBe(promptB);

            // Verify no cross-contamination
            expect(turnsA[0].session_id).toBe(sessionA);
            expect(turnsB[0].session_id).toBe(sessionB);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Flag UPSERT - last setFlag wins
// ---------------------------------------------------------------------------
describe('Property 7: Flag UPSERT semantics', () => {
  it('should always reflect the last setFlag status for a given session', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        fc.array(flagStatusArb, { minLength: 1, maxLength: 10 }),
        (sessionId, statusSequence) => {
          const store = freshStore();
          try {
            for (const status of statusSequence) {
              store.setFlag(sessionId, status);
            }

            const flag = store.getFlag(sessionId);
            const lastStatus = statusSequence[statusSequence.length - 1];

            expect(flag).not.toBeNull();
            expect(flag!.status).toBe(lastStatus);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: clearFlag idempotency
// ---------------------------------------------------------------------------
describe('Property 8: clearFlag idempotency', () => {
  it('should be safe to call clearFlag multiple times on the same session', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        fc.integer({ min: 1, max: 5 }),
        (sessionId, clearCount) => {
          const store = freshStore();
          try {
            store.setFlag(sessionId, 'frustrated');

            // Clear multiple times
            for (let i = 0; i < clearCount; i++) {
              expect(() => store.clearFlag(sessionId)).not.toThrow();
            }

            const flag = store.getFlag(sessionId);
            expect(flag).toBeNull();
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('should be safe to call clearFlag on a session that never had a flag', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        (sessionId) => {
          const store = freshStore();
          try {
            expect(() => store.clearFlag(sessionId)).not.toThrow();
            const flag = store.getFlag(sessionId);
            expect(flag).toBeNull();
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
