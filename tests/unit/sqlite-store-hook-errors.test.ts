/**
 * Unit Tests for SqliteStore — Hook Error Tracking
 *
 * TDD RED phase: These tests define the expected behavior of 3 new SqliteStore
 * methods for persistent error tracking:
 *   - recordHookError(component, hook, errorMessage, createdAt?)
 *   - getPersistentErrors(hourWindow, minCount)
 *   - cleanupOldErrors(retentionDays)
 *
 * Plus verification that resetAll() clears the hook_errors table.
 *
 * These methods do NOT exist yet. All tests are expected to FAIL until the
 * implementation is written.
 *
 * The hook_errors table enables surfacing persistent infrastructure issues
 * (e.g., LLM provider down, database corruption) via `sentinel status`,
 * even though hook catch blocks silently swallow errors for graceful degradation.
 */

import { SqliteStore } from '../../src/storage/sqlite-store';
import type { PersistentErrorSummary } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SqliteStore — Hook Error Tracking', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
    store.initialize();
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // Already closed, ignore
    }
  });

  // =========================================================================
  // recordHookError + getPersistentErrors basic
  // =========================================================================
  describe('recordHookError + getPersistentErrors basic', () => {
    it('should record errors and return them when threshold is met', () => {
      // Arrange: record 3 errors for 'llm' component within the last hour
      store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');
      store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');
      store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');

      // Act: get persistent errors with hourWindow=1 and minCount=3
      const errors = store.getPersistentErrors(1, 3);

      // Assert
      expect(errors).toHaveLength(1);
      expect(errors[0].component).toBe('llm');
      expect(errors[0].count).toBeGreaterThanOrEqual(3);
      expect(errors[0].lastError).toBeDefined();
      expect(errors[0].lastOccurred).toBeDefined();
    });
  });

  // =========================================================================
  // getPersistentErrors — threshold not met
  // =========================================================================
  describe('getPersistentErrors — threshold not met', () => {
    it('should return empty array when error count is below the threshold', () => {
      // Arrange: record only 2 errors for 'llm' (below threshold of 3)
      store.recordHookError('llm', 'user-prompt-submit', 'connection refused at localhost:11434');
      store.recordHookError('llm', 'stop', 'connection refused at localhost:11434');

      // Act
      const errors = store.getPersistentErrors(1, 3);

      // Assert: 2 < 3 threshold, so empty
      expect(errors).toEqual([]);
    });
  });

  // =========================================================================
  // getPersistentErrors — threshold met
  // =========================================================================
  describe('getPersistentErrors — threshold met', () => {
    it('should return the component with count=3 when exactly 3 errors are recorded', () => {
      // Arrange
      store.recordHookError('database', 'stop', 'SQLITE_BUSY: database is locked');
      store.recordHookError('database', 'user-prompt-submit', 'SQLITE_BUSY: database is locked');
      store.recordHookError('database', 'session-end', 'SQLITE_BUSY: database is locked');

      // Act
      const errors = store.getPersistentErrors(1, 3);

      // Assert
      expect(errors).toHaveLength(1);
      expect(errors[0].component).toBe('database');
      expect(errors[0].count).toBe(3);
    });
  });

  // =========================================================================
  // getPersistentErrors — independent components
  // =========================================================================
  describe('getPersistentErrors — independent components', () => {
    it('should only include components that exceed the threshold', () => {
      // Arrange: 5 'llm' errors (above threshold), 2 'vector' errors (below threshold)
      store.recordHookError('llm', 'user-prompt-submit', 'timeout');
      store.recordHookError('llm', 'user-prompt-submit', 'timeout');
      store.recordHookError('llm', 'stop', 'timeout');
      store.recordHookError('llm', 'session-end', 'timeout');
      store.recordHookError('llm', 'user-prompt-submit', 'timeout');

      store.recordHookError('vector', 'user-prompt-submit', 'embedding failed');
      store.recordHookError('vector', 'user-prompt-submit', 'embedding failed');

      // Act
      const errors = store.getPersistentErrors(1, 3);

      // Assert: only 'llm' should appear (5 >= 3), 'vector' should not (2 < 3)
      expect(errors).toHaveLength(1);
      expect(errors[0].component).toBe('llm');
      expect(errors[0].count).toBe(5);
    });
  });

  // =========================================================================
  // getPersistentErrors — lastError is most recent
  // =========================================================================
  describe('getPersistentErrors — lastError is most recent', () => {
    it('should return the most recent error message as lastError', () => {
      // Arrange: record errors with explicit timestamps (older to newer)
      store.recordHookError('llm', 'user-prompt-submit', 'first error', '2026-02-24 10:00:00');
      store.recordHookError('llm', 'user-prompt-submit', 'second error', '2026-02-24 10:05:00');
      store.recordHookError('llm', 'user-prompt-submit', 'most recent error', '2026-02-24 10:10:00');

      // Act
      const errors = store.getPersistentErrors(24, 3);

      // Assert: lastError should be the most recently recorded one
      expect(errors).toHaveLength(1);
      expect(errors[0].lastError).toBe('most recent error');
      expect(errors[0].lastOccurred).toBe('2026-02-24 10:10:00');
    });
  });

  // =========================================================================
  // cleanupOldErrors
  // =========================================================================
  describe('cleanupOldErrors', () => {
    it('should delete errors older than the retention period and return deleted count', () => {
      // Arrange: record an error with createdAt set to 30 days ago
      store.recordHookError('llm', 'user-prompt-submit', 'old error', '2026-01-25 10:00:00');

      // Also record a recent error to ensure it is NOT deleted
      store.recordHookError('llm', 'user-prompt-submit', 'recent error');

      // Act: cleanup errors older than 7 days
      const deletedCount = store.cleanupOldErrors(7);

      // Assert: should have deleted 1 old error
      expect(deletedCount).toBe(1);

      // Verify the old error is no longer found but the recent one is
      // Using a large window to catch all remaining errors
      const remaining = store.getPersistentErrors(24 * 365, 1);
      // Only the recent error should remain
      expect(remaining.length).toBeLessThanOrEqual(1);
      if (remaining.length === 1) {
        expect(remaining[0].lastError).toBe('recent error');
      }
    });

    it('should return 0 when no errors are older than the retention period', () => {
      // Arrange: record only recent errors
      store.recordHookError('llm', 'user-prompt-submit', 'fresh error');

      // Act
      const deletedCount = store.cleanupOldErrors(7);

      // Assert
      expect(deletedCount).toBe(0);
    });
  });

  // =========================================================================
  // resetAll clears hook_errors
  // =========================================================================
  describe('resetAll clears hook_errors', () => {
    it('should clear all hook_errors when resetAll is called', () => {
      // Arrange: record several errors
      store.recordHookError('llm', 'user-prompt-submit', 'error 1');
      store.recordHookError('llm', 'stop', 'error 2');
      store.recordHookError('database', 'session-end', 'error 3');

      // Act
      store.resetAll();

      // Assert: getPersistentErrors should return empty with low threshold
      const errors = store.getPersistentErrors(24, 1);
      expect(errors).toEqual([]);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('should handle recording errors with empty error message', () => {
      expect(() => {
        store.recordHookError('llm', 'user-prompt-submit', '');
      }).not.toThrow();
    });

    it('should handle recording errors with long error messages', () => {
      const longMessage = 'x'.repeat(10_000);
      expect(() => {
        store.recordHookError('llm', 'user-prompt-submit', longMessage);
      }).not.toThrow();
    });

    it('should return empty array when no errors have been recorded', () => {
      const errors = store.getPersistentErrors(1, 1);
      expect(errors).toEqual([]);
    });

    it('should handle cleanupOldErrors when table is empty', () => {
      const deletedCount = store.cleanupOldErrors(7);
      expect(deletedCount).toBe(0);
    });
  });
});
