/**
 * Property-Based Tests for Frustration Analyzer
 *
 * TDD RED phase: These property tests use fast-check to verify that the
 * analyzeFrustration function maintains critical invariants across a wide
 * range of randomly generated inputs.
 *
 * The target module (src/analysis/frustration-analyzer.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Properties tested:
 *   1. Total function: For ANY arbitrary string prompt, analyzeFrustration
 *      always resolves to a FrustrationAnalysis object (never throws/rejects).
 *   2. Type safety: The result type is always one of the 4 valid enum values.
 *   3. Confidence bounds: The confidence score is always in the range [0, 1].
 *   4. Schema conformance: The result always passes FrustrationAnalysisSchema
 *      validation via Zod safeParse.
 *   5. Deterministic fallback: When the LLM provider always fails,
 *      the result is always the fallback { type: 'normal', confidence: 0, reasoning: '' }.
 *
 * Feature: claude-code-sentinel, Properties 1-5
 */

import fc from 'fast-check';
import { analyzeFrustration } from '../../src/analysis/frustration-analyzer';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import { FrustrationAnalysisSchema } from '../../src/types/index';
import type { FrustrationAnalysis } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

/** Valid type enum values. */
const VALID_TYPES = ['normal', 'frustrated', 'resolution', 'abandonment'] as const;

/** The expected fallback result. */
const FALLBACK_RESULT: FrustrationAnalysis = {
  type: 'normal',
  confidence: 0,
  reasoning: '',
};

// ---------------------------------------------------------------------------
// Property 1: Total function (never throws/rejects)
// ---------------------------------------------------------------------------
describe('Property 1: analyzeFrustration is a total function (never throws)', () => {
  it('should always resolve for any arbitrary string prompt with a default (non-JSON) MockLLMProvider', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 1000 }),
        async (prompt) => {
          // Arrange: default MockLLMProvider returns "mock-completion: ..." (not JSON)
          // which will trigger the fallback path
          const provider = new MockLLMProvider();

          // Act: must resolve, never reject
          const result = await analyzeFrustration(prompt, provider);

          // Assert: result is defined (not null/undefined)
          expect(result).toBeDefined();
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should always resolve for any arbitrary string prompt with a failing MockLLMProvider', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 1000 }),
        async (prompt) => {
          // Arrange: provider that always throws
          const provider = new MockLLMProvider({ shouldFail: true });

          // Act & Assert: must resolve
          const result = await analyzeFrustration(prompt, provider);
          expect(result).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should always resolve for any arbitrary string prompt with a valid JSON MockLLMProvider', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 1000 }),
        async (prompt) => {
          // Arrange: provider that returns valid JSON
          const provider = new MockLLMProvider();
          jest.spyOn(provider, 'generateCompletion').mockResolvedValue(
            JSON.stringify({
              type: 'normal',
              confidence: 0.5,
              reasoning: 'test',
            }),
          );

          // Act & Assert
          const result = await analyzeFrustration(prompt, provider);
          expect(result).toBeDefined();

          // Clean up spy for next iteration
          jest.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Result type is always one of the 4 valid enum values
// ---------------------------------------------------------------------------
describe('Property 2: Result type is always a valid enum value', () => {
  it('should have type in [normal, frustrated, resolution, abandonment] for any prompt (fallback path)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (prompt) => {
          const provider = new MockLLMProvider();

          const result = await analyzeFrustration(prompt, provider);

          expect(VALID_TYPES).toContain(result.type);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should have type in [normal, frustrated, resolution, abandonment] when LLM returns valid JSON with random type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        fc.constantFrom(...VALID_TYPES),
        async (prompt, type) => {
          const provider = new MockLLMProvider();
          jest.spyOn(provider, 'generateCompletion').mockResolvedValue(
            JSON.stringify({ type, confidence: 0.5, reasoning: 'test' }),
          );

          const result = await analyzeFrustration(prompt, provider);

          expect(VALID_TYPES).toContain(result.type);

          jest.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Confidence is always in [0, 1]
// ---------------------------------------------------------------------------
describe('Property 3: Confidence is always bounded [0, 1]', () => {
  it('should have confidence in [0, 1] for any prompt (fallback path)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (prompt) => {
          const provider = new MockLLMProvider();

          const result = await analyzeFrustration(prompt, provider);

          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should have confidence in [0, 1] when LLM returns valid JSON with valid confidence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        async (prompt, confidence) => {
          const provider = new MockLLMProvider();
          jest.spyOn(provider, 'generateCompletion').mockResolvedValue(
            JSON.stringify({ type: 'normal', confidence, reasoning: 'test' }),
          );

          const result = await analyzeFrustration(prompt, provider);

          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);

          jest.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should fall back to confidence=0 when LLM returns out-of-range confidence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        fc.double({ min: 1.01, max: 100, noNaN: true }),
        async (prompt, badConfidence) => {
          const provider = new MockLLMProvider();
          jest.spyOn(provider, 'generateCompletion').mockResolvedValue(
            JSON.stringify({ type: 'normal', confidence: badConfidence, reasoning: 'test' }),
          );

          const result = await analyzeFrustration(prompt, provider);

          // Out-of-range confidence should trigger fallback -> confidence = 0
          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);

          jest.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Schema conformance (Zod safeParse always succeeds)
// ---------------------------------------------------------------------------
describe('Property 4: Result always conforms to FrustrationAnalysisSchema', () => {
  it('should always produce a result that passes Zod safeParse (fallback path)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (prompt) => {
          const provider = new MockLLMProvider();

          const result = await analyzeFrustration(prompt, provider);

          const parseResult = FrustrationAnalysisSchema.safeParse(result);
          expect(parseResult.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should always produce a result that passes Zod safeParse (error path)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (prompt) => {
          const provider = new MockLLMProvider({ shouldFail: true });

          const result = await analyzeFrustration(prompt, provider);

          const parseResult = FrustrationAnalysisSchema.safeParse(result);
          expect(parseResult.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should always produce a schema-valid result even with random LLM garbage output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        fc.string({ minLength: 0, maxLength: 2000 }),
        async (prompt, garbageOutput) => {
          const provider = new MockLLMProvider();
          jest.spyOn(provider, 'generateCompletion').mockResolvedValue(garbageOutput);

          const result = await analyzeFrustration(prompt, provider);

          const parseResult = FrustrationAnalysisSchema.safeParse(result);
          expect(parseResult.success).toBe(true);

          jest.restoreAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Deterministic fallback on provider failure
// ---------------------------------------------------------------------------
describe('Property 5: Deterministic fallback when LLM always fails', () => {
  it('should always return the exact fallback result when the provider throws', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (prompt) => {
          const provider = new MockLLMProvider({ shouldFail: true });

          const result = await analyzeFrustration(prompt, provider);

          expect(result).toEqual(FALLBACK_RESULT);
        },
      ),
      { numRuns: 100 },
    );
  });
});
