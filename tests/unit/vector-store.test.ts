/**
 * Unit Tests for VectorStore
 *
 * TDD RED phase: These tests define the expected behavior of the VectorStore
 * class which provides SQLite-backed vector storage with cosine similarity
 * search for Dev Sentinel's RAG recall system.
 *
 * The target module (src/storage/vector-store.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Table under test:
 *   - vectors: stores embeddings as BLOBs with JSON metadata
 *     Columns: id TEXT PRIMARY KEY, embedding BLOB, metadata TEXT,
 *              created_at TEXT DEFAULT datetime('now')
 *
 * Test points: 16 unit tests covering initialization, CRUD operations,
 * cosine similarity search, ordering, filtering, and edge cases.
 */

import { VectorStore } from '../../src/storage/vector-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two vectors (reference implementation
 * for verifying search results in tests).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * Generates an arbitrary normalized vector of given dimension.
 * Useful for creating vectors with known similarity properties.
 */
function normalizedVector(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return values;
  return values.map((v) => v / norm);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('VectorStore', () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore(':memory:');
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
    // Test 1: initialize() creates the vectors table
    it('should create the vectors table so that operations do not throw after init', () => {
      // Arrange: create a fresh store (not using the beforeEach one)
      const freshStore = new VectorStore(':memory:');
      freshStore.initialize();

      // Act & Assert: basic operations should not throw on an initialized store
      expect(() => freshStore.search([1, 0, 0], 5, 0.0)).not.toThrow();
      expect(() => freshStore.store('test-id', [1, 0, 0], { model: 'test' })).not.toThrow();

      freshStore.close();
    });

    // Test 2: close() closes the DB — operations throw after close
    it('should throw when performing operations after close()', () => {
      const freshStore = new VectorStore(':memory:');
      freshStore.initialize();
      freshStore.close();

      // After close, every method should throw
      expect(() => freshStore.store('id', [1, 0], { model: 'test' })).toThrow();
      expect(() => freshStore.search([1, 0], 5, 0.0)).toThrow();
      expect(() => freshStore.delete('id')).toThrow();
      expect(() => freshStore.clearVectors()).toThrow();
    });
  });

  // =========================================================================
  // store / search round-trip
  // =========================================================================
  describe('store / search round-trip', () => {
    // Test 3: Same vector search yields similarity close to 1.0
    it('should return similarity close to 1.0 when searching with the same vector', () => {
      // Arrange
      const embedding = [0.5, 0.3, 0.8, 0.1];
      store.store('vec-1', embedding, { model: 'test-model' });

      // Act
      const results = store.search(embedding, 5, 0.0);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('vec-1');
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
    });

    // Test 4: Orthogonal vectors yield similarity close to 0.0
    it('should return similarity close to 0.0 for orthogonal vectors', () => {
      // Arrange: [1, 0] and [0, 1] are orthogonal
      store.store('vec-x', [1, 0], { model: 'test-model' });

      // Act
      const results = store.search([0, 1], 5, -1.0); // minSimilarity=-1 to include all

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBeCloseTo(0.0, 5);
    });
  });

  // =========================================================================
  // topK and minSimilarity
  // =========================================================================
  describe('topK and minSimilarity filtering', () => {
    // Test 5: topK limits results
    it('should return at most topK results', () => {
      // Arrange: store 5 similar vectors
      for (let i = 0; i < 5; i++) {
        const vec = [1, 0.1 * i, 0]; // progressively different
        store.store(`vec-${i}`, vec, { model: 'test-model' });
      }

      // Act: search with topK=3
      const results = store.search([1, 0, 0], 3, 0.0);

      // Assert
      expect(results.length).toBeLessThanOrEqual(3);
    });

    // Test 6: minSimilarity filters results
    it('should filter out results below minSimilarity threshold', () => {
      // Arrange: store a similar and a dissimilar vector
      store.store('similar', [1, 0, 0], { model: 'test-model' });
      store.store('orthogonal', [0, 1, 0], { model: 'test-model' });

      // Act: search with high minSimilarity
      const results = store.search([1, 0, 0], 10, 0.9);

      // Assert: only the similar vector should be returned
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('similar');
      expect(results[0].similarity).toBeGreaterThanOrEqual(0.9);
    });
  });

  // =========================================================================
  // delete / clearVectors
  // =========================================================================
  describe('delete / clearVectors', () => {
    // Test 7: delete removes vector from search results
    it('should not return a deleted vector in search results', () => {
      // Arrange
      store.store('to-delete', [1, 0, 0], { model: 'test-model' });
      store.store('to-keep', [0.9, 0.1, 0], { model: 'test-model' });

      // Act
      store.delete('to-delete');
      const results = store.search([1, 0, 0], 10, 0.0);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('to-keep');
    });

    // Test 8: clearVectors removes all vectors
    it('should return empty results after clearVectors', () => {
      // Arrange
      store.store('v1', [1, 0, 0], { model: 'test-model' });
      store.store('v2', [0, 1, 0], { model: 'test-model' });
      store.store('v3', [0, 0, 1], { model: 'test-model' });

      // Act
      store.clearVectors();
      const results = store.search([1, 0, 0], 10, 0.0);

      // Assert
      expect(results).toHaveLength(0);
    });
  });

  // =========================================================================
  // Metadata
  // =========================================================================
  describe('metadata storage and retrieval', () => {
    // Test 9: metadata including embedding model name is stored and retrieved
    it('should preserve metadata including embedding model name through round-trip', () => {
      // Arrange
      const metadata = {
        model: 'qwen3-embedding:0.6b',
        source: 'experience-001',
        category: 'build-failure',
      };
      store.store('meta-vec', [0.5, 0.5], metadata);

      // Act
      const results = store.search([0.5, 0.5], 1, 0.0);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].metadata).toEqual(metadata);
      expect(results[0].metadata.model).toBe('qwen3-embedding:0.6b');
    });
  });

  // =========================================================================
  // Empty DB
  // =========================================================================
  describe('empty database', () => {
    // Test 10: Empty DB search returns empty array
    it('should return an empty array when searching an empty database', () => {
      const results = store.search([1, 0, 0], 5, 0.0);
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // Ordering
  // =========================================================================
  describe('search result ordering', () => {
    // Test 11: Multiple vectors - search returns correct ordering (most similar first)
    it('should return results sorted by similarity in descending order', () => {
      // Arrange: store vectors with known similarities to [1, 0, 0]
      store.store('exact', [1, 0, 0], { model: 'test' });        // similarity = 1.0
      store.store('close', [0.9, 0.1, 0], { model: 'test' });    // similarity ~ 0.994
      store.store('medium', [0.5, 0.5, 0], { model: 'test' });   // similarity ~ 0.707
      store.store('far', [0.1, 0.9, 0], { model: 'test' });      // similarity ~ 0.110

      // Act
      const query = [1, 0, 0];
      const results = store.search(query, 10, 0.0);

      // Assert: sorted by similarity descending
      expect(results).toHaveLength(4);
      expect(results[0].id).toBe('exact');
      expect(results[1].id).toBe('close');
      expect(results[2].id).toBe('medium');
      expect(results[3].id).toBe('far');

      // Verify descending order
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
      }
    });
  });

  // =========================================================================
  // UPSERT behavior
  // =========================================================================
  describe('store with same ID (UPSERT)', () => {
    // Test 12: Store with same ID replaces existing
    it('should replace the existing vector when storing with the same ID', () => {
      // Arrange: store a vector, then overwrite it with a different one
      store.store('upsert-id', [1, 0, 0], { model: 'v1' });
      store.store('upsert-id', [0, 1, 0], { model: 'v2' });

      // Act: search with the new vector
      const results = store.search([0, 1, 0], 10, 0.0);

      // Assert: should find exactly one result (not two)
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('upsert-id');
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
      expect(results[0].metadata.model).toBe('v2');
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    // Test 13: Zero vector handling
    it('should handle zero vectors gracefully (similarity 0 or no crash)', () => {
      // Arrange: store a zero vector
      store.store('zero-vec', [0, 0, 0], { model: 'test' });

      // Act: search with a zero vector query
      const results = store.search([0, 0, 0], 5, -1.0);

      // Assert: should not throw, similarity should be 0 (since 0/0 is undefined)
      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBeCloseTo(0.0, 5);
    });

    // Test 14: Negative values in vectors
    it('should handle vectors with negative values correctly', () => {
      // Arrange: opposite vectors should have similarity = -1.0
      store.store('positive', [1, 0, 0], { model: 'test' });

      // Act: search with the opposite vector
      const results = store.search([-1, 0, 0], 5, -1.0); // minSimilarity=-1 to include negatives

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBeCloseTo(-1.0, 5);
    });

    // Test 15: Single dimension vectors
    it('should work correctly with single-dimension vectors', () => {
      // Arrange
      store.store('single-pos', [5], { model: 'test' });
      store.store('single-neg', [-3], { model: 'test' });

      // Act
      const results = store.search([1], 10, -1.0);

      // Assert: [5] and [1] should have similarity 1.0, [-3] and [1] should have similarity -1.0
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('single-pos');
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
      expect(results[1].id).toBe('single-neg');
      expect(results[1].similarity).toBeCloseTo(-1.0, 5);
    });

    // Test 16: Large dimension vectors (1024)
    it('should handle large dimension vectors (1024 dimensions)', () => {
      // Arrange: create a 1024-dimensional vector
      const largeDim = 1024;
      const vecA = new Array(largeDim).fill(0).map((_, i) => Math.sin(i));
      const vecB = new Array(largeDim).fill(0).map((_, i) => Math.cos(i));

      store.store('large-a', vecA, { model: 'test' });
      store.store('large-b', vecB, { model: 'test' });

      // Act: search with vecA
      const results = store.search(vecA, 10, 0.0);

      // Assert: vecA should be most similar to itself
      // There may be 1 or 2 results depending on whether vecB meets minSimilarity
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('large-a');
      expect(results[0].similarity).toBeCloseTo(1.0, 5);

      // Verify the similarity of large-b matches our reference computation
      const expectedSimilarity = cosineSimilarity(vecA, vecB);
      if (results.length > 1) {
        expect(results[1].id).toBe('large-b');
        expect(results[1].similarity).toBeCloseTo(expectedSimilarity, 5);
      }
    });

    // Additional edge case: delete on non-existent ID does not throw
    it('should not throw when deleting a non-existent vector ID', () => {
      expect(() => store.delete('ghost-vector')).not.toThrow();
    });

    // Additional edge case: clearVectors on empty DB does not throw
    it('should not throw when calling clearVectors on an empty database', () => {
      expect(() => store.clearVectors()).not.toThrow();
    });

    // Additional edge case: metadata with special characters
    it('should handle metadata with special characters and unicode', () => {
      const metadata = {
        model: 'test-model',
        description: 'Error with "quotes" and \'apostrophe\' and unicode: \u00e9\u00e0\u00fc',
      };
      store.store('special-meta', [1, 0], metadata);

      const results = store.search([1, 0], 1, 0.0);

      expect(results).toHaveLength(1);
      expect(results[0].metadata).toEqual(metadata);
    });

    // Additional edge case: empty metadata object
    it('should handle empty metadata object', () => {
      store.store('empty-meta', [1, 0, 0], {});

      const results = store.search([1, 0, 0], 1, 0.0);

      expect(results).toHaveLength(1);
      expect(results[0].metadata).toEqual({});
    });
  });
});
