/**
 * Unit Tests for Frustration Analyzer
 *
 * TDD RED phase: These tests define the expected behavior of the
 * analyzeFrustration function BEFORE the implementation exists.
 * All tests are expected to FAIL until src/analysis/frustration-analyzer.ts
 * is implemented.
 *
 * How analyzeFrustration works (specification):
 *   1. Calls llmProvider.generateCompletion(PROMPTS.frustrationAnalysis, prompt)
 *   2. Parses the LLM response as JSON (handling markdown fences like ```json ... ```)
 *   3. Validates with FrustrationAnalysisSchema (Zod safeParse)
 *   4. Returns the parsed FrustrationAnalysis object
 *   5. On ANY failure (invalid JSON, Zod validation fail, LLM error):
 *      returns fallback { type: 'normal', confidence: 0, reasoning: '' }
 *   6. Never throws
 *
 * Test categories:
 *   1. Valid JSON response -> correct parsing
 *   2. Markdown-fenced JSON -> strip fence then parse
 *   3. Invalid JSON -> fallback
 *   4. LLM throws error -> fallback
 *   5. Zod validation failure (missing/invalid fields) -> fallback
 *   6. System prompt verification
 *   7. User prompt passthrough verification
 *   8. All optional fields present -> preserved in result
 *   9. Only required fields present -> optional fields remain undefined
 */

import { analyzeFrustration } from '../../src/analysis/frustration-analyzer';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import { PROMPTS } from '../../src/llm/prompts';
import { FrustrationAnalysisSchema } from '../../src/types/index';
import type { FrustrationAnalysis } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid FrustrationAnalysis JSON response with all fields. */
const VALID_FULL_RESPONSE = JSON.stringify({
  type: 'frustrated',
  confidence: 0.85,
  intent: 'User is trying to fix a build error that keeps recurring',
  context: 'The user has attempted npm install multiple times without success',
  reasoning: 'The use of "again" and "still failing" indicates repeated failed attempts',
});

/** A valid FrustrationAnalysis JSON response with only required fields. */
const VALID_MINIMAL_RESPONSE = JSON.stringify({
  type: 'normal',
  confidence: 0.95,
  reasoning: 'This is a straightforward refactoring request with no frustration indicators',
});

/** The expected fallback result when any error occurs. */
const FALLBACK_RESULT: FrustrationAnalysis = {
  type: 'normal',
  confidence: 0,
  reasoning: '',
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('FrustrationAnalyzer - analyzeFrustration', () => {
  let mockProvider: MockLLMProvider;

  beforeEach(() => {
    mockProvider = new MockLLMProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Valid JSON response -> correct parsing
  // =========================================================================
  describe('Valid JSON response parsing', () => {
    it('should parse a valid full JSON response with all fields correctly', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(VALID_FULL_RESPONSE);

      // Act
      const result = await analyzeFrustration('This build error keeps happening again!', mockProvider);

      // Assert
      expect(result.type).toBe('frustrated');
      expect(result.confidence).toBeCloseTo(0.85);
      expect(result.intent).toBe('User is trying to fix a build error that keeps recurring');
      expect(result.context).toBe('The user has attempted npm install multiple times without success');
      expect(result.reasoning).toBe('The use of "again" and "still failing" indicates repeated failed attempts');
    });

    it('should return a result that validates against FrustrationAnalysisSchema', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(VALID_FULL_RESPONSE);

      // Act
      const result = await analyzeFrustration('Some frustrated prompt', mockProvider);

      // Assert
      const parseResult = FrustrationAnalysisSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should correctly parse each of the four type values', async () => {
      const types = ['normal', 'frustrated', 'resolution', 'abandonment'] as const;

      for (const type of types) {
        // Arrange
        const response = JSON.stringify({
          type,
          confidence: 0.9,
          reasoning: `Classified as ${type}`,
        });
        jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(response);

        // Act
        const result = await analyzeFrustration('test prompt', mockProvider);

        // Assert
        expect(result.type).toBe(type);

        // Restore for next iteration
        jest.restoreAllMocks();
      }
    });

    it('should correctly parse confidence values at boundaries (0 and 1)', async () => {
      // Test confidence = 0
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({ type: 'normal', confidence: 0, reasoning: 'No indicators' }),
      );
      let result = await analyzeFrustration('hello', mockProvider);
      expect(result.confidence).toBe(0);
      jest.restoreAllMocks();

      // Test confidence = 1
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({ type: 'frustrated', confidence: 1, reasoning: 'Extremely clear frustration' }),
      );
      result = await analyzeFrustration('This is infuriating!', mockProvider);
      expect(result.confidence).toBe(1);
    });
  });

  // =========================================================================
  // 2. Markdown-fenced JSON -> strip fence then parse
  // =========================================================================
  describe('Markdown-fenced JSON response', () => {
    it('should parse JSON wrapped in ```json ... ``` fences', async () => {
      // Arrange
      const fencedResponse =
        '```json\n' +
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.7,
          intent: 'Debugging a recurring error',
          context: 'Third attempt at fixing the import',
          reasoning: 'Repeated failure pattern detected',
        }) +
        '\n```';
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(fencedResponse);

      // Act
      const result = await analyzeFrustration('This import error keeps coming back', mockProvider);

      // Assert
      expect(result.type).toBe('frustrated');
      expect(result.confidence).toBeCloseTo(0.7);
      expect(result.reasoning).toBe('Repeated failure pattern detected');
    });

    it('should parse JSON wrapped in ``` ... ``` fences (without json label)', async () => {
      // Arrange
      const fencedResponse =
        '```\n' +
        JSON.stringify({
          type: 'resolution',
          confidence: 0.8,
          reasoning: 'User confirmed the fix works',
        }) +
        '\n```';
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(fencedResponse);

      // Act
      const result = await analyzeFrustration('It works now, the fix was correct', mockProvider);

      // Assert
      expect(result.type).toBe('resolution');
      expect(result.confidence).toBeCloseTo(0.8);
    });

    it('should handle JSON fence with leading/trailing whitespace', async () => {
      // Arrange
      const fencedResponse =
        '  ```json  \n' +
        JSON.stringify({
          type: 'abandonment',
          confidence: 0.6,
          reasoning: 'User is giving up on this approach',
        }) +
        '\n  ```  ';
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(fencedResponse);

      // Act
      const result = await analyzeFrustration('Forget it, let me try something else', mockProvider);

      // Assert
      expect(result.type).toBe('abandonment');
      expect(result.confidence).toBeCloseTo(0.6);
    });

    it('should handle LLM response with text before/after JSON fence', async () => {
      // Arrange: Some LLMs add explanation text around the JSON block
      const responseWithText =
        'Here is my analysis:\n\n```json\n' +
        JSON.stringify({
          type: 'normal',
          confidence: 0.9,
          reasoning: 'Standard development request',
        }) +
        '\n```\n\nHope this helps!';
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(responseWithText);

      // Act
      const result = await analyzeFrustration('Can you add a unit test for this function?', mockProvider);

      // Assert
      expect(result.type).toBe('normal');
      expect(result.confidence).toBeCloseTo(0.9);
    });
  });

  // =========================================================================
  // Think block handling
  // =========================================================================
  describe('Think block handling', () => {
    it('should parse JSON after stripping <think> block', async () => {
      const thinkResponse =
        '<think>The user seems frustrated because they mentioned the error again.</think>' +
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.9,
          reasoning: 'Repeated error pattern',
        });
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(thinkResponse);

      const result = await analyzeFrustration('This error again!', mockProvider);

      expect(result.type).toBe('frustrated');
      expect(result.confidence).toBeCloseTo(0.9);
    });

    it('should handle <think> block followed by markdown-fenced JSON', async () => {
      const thinkFenceResponse =
        '<think>Let me analyze this prompt.</think>\n```json\n' +
        JSON.stringify({
          type: 'normal',
          confidence: 0.8,
          reasoning: 'Standard request',
        }) +
        '\n```';
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(thinkFenceResponse);

      const result = await analyzeFrustration('Add a unit test', mockProvider);

      expect(result.type).toBe('normal');
      expect(result.confidence).toBeCloseTo(0.8);
    });
  });

  // =========================================================================
  // 3. Invalid JSON -> fallback
  // =========================================================================
  describe('Invalid JSON response -> fallback', () => {
    it('should return fallback when LLM returns plain text (not JSON)', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        'The user seems frustrated because they mentioned the error happened again.',
      );

      // Act
      const result = await analyzeFrustration('This error happened again', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when LLM returns malformed JSON', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        '{ "type": "frustrated", confidence: 0.8, }', // invalid JSON: unquoted key, trailing comma
      );

      // Act
      const result = await analyzeFrustration('broken build', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when LLM returns an empty string', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue('');

      // Act
      const result = await analyzeFrustration('some prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when LLM returns a JSON array instead of object', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify([{ type: 'frustrated', confidence: 0.8, reasoning: 'wrong shape' }]),
      );

      // Act
      const result = await analyzeFrustration('some prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when LLM returns a JSON number', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue('42');

      // Act
      const result = await analyzeFrustration('some prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });
  });

  // =========================================================================
  // 4. LLM throws error -> fallback
  // =========================================================================
  describe('LLM provider throws error -> fallback', () => {
    it('should return fallback when generateCompletion throws', async () => {
      // Arrange
      const failProvider = new MockLLMProvider({ shouldFail: true });

      // Act
      const result = await analyzeFrustration('Any prompt', failProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should never throw even when the LLM provider throws', async () => {
      // Arrange
      const failProvider = new MockLLMProvider({ shouldFail: true });

      // Act & Assert: must resolve, never reject
      await expect(
        analyzeFrustration('Any prompt', failProvider),
      ).resolves.toBeDefined();
    });

    it('should return fallback when generateCompletion rejects with a non-Error value', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockRejectedValue('string error');

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when generateCompletion rejects with null', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockRejectedValue(null);

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });
  });

  // =========================================================================
  // 5. Zod validation failure -> fallback
  // =========================================================================
  describe('Zod validation failure -> fallback', () => {
    it('should return fallback when type field is missing', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          confidence: 0.8,
          reasoning: 'Missing the type field',
        }),
      );

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when type is an invalid enum value', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'angry', // not one of normal|frustrated|resolution|abandonment
          confidence: 0.8,
          reasoning: 'Invalid type value',
        }),
      );

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when confidence is missing', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'frustrated',
          reasoning: 'Missing confidence field',
        }),
      );

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when confidence is out of range (> 1)', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'frustrated',
          confidence: 1.5, // out of range
          reasoning: 'Confidence too high',
        }),
      );

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when confidence is out of range (< 0)', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'normal',
          confidence: -0.1, // out of range
          reasoning: 'Negative confidence',
        }),
      );

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when reasoning field is missing', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'normal',
          confidence: 0.9,
          // reasoning is required but missing
        }),
      );

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });

    it('should return fallback when confidence is a string instead of number', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'frustrated',
          confidence: 'high', // wrong type
          reasoning: 'Confidence is a string',
        }),
      );

      // Act
      const result = await analyzeFrustration('prompt', mockProvider);

      // Assert
      expect(result).toEqual(FALLBACK_RESULT);
    });
  });

  // =========================================================================
  // 6. System prompt verification
  // =========================================================================
  describe('System prompt verification', () => {
    it('should pass PROMPTS.frustrationAnalysis as the system prompt to generateCompletion', async () => {
      // Arrange
      const completionSpy = jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        VALID_FULL_RESPONSE,
      );

      // Act
      await analyzeFrustration('test prompt', mockProvider);

      // Assert
      expect(completionSpy).toHaveBeenCalledTimes(1);
      const [systemPrompt] = completionSpy.mock.calls[0];
      expect(systemPrompt).toBe(PROMPTS.frustrationAnalysis);
    });
  });

  // =========================================================================
  // 7. User prompt passthrough verification
  // =========================================================================
  describe('User prompt passthrough verification', () => {
    it('should pass the user prompt as the second argument to generateCompletion', async () => {
      // Arrange
      const completionSpy = jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        VALID_MINIMAL_RESPONSE,
      );
      const userPrompt = 'Why does this TypeScript error keep appearing?';

      // Act
      await analyzeFrustration(userPrompt, mockProvider);

      // Assert
      expect(completionSpy).toHaveBeenCalledTimes(1);
      const [, passedUserPrompt] = completionSpy.mock.calls[0];
      expect(passedUserPrompt).toBe(userPrompt);
    });

    it('should pass the exact prompt string without modification', async () => {
      // Arrange
      const completionSpy = jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        VALID_MINIMAL_RESPONSE,
      );
      const complexPrompt = 'This build error keeps happening... Cannot find module "lodash" (third attempt)';

      // Act
      await analyzeFrustration(complexPrompt, mockProvider);

      // Assert
      const [, passedUserPrompt] = completionSpy.mock.calls[0];
      expect(passedUserPrompt).toBe(complexPrompt);
    });

    it('should pass an empty string prompt through unchanged', async () => {
      // Arrange
      const completionSpy = jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        VALID_MINIMAL_RESPONSE,
      );

      // Act
      await analyzeFrustration('', mockProvider);

      // Assert
      const [, passedUserPrompt] = completionSpy.mock.calls[0];
      expect(passedUserPrompt).toBe('');
    });
  });

  // =========================================================================
  // 8. All optional fields present -> preserved in result
  // =========================================================================
  describe('All optional fields present', () => {
    it('should preserve intent and context when both are present in LLM response', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.75,
          intent: 'Trying to fix a webpack configuration issue',
          context: 'User has been working on this for 2 hours based on message history',
          reasoning: 'Multiple retry indicators and explicit mention of time spent',
        }),
      );

      // Act
      const result = await analyzeFrustration('I have been at this for 2 hours', mockProvider);

      // Assert
      expect(result.intent).toBe('Trying to fix a webpack configuration issue');
      expect(result.context).toBe('User has been working on this for 2 hours based on message history');
      expect(result.type).toBe('frustrated');
      expect(result.confidence).toBeCloseTo(0.75);
      expect(result.reasoning).toBe('Multiple retry indicators and explicit mention of time spent');
    });

    it('should preserve errorKeyword when present in LLM response', async () => {
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'frustrated',
          confidence: 0.85,
          intent: 'Fix build error',
          context: 'Third retry',
          errorKeyword: 'Module not found: ./missing-module',
          reasoning: 'Repeated failure',
        }),
      );

      const result = await analyzeFrustration('This module error again!', mockProvider);

      expect(result.errorKeyword).toBe('Module not found: ./missing-module');
    });

    it('should leave errorKeyword undefined when not present in LLM response', async () => {
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'normal',
          confidence: 0.9,
          reasoning: 'Standard request',
        }),
      );

      const result = await analyzeFrustration('Add a test', mockProvider);

      expect(result.errorKeyword).toBeUndefined();
    });
  });

  // =========================================================================
  // 9. Only required fields present -> optional fields remain undefined
  // =========================================================================
  describe('Only required fields present', () => {
    it('should leave intent undefined when not present in LLM response', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        VALID_MINIMAL_RESPONSE,
      );

      // Act
      const result = await analyzeFrustration('Can you refactor this?', mockProvider);

      // Assert
      expect(result.type).toBe('normal');
      expect(result.confidence).toBeCloseTo(0.95);
      expect(result.reasoning).toBe('This is a straightforward refactoring request with no frustration indicators');
      expect(result.intent).toBeUndefined();
      expect(result.context).toBeUndefined();
    });

    it('should leave context undefined when only intent is present', async () => {
      // Arrange
      jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        JSON.stringify({
          type: 'normal',
          confidence: 0.8,
          intent: 'Requesting code review',
          reasoning: 'Straightforward review request',
        }),
      );

      // Act
      const result = await analyzeFrustration('Please review this PR', mockProvider);

      // Assert
      expect(result.intent).toBe('Requesting code review');
      expect(result.context).toBeUndefined();
    });
  });

  // =========================================================================
  // Edge cases: never throw guarantee
  // =========================================================================
  describe('Never-throw guarantee', () => {
    it('should not throw for any valid string input (default MockLLMProvider returns non-JSON)', async () => {
      // Arrange: default MockLLMProvider returns "mock-completion: ..." which is not JSON
      // This means JSON parsing will fail, and the fallback should be returned

      // Act & Assert
      await expect(
        analyzeFrustration('any prompt at all', mockProvider),
      ).resolves.toBeDefined();
    });

    it('should always return a result with all required fields', async () => {
      // Arrange: default MockLLMProvider returns non-JSON -> fallback
      // Act
      const result = await analyzeFrustration('test', mockProvider);

      // Assert: even fallback must have all required fields
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasoning');
      expect(['normal', 'frustrated', 'resolution', 'abandonment']).toContain(result.type);
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.reasoning).toBe('string');
    });

    it('should make exactly one call to generateCompletion per invocation', async () => {
      // Arrange
      const completionSpy = jest.spyOn(mockProvider, 'generateCompletion').mockResolvedValue(
        VALID_FULL_RESPONSE,
      );

      // Act
      await analyzeFrustration('single call test', mockProvider);

      // Assert
      expect(completionSpy).toHaveBeenCalledTimes(1);
    });
  });
});
