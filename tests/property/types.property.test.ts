/**
 * Property-Based Tests for Types & Zod Schemas
 *
 * TDD RED phase: These property tests use fast-check to verify that schemas
 * behave correctly across a wide range of randomly generated inputs.
 *
 * The target module (src/types/index.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Properties tested:
 *   1. TranscriptMessage: valid role + valid string content always parses
 *   2. FrustrationAnalysis: valid type + valid confidence + valid reasoning always parses
 *   3. FrustrationAnalysis boundary: confidence outside [0,1] always fails
 *   4. ToolCallEntry: valid string name + any input always parses
 *   5. AutoMemoryCandidate status: only valid status values parse; random strings fail
 *   6. SentinelSettings provider: only 'ollama'|'bedrock' are valid
 *   7. SentinelSettings enabled: boolean field defaults to true, always accepts booleans
 */

import fc from 'fast-check';
import * as z from 'zod';

import {
  TranscriptMessageSchema,
  ToolCallEntrySchema,
  TranscriptDataSchema,
  FailureExperienceSchema,
  AutoMemoryCandidateSchema,
  FrustrationAnalysisSchema,
  MatchResultSchema,
  SentinelSettingsSchema,
} from '../../src/types/index';

// ---------------------------------------------------------------------------
// Property 1: TranscriptMessage - valid role + string content always parses
// ---------------------------------------------------------------------------
describe('Property 1: TranscriptMessage round-trip validity', () => {
  it('should always parse when role is a valid enum value and content is a string', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('user', 'assistant', 'system'),
        fc.string(),
        (role, content) => {
          const result = TranscriptMessageSchema.safeParse({ role, content });
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.role).toBe(role);
            expect(result.data.content).toBe(content);
          }
        },
      ),
    );
  });

  it('should always parse with an optional timestamp string', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('user', 'assistant', 'system'),
        fc.string(),
        fc.option(fc.string(), { nil: undefined }),
        (role, content, timestamp) => {
          const input: Record<string, unknown> = { role, content };
          if (timestamp !== undefined) {
            input.timestamp = timestamp;
          }
          const result = TranscriptMessageSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
    );
  });

  it('should always reject when role is not one of the valid enum values', () => {
    fc.assert(
      fc.property(
        fc.string().filter(
          (s) => !['user', 'assistant', 'system'].includes(s),
        ),
        fc.string(),
        (invalidRole, content) => {
          const result = TranscriptMessageSchema.safeParse({
            role: invalidRole,
            content,
          });
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: FrustrationAnalysis - valid type + valid confidence + reasoning always parses
// ---------------------------------------------------------------------------
describe('Property 2: FrustrationAnalysis always parses with valid inputs', () => {
  it('should always parse when type is valid, confidence is in [0,1], and reasoning is a string', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('normal', 'frustrated', 'resolution', 'abandonment'),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.string({ minLength: 1 }),
        (type, confidence, reasoning) => {
          const result = FrustrationAnalysisSchema.safeParse({
            type,
            confidence,
            reasoning,
          });
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.type).toBe(type);
            expect(result.data.confidence).toBe(confidence);
            expect(result.data.reasoning).toBe(reasoning);
          }
        },
      ),
    );
  });

  it('should always parse with optional intent and context fields', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('normal', 'frustrated', 'resolution', 'abandonment'),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.string({ minLength: 1 }),
        fc.option(fc.string(), { nil: undefined }),
        fc.option(fc.string(), { nil: undefined }),
        (type, confidence, reasoning, intent, context) => {
          const input: Record<string, unknown> = {
            type,
            confidence,
            reasoning,
          };
          if (intent !== undefined) input.intent = intent;
          if (context !== undefined) input.context = context;

          const result = FrustrationAnalysisSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: FrustrationAnalysis boundary - confidence outside [0,1] always fails
// ---------------------------------------------------------------------------
describe('Property 3: FrustrationAnalysis confidence boundary enforcement', () => {
  it('should always reject when confidence is greater than 1', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('normal', 'frustrated', 'resolution', 'abandonment'),
        // Generate doubles strictly greater than 1 (up to a large value)
        fc.double({ min: 1.0000001, max: 1e10, noNaN: true }),
        fc.string({ minLength: 1 }),
        (type, confidence, reasoning) => {
          const result = FrustrationAnalysisSchema.safeParse({
            type,
            confidence,
            reasoning,
          });
          expect(result.success).toBe(false);
        },
      ),
    );
  });

  it('should always reject when confidence is negative', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('normal', 'frustrated', 'resolution', 'abandonment'),
        // Generate doubles strictly less than 0
        fc.double({ min: -1e10, max: -0.0000001, noNaN: true }),
        fc.string({ minLength: 1 }),
        (type, confidence, reasoning) => {
          const result = FrustrationAnalysisSchema.safeParse({
            type,
            confidence,
            reasoning,
          });
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: ToolCallEntry - valid string name + any input always parses
// ---------------------------------------------------------------------------
describe('Property 4: ToolCallEntry always parses with valid name and any input', () => {
  it('should always parse when name is a string and input is any value', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.anything(),
        (name, input) => {
          const result = ToolCallEntrySchema.safeParse({ name, input });
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.name).toBe(name);
          }
        },
      ),
    );
  });

  it('should always parse with optional output and error strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.anything(),
        fc.option(fc.string(), { nil: undefined }),
        fc.option(fc.string(), { nil: undefined }),
        (name, input, output, error) => {
          const obj: Record<string, unknown> = { name, input };
          if (output !== undefined) obj.output = output;
          if (error !== undefined) obj.error = error;

          const result = ToolCallEntrySchema.safeParse(obj);
          expect(result.success).toBe(true);
        },
      ),
    );
  });

  it('should always reject when name is not a string', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
        ),
        fc.anything(),
        (invalidName, input) => {
          const result = ToolCallEntrySchema.safeParse({
            name: invalidName,
            input,
          });
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: AutoMemoryCandidate status - only valid values parse
// ---------------------------------------------------------------------------
describe('Property 5: AutoMemoryCandidate status enum enforcement', () => {
  const validCandidateBase = {
    id: 'draft-001',
    sessionId: 'session-abc',
    frustrationSignature: 'Error: test',
    failedApproaches: ['approach1'],
    lessons: ['lesson1'],
    createdAt: '2026-02-16T00:00:00Z',
  };

  it('should always parse when status is one of the three valid values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pending', 'confirmed', 'rejected'),
        (status) => {
          const input = { ...validCandidateBase, status };
          const result = AutoMemoryCandidateSchema.safeParse(input);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.status).toBe(status);
          }
        },
      ),
    );
  });

  it('should always reject when status is a random string not in the valid set', () => {
    fc.assert(
      fc.property(
        fc.string().filter(
          (s) => !['pending', 'confirmed', 'rejected'].includes(s),
        ),
        (invalidStatus) => {
          const input = { ...validCandidateBase, status: invalidStatus };
          const result = AutoMemoryCandidateSchema.safeParse(input);
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: SentinelSettings provider - only 'ollama'|'bedrock' are valid
// ---------------------------------------------------------------------------
describe('Property 6: SentinelSettings provider enum enforcement', () => {
  it('should always parse when provider is ollama or bedrock', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('ollama', 'bedrock'),
        (provider) => {
          const input = {
            llm: {
              provider,
              ollama: {},
            },
            storage: {},
          };
          const result = SentinelSettingsSchema.safeParse(input);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.llm.provider).toBe(provider);
          }
        },
      ),
    );
  });

  it('should always reject when provider is a random string not in the valid set', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !['ollama', 'bedrock'].includes(s)),
        (invalidProvider) => {
          const input = {
            llm: {
              provider: invalidProvider,
              ollama: {},
            },
            storage: {},
          };
          const result = SentinelSettingsSchema.safeParse(input);
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: SentinelSettings enabled field (RED phase - WILL FAIL)
//
// Feature: claude-code-sentinel, Property: enabled boolean field
//
// This property test validates that the `enabled` field on
// SentinelSettingsSchema behaves correctly:
//   - Always accepts boolean values (true/false)
//   - Defaults to true when omitted
//   - Rejects non-boolean values
// ---------------------------------------------------------------------------
describe('Property 7: SentinelSettings enabled field enforcement', () => {
  /** Minimal valid settings base (without `enabled`) for schema parsing */
  const minimalSettingsBase = {
    llm: {
      provider: 'ollama' as const,
      ollama: {},
    },
    storage: {},
  };

  it('should always parse when enabled is a boolean (true or false)', () => {
    // Property: for any boolean value, the schema should accept it and
    // preserve the exact value in the parsed output.
    fc.assert(
      fc.property(
        fc.boolean(),
        (enabled) => {
          const input = { ...minimalSettingsBase, enabled };
          const result = SentinelSettingsSchema.safeParse(input);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.enabled).toBe(enabled);
          }
        },
      ),
    );
  });

  it('should default to true when enabled is omitted', () => {
    // Property: when `enabled` is not present in the input, the parsed
    // output should have `enabled: true`.
    const result = SentinelSettingsSchema.safeParse(minimalSettingsBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
    }
  });

  it('should always reject when enabled is a non-boolean value', () => {
    // Property: for any value that is not a boolean (string, number, null,
    // undefined object, array), the schema should reject the input.
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.double({ noNaN: true }),
          fc.constant(null),
          fc.array(fc.anything()),
          fc.dictionary(fc.string(), fc.anything()),
        ),
        (nonBooleanValue) => {
          const input = { ...minimalSettingsBase, enabled: nonBooleanValue };
          const result = SentinelSettingsSchema.safeParse(input);
          expect(result.success).toBe(false);
        },
      ),
    );
  });

  it('should preserve enabled value alongside other valid settings', () => {
    // Property: for any valid provider + boolean enabled combination,
    // both fields should be correctly preserved in the parsed output.
    fc.assert(
      fc.property(
        fc.constantFrom('ollama', 'bedrock'),
        fc.boolean(),
        fc.boolean(),
        (provider, enabled, debug) => {
          const input = {
            llm: {
              provider,
              ollama: {},
            },
            storage: {},
            enabled,
            debug,
          };
          const result = SentinelSettingsSchema.safeParse(input);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.enabled).toBe(enabled);
            expect(result.data.debug).toBe(debug);
            expect(result.data.llm.provider).toBe(provider);
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Additional property: MatchResult confidence boundary
// ---------------------------------------------------------------------------
describe('Property: MatchResult confidence boundary enforcement', () => {
  const validExperience = {
    id: 'exp-001',
    frustrationSignature: 'Error: test',
    failedApproaches: ['approach1'],
    lessons: ['lesson1'],
    createdAt: '2026-02-16T00:00:00Z',
  };

  it('should always parse when confidence is in [0,1]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.string({ minLength: 1 }),
        (confidence, suggestedAction) => {
          const input = {
            experience: validExperience,
            confidence,
            suggestedAction,
          };
          const result = MatchResultSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
    );
  });

  it('should always reject when confidence is outside [0,1]', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: 1.0000001, max: 1e10, noNaN: true }),
          fc.double({ min: -1e10, max: -0.0000001, noNaN: true }),
        ),
        fc.string({ minLength: 1 }),
        (confidence, suggestedAction) => {
          const input = {
            experience: validExperience,
            confidence,
            suggestedAction,
          };
          const result = MatchResultSchema.safeParse(input);
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Additional property: FailureExperience with random valid data
// ---------------------------------------------------------------------------
describe('Property: FailureExperience always parses with valid random data', () => {
  it('should always parse with random strings for all required fields', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),           // id
        fc.string({ minLength: 1 }),           // frustrationSignature
        fc.array(fc.string()),                 // failedApproaches
        fc.array(fc.string()),                 // lessons
        fc.string({ minLength: 1 }),           // createdAt
        (id, frustrationSignature, failedApproaches, lessons, createdAt) => {
          const input = {
            id,
            frustrationSignature,
            failedApproaches,
            lessons,
            createdAt,
          };
          const result = FailureExperienceSchema.safeParse(input);
          expect(result.success).toBe(true);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Additional property: TranscriptData composition
// ---------------------------------------------------------------------------
describe('Property: TranscriptData always parses with valid composed data', () => {
  it('should always parse with arrays of valid TranscriptMessages and ToolCallEntries', () => {
    const messageArb = fc.record({
      role: fc.constantFrom('user', 'assistant', 'system'),
      content: fc.string(),
    });

    const toolCallArb = fc.record({
      name: fc.string({ minLength: 1 }),
      input: fc.anything(),
    });

    fc.assert(
      fc.property(
        fc.array(messageArb),
        fc.array(toolCallArb),
        fc.array(fc.string()),
        (messages, toolCalls, errors) => {
          const input = { messages, toolCalls, errors };
          const result = TranscriptDataSchema.safeParse(input);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.messages).toHaveLength(messages.length);
            expect(result.data.toolCalls).toHaveLength(toolCalls.length);
            expect(result.data.errors).toHaveLength(errors.length);
          }
        },
      ),
    );
  });
});
