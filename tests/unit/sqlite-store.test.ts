/**
 * Unit Tests for SqliteStore
 *
 * TDD RED phase: These tests define the expected behavior of the SqliteStore
 * class which provides SQLite-backed persistence for Dev Sentinel.
 *
 * The target module (src/storage/sqlite-store.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Tables under test:
 *   - session_turns: stores per-turn prompt + analysis data
 *   - session_flags: tracks session frustration state (frustrated | capture)
 *   - auto_memory_candidates: draft failure notes pending user review
 *   - experiences: confirmed failure experiences for RAG recall
 *
 * Test points: 25 unit tests covering all CRUD operations, lifecycle,
 * and transaction semantics.
 */

import { SqliteStore } from '../../src/storage/sqlite-store';
import type { AutoMemoryCandidate, ExperienceRevision, FailureExperience } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<AutoMemoryCandidate> = {}): AutoMemoryCandidate {
  return {
    id: 'draft-001',
    sessionId: 'session-abc',
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried clearing cache', 'Tried reinstalling'],
    successfulApproach: 'Updated dependency version',
    lessons: ['Always check dependency compatibility'],
    status: 'pending',
    createdAt: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

function makeExperience(overrides: Partial<FailureExperience> = {}): FailureExperience {
  return {
    id: 'exp-001',
    frustrationSignature: 'ENOENT: no such file or directory',
    failedApproaches: ['Tried relative path', 'Tried home directory expansion'],
    successfulApproach: 'Used path.resolve with __dirname',
    lessons: ['Always use absolute paths', 'Never trust user-provided paths without normalization'],
    createdAt: '2026-02-16T10:00:00Z',
    revision: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
    store.initialize();
  });

  afterEach(() => {
    // Guard against double-close in tests that explicitly call close()
    try {
      store.close();
    } catch {
      // Already closed, ignore
    }
  });

  // =========================================================================
  // initialize / close
  // =========================================================================
  describe('initialize / close', () => {
    // Test 1: initialize() creates all 4 tables
    it('should create all 4 tables when initialize() is called', () => {
      // Arrange: create a fresh store (not using the beforeEach one)
      const freshStore = new SqliteStore(':memory:');
      freshStore.initialize();

      // Act: query sqlite_master to verify tables exist
      // We verify by attempting operations on each table
      // If tables do not exist, these operations will throw
      expect(() => freshStore.getTurnsBySession('nonexistent')).not.toThrow();
      expect(() => freshStore.getFlag('nonexistent')).not.toThrow();
      expect(() => freshStore.getPendingDrafts()).not.toThrow();
      expect(() => freshStore.getExperience('nonexistent')).not.toThrow();

      freshStore.close();
    });

    // Test 2: close() closes the DB connection
    it('should close the DB connection when close() is called', () => {
      const freshStore = new SqliteStore(':memory:');
      freshStore.initialize();
      freshStore.close();

      // After close, the store should no longer be usable
      // The exact error depends on implementation, but it should throw
      expect(() => freshStore.getTurnsBySession('any')).toThrow();
    });

    // Test 3: After close(), queries should throw
    it('should throw an error when performing queries after close()', () => {
      store.close();

      expect(() => store.storeTurn('s1', 'prompt', 'analysis')).toThrow();
      expect(() => store.getTurnsBySession('s1')).toThrow();
      expect(() => store.setFlag('s1', 'frustrated')).toThrow();
      expect(() => store.getFlag('s1')).toThrow();
      expect(() => store.getPendingDrafts()).toThrow();
      expect(() => store.storeExperience(makeExperience())).toThrow();
      expect(() => store.getExperience('exp-001')).toThrow();
    });
  });

  // =========================================================================
  // session_turns: storeTurn / getTurnsBySession
  // =========================================================================
  describe('storeTurn / getTurnsBySession', () => {
    // Test 4: storeTurn stores a turn, getTurnsBySession retrieves it
    it('should store a turn and retrieve it by session ID', () => {
      // Arrange
      const sessionId = 'session-123';
      const prompt = 'Why is my build failing?';
      const analysis = JSON.stringify({ type: 'frustrated', confidence: 0.8 });

      // Act
      store.storeTurn(sessionId, prompt, analysis);
      const turns = store.getTurnsBySession(sessionId);

      // Assert
      expect(turns).toHaveLength(1);
      expect(turns[0].session_id).toBe(sessionId);
      expect(turns[0].prompt).toBe(prompt);
      expect(turns[0].analysis).toBe(analysis);
      expect(turns[0].id).toBeDefined();
      expect(turns[0].created_at).toBeDefined();
    });

    // Test 5: getTurnsBySession returns empty array for unknown session
    it('should return an empty array for an unknown session ID', () => {
      const turns = store.getTurnsBySession('nonexistent-session');
      expect(turns).toEqual([]);
    });

    // Test 6: Multiple turns for same session are returned in order
    it('should return multiple turns for the same session in insertion order', () => {
      const sessionId = 'session-456';

      store.storeTurn(sessionId, 'prompt-1', 'analysis-1');
      store.storeTurn(sessionId, 'prompt-2', 'analysis-2');
      store.storeTurn(sessionId, 'prompt-3', 'analysis-3');

      const turns = store.getTurnsBySession(sessionId);

      expect(turns).toHaveLength(3);
      expect(turns[0].prompt).toBe('prompt-1');
      expect(turns[1].prompt).toBe('prompt-2');
      expect(turns[2].prompt).toBe('prompt-3');
    });

    // Test 7: Turns for different sessions are isolated
    it('should isolate turns between different sessions', () => {
      store.storeTurn('session-A', 'prompt-A1', 'analysis-A1');
      store.storeTurn('session-A', 'prompt-A2', 'analysis-A2');
      store.storeTurn('session-B', 'prompt-B1', 'analysis-B1');

      const turnsA = store.getTurnsBySession('session-A');
      const turnsB = store.getTurnsBySession('session-B');

      expect(turnsA).toHaveLength(2);
      expect(turnsB).toHaveLength(1);
      expect(turnsA[0].prompt).toBe('prompt-A1');
      expect(turnsB[0].prompt).toBe('prompt-B1');
    });
  });

  // =========================================================================
  // session_flags: setFlag / getFlag / upgradeFlag / clearFlag
  // =========================================================================
  describe('setFlag / getFlag / upgradeFlag / clearFlag', () => {
    // Test 8: setFlag creates a flag, getFlag retrieves it
    it('should create a flag and retrieve it with matching status', () => {
      store.setFlag('session-100', 'frustrated');

      const flag = store.getFlag('session-100');

      expect(flag).not.toBeNull();
      expect(flag!.session_id).toBe('session-100');
      expect(flag!.status).toBe('frustrated');
      expect(flag!.flagged_at).toBeDefined();
      expect(flag!.updated_at).toBeDefined();
    });

    // Test 9: getFlag returns null for unknown session
    it('should return null when getting a flag for an unknown session', () => {
      const flag = store.getFlag('nonexistent-session');
      expect(flag).toBeNull();
    });

    // Test 10: upgradeFlag changes status (frustrated -> capture)
    it('should change the flag status when upgradeFlag is called', () => {
      store.setFlag('session-200', 'frustrated');
      store.upgradeFlag('session-200', 'capture');

      const flag = store.getFlag('session-200');

      expect(flag).not.toBeNull();
      expect(flag!.status).toBe('capture');
    });

    // Test 10b: upgradeFlag preserves matchedExperienceId
    it('should preserve matched_experience_id when upgrading flag status', () => {
      store.setFlag('session-preserve', 'frustrated', 'exp-999');
      store.upgradeFlag('session-preserve', 'capture');
      const flag = store.getFlag('session-preserve');
      expect(flag).not.toBeNull();
      expect(flag!.status).toBe('capture');
      expect(flag!.matched_experience_id).toBe('exp-999');
    });

    // Test 11: clearFlag removes the flag
    it('should remove the flag when clearFlag is called', () => {
      store.setFlag('session-300', 'frustrated');
      store.clearFlag('session-300');

      const flag = store.getFlag('session-300');
      expect(flag).toBeNull();
    });

    // Test 12: clearFlag on non-existent flag does not throw
    it('should not throw when clearing a non-existent flag', () => {
      expect(() => store.clearFlag('nonexistent-session')).not.toThrow();
    });

    // Test 13: setFlag on existing session overwrites (UPSERT behavior)
    it('should overwrite the existing flag when setFlag is called on the same session (UPSERT)', () => {
      store.setFlag('session-400', 'frustrated');
      store.setFlag('session-400', 'capture');

      const flag = store.getFlag('session-400');

      expect(flag).not.toBeNull();
      expect(flag!.status).toBe('capture');
      // Should be exactly one row, not two
    });
  });

  // =========================================================================
  // auto_memory_candidates: storeCandidate / getPendingDrafts / deleteCandidate / updateCandidateStatus
  // =========================================================================
  describe('storeCandidate / getPendingDrafts / deleteCandidate / updateCandidateStatus', () => {
    // Test 14: storeCandidate stores, getPendingDrafts retrieves pending ones
    it('should store a candidate and retrieve it via getPendingDrafts', () => {
      const candidate = makeCandidate();
      store.storeCandidate(candidate);

      const drafts = store.getPendingDrafts();

      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe(candidate.id);
      expect(drafts[0].sessionId).toBe(candidate.sessionId);
      expect(drafts[0].frustrationSignature).toBe(candidate.frustrationSignature);
      expect(drafts[0].failedApproaches).toEqual(candidate.failedApproaches);
      expect(drafts[0].successfulApproach).toBe(candidate.successfulApproach);
      expect(drafts[0].lessons).toEqual(candidate.lessons);
      expect(drafts[0].status).toBe('pending');
      expect(drafts[0].createdAt).toBe(candidate.createdAt);
    });

    // Test 15: getPendingDrafts returns only status='pending' candidates
    it('should return only pending candidates from getPendingDrafts', () => {
      store.storeCandidate(makeCandidate({ id: 'draft-pending', status: 'pending' }));
      store.storeCandidate(makeCandidate({ id: 'draft-confirmed', status: 'confirmed' }));
      store.storeCandidate(makeCandidate({ id: 'draft-rejected', status: 'rejected' }));

      const drafts = store.getPendingDrafts();

      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe('draft-pending');
    });

    // Test 16: deleteCandidate removes a candidate
    it('should remove a candidate when deleteCandidate is called', () => {
      const candidate = makeCandidate({ id: 'to-delete' });
      store.storeCandidate(candidate);

      store.deleteCandidate('to-delete');

      const drafts = store.getPendingDrafts();
      expect(drafts).toHaveLength(0);
    });

    // Test 17: updateCandidateStatus changes status
    it('should change the candidate status when updateCandidateStatus is called', () => {
      store.storeCandidate(makeCandidate({ id: 'draft-upgrade', status: 'pending' }));

      store.updateCandidateStatus('draft-upgrade', 'confirmed');

      // It should no longer appear in pending drafts
      const drafts = store.getPendingDrafts();
      expect(drafts).toHaveLength(0);

      // But the candidate should still exist (verify via a round-trip:
      // store as confirmed, then check it is not pending)
      // Additional verification: store another pending one to ensure getPendingDrafts works
      store.storeCandidate(makeCandidate({ id: 'draft-still-pending', status: 'pending' }));
      const pendingDrafts = store.getPendingDrafts();
      expect(pendingDrafts).toHaveLength(1);
      expect(pendingDrafts[0].id).toBe('draft-still-pending');
    });

    // Test 18: getPendingDrafts returns empty array when none pending
    it('should return an empty array when there are no pending candidates', () => {
      // Store only non-pending candidates
      store.storeCandidate(makeCandidate({ id: 'confirmed-1', status: 'confirmed' }));
      store.storeCandidate(makeCandidate({ id: 'rejected-1', status: 'rejected' }));

      const drafts = store.getPendingDrafts();
      expect(drafts).toEqual([]);
    });
  });

  // =========================================================================
  // experiences: storeExperience / getExperience
  // =========================================================================
  describe('storeExperience / getExperience', () => {
    // Test 19: storeExperience stores, getExperience retrieves
    it('should store an experience and retrieve it by ID', () => {
      const experience = makeExperience();
      store.storeExperience(experience);

      const retrieved = store.getExperience('exp-001');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(experience.id);
      expect(retrieved!.frustrationSignature).toBe(experience.frustrationSignature);
      expect(retrieved!.successfulApproach).toBe(experience.successfulApproach);
      expect(retrieved!.createdAt).toBe(experience.createdAt);
    });

    // Test 20: getExperience returns null for unknown id
    it('should return null when getting an experience with an unknown ID', () => {
      const result = store.getExperience('nonexistent-exp');
      expect(result).toBeNull();
    });

    // Test 21: Experience fields (failedApproaches, lessons) are properly serialized/deserialized as JSON arrays
    it('should properly serialize and deserialize failedApproaches and lessons as JSON arrays', () => {
      const experience = makeExperience({
        failedApproaches: ['approach-1', 'approach-2', 'approach-3'],
        lessons: ['lesson-A', 'lesson-B'],
      });
      store.storeExperience(experience);

      const retrieved = store.getExperience(experience.id);

      expect(retrieved).not.toBeNull();
      expect(Array.isArray(retrieved!.failedApproaches)).toBe(true);
      expect(retrieved!.failedApproaches).toEqual(['approach-1', 'approach-2', 'approach-3']);
      expect(Array.isArray(retrieved!.lessons)).toBe(true);
      expect(retrieved!.lessons).toEqual(['lesson-A', 'lesson-B']);
    });

    // Additional: Experience without successfulApproach (optional field)
    it('should handle experience without successfulApproach (optional field)', () => {
      const experience = makeExperience({ successfulApproach: undefined });
      store.storeExperience(experience);

      const retrieved = store.getExperience(experience.id);

      expect(retrieved).not.toBeNull();
      // successfulApproach should be undefined or null (implementation may choose either)
      expect(retrieved!.successfulApproach == null).toBe(true);
    });
  });

  // =========================================================================
  // runInTransaction
  // =========================================================================
  describe('runInTransaction', () => {
    // Test 22: runInTransaction commits on success (multiple operations visible after)
    it('should commit all operations when the transaction function succeeds', () => {
      store.runInTransaction(() => {
        store.storeTurn('tx-session', 'prompt-1', 'analysis-1');
        store.storeTurn('tx-session', 'prompt-2', 'analysis-2');
        store.setFlag('tx-session', 'frustrated');
      });

      const turns = store.getTurnsBySession('tx-session');
      const flag = store.getFlag('tx-session');

      expect(turns).toHaveLength(2);
      expect(flag).not.toBeNull();
      expect(flag!.status).toBe('frustrated');
    });

    // Test 23: runInTransaction rolls back on error (no partial state)
    it('should roll back all operations when the transaction function throws', () => {
      // Pre-populate to verify no partial state leaks
      expect(store.getTurnsBySession('rollback-session')).toHaveLength(0);

      expect(() => {
        store.runInTransaction(() => {
          store.storeTurn('rollback-session', 'prompt-1', 'analysis-1');
          store.storeTurn('rollback-session', 'prompt-2', 'analysis-2');
          throw new Error('Simulated failure');
        });
      }).toThrow('Simulated failure');

      // Nothing should have been committed
      const turns = store.getTurnsBySession('rollback-session');
      expect(turns).toHaveLength(0);
    });

    // Test 24: runInTransaction returns the function's return value
    it('should return the value returned by the transaction function', () => {
      const result = store.runInTransaction(() => {
        store.storeTurn('return-session', 'prompt-1', 'analysis-1');
        return 42;
      });

      expect(result).toBe(42);
    });
  });

  // =========================================================================
  // Flag lifecycle integration
  // =========================================================================
  describe('Flag lifecycle integration', () => {
    // Test 25: Full lifecycle: setFlag('frustrated') -> upgradeFlag('capture') -> clearFlag -> getFlag returns null
    it('should support the full flag lifecycle: set -> upgrade -> clear -> null', () => {
      const sessionId = 'lifecycle-session';

      // Step 1: Set initial frustrated flag
      store.setFlag(sessionId, 'frustrated');
      const flag1 = store.getFlag(sessionId);
      expect(flag1).not.toBeNull();
      expect(flag1!.status).toBe('frustrated');

      // Step 2: Upgrade to capture
      store.upgradeFlag(sessionId, 'capture');
      const flag2 = store.getFlag(sessionId);
      expect(flag2).not.toBeNull();
      expect(flag2!.status).toBe('capture');

      // Step 3: Clear the flag
      store.clearFlag(sessionId);
      const flag3 = store.getFlag(sessionId);
      expect(flag3).toBeNull();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('should handle storing a candidate with empty arrays for failedApproaches and lessons', () => {
      const candidate = makeCandidate({
        id: 'empty-arrays',
        failedApproaches: [],
        lessons: [],
      });
      store.storeCandidate(candidate);

      const drafts = store.getPendingDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0].failedApproaches).toEqual([]);
      expect(drafts[0].lessons).toEqual([]);
    });

    it('should handle storing an experience with empty arrays for failedApproaches and lessons', () => {
      const experience = makeExperience({
        id: 'empty-arrays-exp',
        failedApproaches: [],
        lessons: [],
      });
      store.storeExperience(experience);

      const retrieved = store.getExperience('empty-arrays-exp');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.failedApproaches).toEqual([]);
      expect(retrieved!.lessons).toEqual([]);
    });

    it('should handle special characters in prompt text', () => {
      const specialPrompt = "It's failing with \"quotes\" and unicode: \u00e9\u00e0\u00fc \ud83d\ude80 \\ backslash";
      store.storeTurn('special-session', specialPrompt, '{}');

      const turns = store.getTurnsBySession('special-session');
      expect(turns).toHaveLength(1);
      expect(turns[0].prompt).toBe(specialPrompt);
    });

    it('should handle very long strings in prompt and analysis', () => {
      const longString = 'x'.repeat(100_000);
      store.storeTurn('long-session', longString, longString);

      const turns = store.getTurnsBySession('long-session');
      expect(turns).toHaveLength(1);
      expect(turns[0].prompt).toBe(longString);
      expect(turns[0].analysis).toBe(longString);
    });

    it('should handle special characters in JSON array fields of candidates', () => {
      const candidate = makeCandidate({
        id: 'special-json',
        failedApproaches: ['approach with "quotes"', "approach with 'apostrophe'"],
        lessons: ['lesson with\nnewline', 'lesson with\ttab'],
      });
      store.storeCandidate(candidate);

      const drafts = store.getPendingDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0].failedApproaches).toEqual(candidate.failedApproaches);
      expect(drafts[0].lessons).toEqual(candidate.lessons);
    });

    it('should not throw when deleting a non-existent candidate', () => {
      expect(() => store.deleteCandidate('nonexistent-candidate')).not.toThrow();
    });

    it('should handle upgradeFlag on a non-existent session gracefully', () => {
      // upgradeFlag on non-existent session: should not throw, but should have no effect
      // (or throw - implementation decides, but at minimum it should not corrupt state)
      expect(() => store.upgradeFlag('ghost-session', 'capture')).not.toThrow();
      const flag = store.getFlag('ghost-session');
      expect(flag).toBeNull();
    });

    it('should handle updateCandidateStatus on a non-existent candidate without throwing', () => {
      expect(() => store.updateCandidateStatus('ghost-candidate', 'confirmed')).not.toThrow();
    });
  });

  // =========================================================================
  // setFlag with matchedExperienceId
  // =========================================================================
  describe('setFlag with matchedExperienceId', () => {
    it('should store matchedExperienceId when provided', () => {
      store.setFlag('session-match', 'frustrated', 'exp-001');
      const flag = store.getFlag('session-match');
      expect(flag).not.toBeNull();
      expect(flag!.matched_experience_id).toBe('exp-001');
    });

    it('should store null when matchedExperienceId is not provided', () => {
      store.setFlag('session-no-match', 'frustrated');
      const flag = store.getFlag('session-no-match');
      expect(flag).not.toBeNull();
      expect(flag!.matched_experience_id).toBeNull();
    });

    it('should store null when matchedExperienceId is undefined', () => {
      store.setFlag('session-undef', 'frustrated', undefined);
      const flag = store.getFlag('session-undef');
      expect(flag).not.toBeNull();
      expect(flag!.matched_experience_id).toBeNull();
    });
  });

  // =========================================================================
  // matchedExperienceId in candidates
  // =========================================================================
  describe('matchedExperienceId in candidates', () => {
    it('should store and retrieve matchedExperienceId', () => {
      const candidate = makeCandidate({ id: 'draft-matched', matchedExperienceId: 'exp-match-001' });
      store.storeCandidate(candidate);

      const drafts = store.getPendingDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0].matchedExperienceId).toBe('exp-match-001');
    });

    it('should store null when matchedExperienceId is not provided', () => {
      const candidate = makeCandidate({ id: 'draft-no-match' });
      store.storeCandidate(candidate);

      const drafts = store.getPendingDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0].matchedExperienceId).toBeUndefined();
    });
  });

  // =========================================================================
  // experience revisions
  // =========================================================================
  describe('experience revisions', () => {
    it('should store and retrieve revisions', () => {
      store.storeRevision({
        id: 'rev-001',
        experienceId: 'exp-001',
        revision: 1,
        frustrationSignature: 'Test error',
        failedApproaches: ['approach 1'],
        successfulApproach: 'solution',
        lessons: ['lesson 1'],
        createdAt: '2026-02-16T10:00:00Z',
      });

      const revisions = store.getRevisions('exp-001');
      expect(revisions).toHaveLength(1);
      expect(revisions[0].id).toBe('rev-001');
      expect(revisions[0].experienceId).toBe('exp-001');
      expect(revisions[0].revision).toBe(1);
      expect(revisions[0].failedApproaches).toEqual(['approach 1']);
      expect(revisions[0].lessons).toEqual(['lesson 1']);
    });

    it('should return revisions in ascending revision order', () => {
      store.storeRevision({
        id: 'rev-002', experienceId: 'exp-001', revision: 2,
        frustrationSignature: 'Test', failedApproaches: [], lessons: [],
        createdAt: '2026-02-16T11:00:00Z',
      });
      store.storeRevision({
        id: 'rev-001', experienceId: 'exp-001', revision: 1,
        frustrationSignature: 'Test', failedApproaches: [], lessons: [],
        createdAt: '2026-02-16T10:00:00Z',
      });

      const revisions = store.getRevisions('exp-001');
      expect(revisions).toHaveLength(2);
      expect(revisions[0].revision).toBe(1);
      expect(revisions[1].revision).toBe(2);
    });

    it('should return empty array for non-existent experience', () => {
      const revisions = store.getRevisions('non-existent');
      expect(revisions).toEqual([]);
    });
  });

  // =========================================================================
  // updateExperience
  // =========================================================================
  describe('updateExperience', () => {
    it('should update an existing experience', () => {
      const original = makeExperience({ id: 'exp-update' });
      store.storeExperience(original);

      store.updateExperience({
        ...original,
        frustrationSignature: 'Updated signature',
        failedApproaches: ['old approach', 'new approach'],
        successfulApproach: 'New solution',
        lessons: ['Updated lesson'],
        revision: 2,
      });

      const updated = store.getExperience('exp-update');
      expect(updated).not.toBeNull();
      expect(updated!.frustrationSignature).toBe('Updated signature');
      expect(updated!.failedApproaches).toEqual(['old approach', 'new approach']);
      expect(updated!.successfulApproach).toBe('New solution');
      expect(updated!.lessons).toEqual(['Updated lesson']);
      expect(updated!.revision).toBe(2);
    });
  });

  // =========================================================================
  // experience revision default
  // =========================================================================
  describe('experience revision field', () => {
    it('should default revision to 1 when storing experience', () => {
      store.storeExperience(makeExperience({ id: 'exp-default-rev' }));
      const exp = store.getExperience('exp-default-rev');
      expect(exp).not.toBeNull();
      expect(exp!.revision).toBe(1);
    });

    it('should store explicit revision value', () => {
      store.storeExperience({ ...makeExperience({ id: 'exp-rev-3' }), revision: 3 });
      const exp = store.getExperience('exp-rev-3');
      expect(exp!.revision).toBe(3);
    });
  });

  // =========================================================================
  // migration idempotent
  // =========================================================================
  describe('migration idempotency', () => {
    it('should handle calling initialize() twice without error', () => {
      expect(() => store.initialize()).not.toThrow();
    });
  });

  // =========================================================================
  // resetAll includes experience_revisions
  // =========================================================================
  describe('resetAll with revisions', () => {
    it('should clear experience_revisions on resetAll', () => {
      store.storeRevision({
        id: 'rev-reset', experienceId: 'exp-001', revision: 1,
        frustrationSignature: 'Test', failedApproaches: [], lessons: [],
        createdAt: '2026-02-16T10:00:00Z',
      });
      store.resetAll();
      const revisions = store.getRevisions('exp-001');
      expect(revisions).toEqual([]);
    });
  });
});
