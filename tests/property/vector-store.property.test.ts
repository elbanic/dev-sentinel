/**
 * Property-Based Tests for VectorStore
 *
 * TDD RED phase: These property tests use fast-check to verify that the
 * VectorStore's cosine similarity search upholds mathematical invariants
 * and data integrity across a wide range of randomly generated inputs.
 *
 * The target module (src/storage/vector-store.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Properties tested:
 *   1. Self-similarity: cosine(v, v) = 1.0 for any non-zero vector
 *   2. Symmetry: similarity(a, b) = similarity(b, a)
 *   3. Range: similarity is always in [-1, 1]
 *   4. Store/search round-trip: stored vector is always findable with itself
 *   5. topK bound: search never returns more than topK results
 *   6. Delete consistency: after delete, vector is absent from search
 *   7. Metadata round-trip: metadata stored equals metadata retrieved
 */

import fc from 'fast-check';
import { VectorStore, VectorSearchResult } from '../../src/storage/vector-store';

// ---------------------------------------------------------------------------
// Shared setup: fresh in-memory DB per property assertion
// ---------------------------------------------------------------------------

/**
 * Creates a fresh VectorStore backed by an in-memory DB.
 * The caller is responsible for calling close() after use.
 */
function freshStore(): VectorStore {
  const store = new VectorStore(':memory:');
  store.initialize();
  return store;
}

// ---------------------------------------------------------------------------
// Arbitraries (fast-check generators)
// ---------------------------------------------------------------------------

/**
 * Generates a finite (non-NaN, non-Infinity) double suitable for vector
 * components. We use a bounded range to avoid floating-point overflow in
 * dot product / norm calculations.
 */
const finiteDouble = fc.double({
  min: -1e6,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Generates a vector of a given fixed dimension with finite double elements.
 * Dimension is between 2 and 128 (kept reasonable for test speed).
 */
const vectorOfDim = (dim: number) =>
  fc.array(finiteDouble, { minLength: dim, maxLength: dim });

/**
 * Generates a non-zero vector of a given dimension.
 * A vector is non-zero if at least one element has absolute value > 1e-12.
 */
const nonZeroVectorOfDim = (dim: number) =>
  vectorOfDim(dim).filter((v) => v.some((x) => Math.abs(x) > 1e-12));

/**
 * Generates a random dimension between 2 and 64.
 */
const dimensionArb = fc.integer({ min: 2, max: 64 });

/**
 * Generates a non-empty string for use as vector IDs.
 */
const idArb = fc.string({ minLength: 1, maxLength: 100 });

/**
 * Generates a metadata object with arbitrary string key-value pairs.
 * Always includes a 'model' key to match the spec requirement.
 */
const metadataArb = fc.record({
  model: fc.string({ minLength: 1, maxLength: 50 }),
}).chain((base) =>
  fc
    .dictionary(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ maxLength: 100 }),
      { minKeys: 0, maxKeys: 5 },
    )
    .map((extra) => ({ ...extra, ...base })),
);

// ---------------------------------------------------------------------------
// Reference cosine similarity (for property verification)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Property 1: Self-similarity
// cosine_similarity(v, v) should be approximately 1.0 for any non-zero vector.
// ---------------------------------------------------------------------------
describe('Property 1: Self-similarity', () => {
  it('should return similarity close to 1.0 when a non-zero vector is compared to itself', () => {
    fc.assert(
      fc.property(
        dimensionArb,
        fc.context(),
        (dim, _ctx) => {
          // Generate a non-zero vector of the chosen dimension
          fc.assert(
            fc.property(
              nonZeroVectorOfDim(dim),
              (vec) => {
                const store = freshStore();
                try {
                  store.store('self-test', vec, { model: 'test' });
                  const results: VectorSearchResult[] = store.search(vec, 1, 0.0);

                  expect(results).toHaveLength(1);
                  expect(results[0].similarity).toBeCloseTo(1.0, 5);
                } finally {
                  store.close();
                }
              },
            ),
            { numRuns: 5 }, // inner loop kept small since outer varies dimension
          );
        },
      ),
      { numRuns: 10 },
    );
  });

  // Direct version without nested property (simpler, more focused)
  it('should produce self-similarity close to 1.0 for arbitrary non-zero vectors', () => {
    fc.assert(
      fc.property(
        nonZeroVectorOfDim(8),
        (vec) => {
          const store = freshStore();
          try {
            store.store('self-sim', vec, { model: 'test' });
            const results: VectorSearchResult[] = store.search(vec, 1, 0.0);

            expect(results).toHaveLength(1);
            expect(results[0].similarity).toBeCloseTo(1.0, 5);
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
// Property 2: Symmetry
// similarity(a, b) = similarity(b, a)
// ---------------------------------------------------------------------------
describe('Property 2: Symmetry', () => {
  it('should produce the same similarity regardless of query/stored order', () => {
    fc.assert(
      fc.property(
        nonZeroVectorOfDim(8),
        nonZeroVectorOfDim(8),
        (vecA, vecB) => {
          // Test 1: store A, search with B
          const store1 = freshStore();
          let simAB: number;
          try {
            store1.store('a', vecA, { model: 'test' });
            const results1: VectorSearchResult[] = store1.search(vecB, 1, -1.0);
            expect(results1).toHaveLength(1);
            simAB = results1[0].similarity;
          } finally {
            store1.close();
          }

          // Test 2: store B, search with A
          const store2 = freshStore();
          let simBA: number;
          try {
            store2.store('b', vecB, { model: 'test' });
            const results2: VectorSearchResult[] = store2.search(vecA, 1, -1.0);
            expect(results2).toHaveLength(1);
            simBA = results2[0].similarity;
          } finally {
            store2.close();
          }

          // Symmetry: similarities should be equal within floating point tolerance
          expect(simAB).toBeCloseTo(simBA, 10);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Range
// Cosine similarity must be in [-1, 1] for any input vectors.
// ---------------------------------------------------------------------------
describe('Property 3: Range [-1, 1]', () => {
  it('should always produce similarity values within [-1, 1]', () => {
    fc.assert(
      fc.property(
        nonZeroVectorOfDim(8),
        nonZeroVectorOfDim(8),
        (stored, query) => {
          const store = freshStore();
          try {
            store.store('rangetest', stored, { model: 'test' });
            const results: VectorSearchResult[] = store.search(query, 1, -1.0);

            expect(results).toHaveLength(1);
            expect(results[0].similarity).toBeGreaterThanOrEqual(-1.0 - 1e-10);
            expect(results[0].similarity).toBeLessThanOrEqual(1.0 + 1e-10);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Store/search round-trip
// A stored vector should always be findable when searching with itself
// using minSimilarity=0.99 (since self-similarity is 1.0).
// ---------------------------------------------------------------------------
describe('Property 4: Store/search round-trip', () => {
  it('should always find a stored non-zero vector when searching with itself (minSimilarity=0.99)', () => {
    fc.assert(
      fc.property(
        idArb,
        nonZeroVectorOfDim(16),
        (id, vec) => {
          const store = freshStore();
          try {
            store.store(id, vec, { model: 'roundtrip' });
            const results: VectorSearchResult[] = store.search(vec, 10, 0.99);

            // The stored vector must appear in results
            expect(results.length).toBeGreaterThanOrEqual(1);

            const found = results.find((r: VectorSearchResult) => r.id === id);
            expect(found).toBeDefined();
            expect(found!.similarity).toBeCloseTo(1.0, 5);
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
// Property 5: topK bound
// Search should never return more than topK results.
// ---------------------------------------------------------------------------
describe('Property 5: topK bound', () => {
  it('should never return more than topK results regardless of how many vectors are stored', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),  // topK
        fc.integer({ min: 1, max: 20 }),  // number of vectors to store
        (topK, count) => {
          const store = freshStore();
          try {
            // Store `count` vectors
            for (let i = 0; i < count; i++) {
              // Create vectors that are all somewhat similar to query
              const vec = new Array(4).fill(0) as number[];
              vec[0] = 1;
              vec[1] = 0.1 * i;
              store.store(`vec-${i}`, vec, { model: 'test' });
            }

            const results: VectorSearchResult[] = store.search([1, 0, 0, 0], topK, -1.0);

            expect(results.length).toBeLessThanOrEqual(topK);
            // Also: result count should not exceed actual stored count
            expect(results.length).toBeLessThanOrEqual(count);
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
// Property 6: Delete consistency
// After deleting a vector, it must not appear in search results.
// ---------------------------------------------------------------------------
describe('Property 6: Delete consistency', () => {
  it('should never return a deleted vector in search results', () => {
    fc.assert(
      fc.property(
        idArb,
        nonZeroVectorOfDim(4),
        (id, vec) => {
          const store = freshStore();
          try {
            store.store(id, vec, { model: 'test' });

            // Verify it exists
            const beforeDelete: VectorSearchResult[] = store.search(vec, 10, 0.0);
            const foundBefore = beforeDelete.find((r: VectorSearchResult) => r.id === id);
            expect(foundBefore).toBeDefined();

            // Delete it
            store.delete(id);

            // Verify it is gone
            const afterDelete: VectorSearchResult[] = store.search(vec, 10, -1.0);
            const foundAfter = afterDelete.find((r: VectorSearchResult) => r.id === id);
            expect(foundAfter).toBeUndefined();
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
// Property 7: Metadata round-trip
// Metadata stored with a vector must be preserved exactly when retrieved.
// ---------------------------------------------------------------------------
describe('Property 7: Metadata round-trip', () => {
  it('should preserve metadata exactly through a store/search cycle', () => {
    fc.assert(
      fc.property(
        idArb,
        nonZeroVectorOfDim(4),
        metadataArb,
        (id, vec, metadata) => {
          const store = freshStore();
          try {
            store.store(id, vec, metadata);
            const results: VectorSearchResult[] = store.search(vec, 1, 0.99);

            expect(results.length).toBeGreaterThanOrEqual(1);

            const found = results.find((r: VectorSearchResult) => r.id === id);
            expect(found).toBeDefined();
            expect(found!.metadata).toEqual(metadata);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should always preserve the model field in metadata', () => {
    fc.assert(
      fc.property(
        idArb,
        nonZeroVectorOfDim(4),
        fc.string({ minLength: 1, maxLength: 50 }), // model name
        (id, vec, modelName) => {
          const store = freshStore();
          try {
            const metadata = { model: modelName };
            store.store(id, vec, metadata);
            const results: VectorSearchResult[] = store.search(vec, 1, 0.99);

            expect(results.length).toBeGreaterThanOrEqual(1);

            const found = results.find((r: VectorSearchResult) => r.id === id);
            expect(found).toBeDefined();
            expect(found!.metadata.model).toBe(modelName);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
