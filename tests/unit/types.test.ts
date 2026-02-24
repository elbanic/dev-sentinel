/**
 * Unit Tests for Types & Zod Schemas
 *
 * TDD RED phase: These tests define the expected behavior of all Zod schemas
 * and TypeScript types exported from src/types/index.ts.
 *
 * The target module (src/types/index.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Schemas under test:
 *   - TranscriptMessageSchema / TranscriptMessage
 *   - ToolCallEntrySchema / ToolCallEntry
 *   - TranscriptDataSchema / TranscriptData
 *   - FailureExperienceSchema / FailureExperience
 *   - AutoMemoryCandidateSchema / AutoMemoryCandidate
 *   - FrustrationAnalysisSchema / FrustrationAnalysis
 *   - MatchResultSchema / MatchResult
 *   - SentinelSettingsSchema / SentinelSettings
 *   - LLMProvider (TypeScript interface)
 */

import * as z from 'zod';

import {
  TranscriptMessageSchema,
  ToolCallEntrySchema,
  TranscriptDataSchema,
  FailureExperienceSchema,
  ExperienceRevisionSchema,
  AutoMemoryCandidateSchema,
  FrustrationAnalysisSchema,
  MatchResultSchema,
  SentinelSettingsSchema,
  RecallSettingsSchema,
} from '../../src/types/index';

import type {
  TranscriptMessage,
  ToolCallEntry,
  TranscriptData,
  FailureExperience,
  AutoMemoryCandidate,
  FrustrationAnalysis,
  MatchResult,
  SentinelSettings,
  LLMProvider,
} from '../../src/types/index';

// ---------------------------------------------------------------------------
// 1. TranscriptMessageSchema
// ---------------------------------------------------------------------------
describe('TranscriptMessageSchema', () => {
  describe('valid input parsing', () => {
    it('should parse a valid user message', () => {
      const input = { role: 'user', content: 'Hello world' };
      const result = TranscriptMessageSchema.parse(input);
      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello world');
    });

    it('should parse a valid assistant message', () => {
      const input = { role: 'assistant', content: 'Sure, I can help.' };
      const result = TranscriptMessageSchema.parse(input);
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Sure, I can help.');
    });

    it('should parse a valid system message', () => {
      const input = { role: 'system', content: 'System prompt' };
      const result = TranscriptMessageSchema.parse(input);
      expect(result.role).toBe('system');
    });

    it('should parse a message with an optional timestamp', () => {
      const input = {
        role: 'user',
        content: 'Hi',
        timestamp: '2026-02-16T10:00:00Z',
      };
      const result = TranscriptMessageSchema.parse(input);
      expect(result.timestamp).toBe('2026-02-16T10:00:00Z');
    });

    it('should parse a message without a timestamp (optional field)', () => {
      const input = { role: 'user', content: 'Hi' };
      const result = TranscriptMessageSchema.parse(input);
      expect(result.timestamp).toBeUndefined();
    });
  });

  describe('invalid input rejection', () => {
    it('should reject an invalid role value', () => {
      const input = { role: 'bot', content: 'Hello' };
      const result = TranscriptMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when content is missing', () => {
      const input = { role: 'user' };
      const result = TranscriptMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when role is missing', () => {
      const input = { content: 'Hello' };
      const result = TranscriptMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when content is not a string', () => {
      const input = { role: 'user', content: 123 };
      const result = TranscriptMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. ToolCallEntrySchema
// ---------------------------------------------------------------------------
describe('ToolCallEntrySchema', () => {
  describe('valid input parsing', () => {
    it('should parse a minimal valid tool call (name + input only)', () => {
      const input = { name: 'read_file', input: { path: '/tmp/foo' } };
      const result = ToolCallEntrySchema.parse(input);
      expect(result.name).toBe('read_file');
      expect(result.input).toEqual({ path: '/tmp/foo' });
    });

    it('should parse a tool call with output', () => {
      const input = {
        name: 'bash',
        input: 'ls -la',
        output: 'file1.ts\nfile2.ts',
      };
      const result = ToolCallEntrySchema.parse(input);
      expect(result.output).toBe('file1.ts\nfile2.ts');
    });

    it('should parse a tool call with error', () => {
      const input = {
        name: 'bash',
        input: 'rm /nonexistent',
        error: 'No such file or directory',
      };
      const result = ToolCallEntrySchema.parse(input);
      expect(result.error).toBe('No such file or directory');
    });

    it('should accept any type for input (unknown)', () => {
      // input field is typed as unknown, so it should accept anything
      const withString = ToolCallEntrySchema.safeParse({
        name: 'tool',
        input: 'a string',
      });
      const withNumber = ToolCallEntrySchema.safeParse({
        name: 'tool',
        input: 42,
      });
      const withNull = ToolCallEntrySchema.safeParse({
        name: 'tool',
        input: null,
      });
      const withArray = ToolCallEntrySchema.safeParse({
        name: 'tool',
        input: [1, 2, 3],
      });

      expect(withString.success).toBe(true);
      expect(withNumber.success).toBe(true);
      expect(withNull.success).toBe(true);
      expect(withArray.success).toBe(true);
    });

    it('should allow both output and error to be omitted', () => {
      const input = { name: 'tool', input: {} };
      const result = ToolCallEntrySchema.parse(input);
      expect(result.output).toBeUndefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe('invalid input rejection', () => {
    it('should reject when name is missing', () => {
      const input = { input: 'data' };
      const result = ToolCallEntrySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when name is not a string', () => {
      const input = { name: 123, input: 'data' };
      const result = ToolCallEntrySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. TranscriptDataSchema
// ---------------------------------------------------------------------------
describe('TranscriptDataSchema', () => {
  describe('valid input parsing', () => {
    it('should parse a valid transcript with messages, toolCalls, and errors', () => {
      const input = {
        messages: [{ role: 'user', content: 'Hello' }],
        toolCalls: [{ name: 'bash', input: 'ls' }],
        errors: ['Something went wrong'],
      };
      const result = TranscriptDataSchema.parse(input);
      expect(result.messages).toHaveLength(1);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should parse a transcript with empty arrays', () => {
      const input = {
        messages: [],
        toolCalls: [],
        errors: [],
      };
      const result = TranscriptDataSchema.parse(input);
      expect(result.messages).toEqual([]);
      expect(result.toolCalls).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should parse a transcript with multiple messages of different roles', () => {
      const input = {
        messages: [
          { role: 'system', content: 'System' },
          { role: 'user', content: 'User' },
          { role: 'assistant', content: 'Assistant' },
        ],
        toolCalls: [],
        errors: [],
      };
      const result = TranscriptDataSchema.parse(input);
      expect(result.messages).toHaveLength(3);
    });
  });

  describe('invalid input rejection', () => {
    it('should reject when messages is missing', () => {
      const input = { toolCalls: [], errors: [] };
      const result = TranscriptDataSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when toolCalls is missing', () => {
      const input = { messages: [], errors: [] };
      const result = TranscriptDataSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when errors is missing', () => {
      const input = { messages: [], toolCalls: [] };
      const result = TranscriptDataSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when messages contains an invalid entry', () => {
      const input = {
        messages: [{ role: 'invalid_role', content: 'Hello' }],
        toolCalls: [],
        errors: [],
      };
      const result = TranscriptDataSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when errors contains a non-string element', () => {
      const input = {
        messages: [],
        toolCalls: [],
        errors: [123],
      };
      const result = TranscriptDataSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. FailureExperienceSchema
// ---------------------------------------------------------------------------
describe('FailureExperienceSchema', () => {
  const validExperience = {
    id: 'exp-001',
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried clearing cache', 'Tried reinstalling'],
    successfulApproach: 'Updated dependency version',
    lessons: ['Always check dependency compatibility'],
    createdAt: '2026-02-16T10:00:00Z',
  };

  describe('valid input parsing', () => {
    it('should parse a complete valid FailureExperience', () => {
      const result = FailureExperienceSchema.parse(validExperience);
      expect(result.id).toBe('exp-001');
      expect(result.frustrationSignature).toBe(
        'TypeError: Cannot read properties of undefined',
      );
      expect(result.failedApproaches).toHaveLength(2);
      expect(result.successfulApproach).toBe('Updated dependency version');
      expect(result.lessons).toHaveLength(1);
      expect(result.createdAt).toBe('2026-02-16T10:00:00Z');
    });

    it('should parse without successfulApproach (optional)', () => {
      const { successfulApproach, ...withoutSuccess } = validExperience;
      const result = FailureExperienceSchema.parse(withoutSuccess);
      expect(result.successfulApproach).toBeUndefined();
    });

    it('should parse with empty failedApproaches array', () => {
      const input = { ...validExperience, failedApproaches: [] };
      const result = FailureExperienceSchema.parse(input);
      expect(result.failedApproaches).toEqual([]);
    });

    it('should parse with empty lessons array', () => {
      const input = { ...validExperience, lessons: [] };
      const result = FailureExperienceSchema.parse(input);
      expect(result.lessons).toEqual([]);
    });
  });

  describe('invalid input rejection', () => {
    it('should reject when id is missing', () => {
      const { id, ...withoutId } = validExperience;
      const result = FailureExperienceSchema.safeParse(withoutId);
      expect(result.success).toBe(false);
    });

    it('should reject when frustrationSignature is missing', () => {
      const { frustrationSignature, ...rest } = validExperience;
      const result = FailureExperienceSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject when createdAt is missing', () => {
      const { createdAt, ...rest } = validExperience;
      const result = FailureExperienceSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject when failedApproaches contains non-strings', () => {
      const input = { ...validExperience, failedApproaches: [123, true] };
      const result = FailureExperienceSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('revision field', () => {
    it('should default revision to 1 when not provided', () => {
      const input = {
        id: 'exp-001',
        frustrationSignature: 'Test error',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-16T10:00:00Z',
      };
      const result = FailureExperienceSchema.parse(input);
      expect(result.revision).toBe(1);
    });

    it('should accept explicit revision value', () => {
      const input = {
        id: 'exp-001',
        frustrationSignature: 'Test error',
        failedApproaches: [],
        lessons: [],
        createdAt: '2026-02-16T10:00:00Z',
        revision: 3,
      };
      const result = FailureExperienceSchema.parse(input);
      expect(result.revision).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// 4b. ExperienceRevisionSchema
// ---------------------------------------------------------------------------
describe('ExperienceRevisionSchema', () => {
  const validRevision = {
    id: 'rev-001',
    experienceId: 'exp-001',
    revision: 1,
    frustrationSignature: 'Test error',
    failedApproaches: ['approach 1'],
    successfulApproach: 'solution',
    lessons: ['lesson 1'],
    createdAt: '2026-02-16T10:00:00Z',
  };

  it('should parse a valid revision', () => {
    const result = ExperienceRevisionSchema.parse(validRevision);
    expect(result.id).toBe('rev-001');
    expect(result.experienceId).toBe('exp-001');
    expect(result.revision).toBe(1);
  });

  it('should reject revision less than 1', () => {
    const result = ExperienceRevisionSchema.safeParse({ ...validRevision, revision: 0 });
    expect(result.success).toBe(false);
  });

  it('should allow optional successfulApproach', () => {
    const { successfulApproach, ...withoutSuccess } = validRevision;
    const result = ExperienceRevisionSchema.parse(withoutSuccess);
    expect(result.successfulApproach).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. AutoMemoryCandidateSchema
// ---------------------------------------------------------------------------
describe('AutoMemoryCandidateSchema', () => {
  const validCandidate = {
    id: 'draft-001',
    sessionId: 'session-abc-123',
    frustrationSignature: 'ENOENT: file not found',
    failedApproaches: ['Checked path manually'],
    successfulApproach: 'Used absolute path',
    lessons: ['Always use absolute paths'],
    status: 'pending' as const,
    createdAt: '2026-02-16T12:00:00Z',
  };

  describe('valid input parsing', () => {
    it('should parse a valid pending candidate', () => {
      const result = AutoMemoryCandidateSchema.parse(validCandidate);
      expect(result.status).toBe('pending');
    });

    it('should parse a confirmed candidate', () => {
      const input = { ...validCandidate, status: 'confirmed' };
      const result = AutoMemoryCandidateSchema.parse(input);
      expect(result.status).toBe('confirmed');
    });

    it('should parse a rejected candidate', () => {
      const input = { ...validCandidate, status: 'rejected' };
      const result = AutoMemoryCandidateSchema.parse(input);
      expect(result.status).toBe('rejected');
    });

    it('should parse without successfulApproach (optional)', () => {
      const { successfulApproach, ...withoutSuccess } = validCandidate;
      const result = AutoMemoryCandidateSchema.parse(withoutSuccess);
      expect(result.successfulApproach).toBeUndefined();
    });

    it('should parse with matchedExperienceId', () => {
      const input = { ...validCandidate, matchedExperienceId: 'exp-001' };
      const result = AutoMemoryCandidateSchema.parse(input);
      expect(result.matchedExperienceId).toBe('exp-001');
    });

    it('should parse without matchedExperienceId (optional)', () => {
      const result = AutoMemoryCandidateSchema.parse(validCandidate);
      expect(result.matchedExperienceId).toBeUndefined();
    });
  });

  describe('invalid input rejection', () => {
    it('should reject an invalid status value', () => {
      const input = { ...validCandidate, status: 'approved' };
      const result = AutoMemoryCandidateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when sessionId is missing', () => {
      const { sessionId, ...rest } = validCandidate;
      const result = AutoMemoryCandidateSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject when status is missing', () => {
      const { status, ...rest } = validCandidate;
      const result = AutoMemoryCandidateSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. FrustrationAnalysisSchema
// ---------------------------------------------------------------------------
describe('FrustrationAnalysisSchema', () => {
  const validAnalysis = {
    type: 'frustrated' as const,
    confidence: 0.85,
    intent: 'User is trying to fix a build error',
    context: 'Third attempt at the same problem',
    reasoning: 'Repeated error mentions and escalating language',
  };

  describe('valid input parsing', () => {
    it('should parse a valid frustrated analysis', () => {
      const result = FrustrationAnalysisSchema.parse(validAnalysis);
      expect(result.type).toBe('frustrated');
      expect(result.confidence).toBe(0.85);
    });

    it('should parse a normal analysis', () => {
      const input = {
        type: 'normal',
        confidence: 0.1,
        reasoning: 'Standard question, no signs of frustration',
      };
      const result = FrustrationAnalysisSchema.parse(input);
      expect(result.type).toBe('normal');
    });

    it('should parse a resolution analysis', () => {
      const input = {
        type: 'resolution',
        confidence: 0.9,
        reasoning: 'User explicitly says the problem is solved',
      };
      const result = FrustrationAnalysisSchema.parse(input);
      expect(result.type).toBe('resolution');
    });

    it('should parse an abandonment analysis', () => {
      const input = {
        type: 'abandonment',
        confidence: 0.7,
        reasoning: 'User is giving up on this approach',
      };
      const result = FrustrationAnalysisSchema.parse(input);
      expect(result.type).toBe('abandonment');
    });

    it('should parse without optional intent field', () => {
      const { intent, ...withoutIntent } = validAnalysis;
      const result = FrustrationAnalysisSchema.parse(withoutIntent);
      expect(result.intent).toBeUndefined();
    });

    it('should parse without optional context field', () => {
      const { context, ...withoutContext } = validAnalysis;
      const result = FrustrationAnalysisSchema.parse(withoutContext);
      expect(result.context).toBeUndefined();
    });
  });

  describe('type enum validation', () => {
    it('should reject an invalid type value', () => {
      const input = { ...validAnalysis, type: 'angry' };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject an empty type string', () => {
      const input = { ...validAnalysis, type: '' };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept exactly the four valid types', () => {
      const validTypes = ['normal', 'frustrated', 'resolution', 'abandonment'];
      for (const type of validTypes) {
        const input = { ...validAnalysis, type };
        const result = FrustrationAnalysisSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('confidence range validation (0-1)', () => {
    it('should accept confidence of 0 (minimum)', () => {
      const input = { ...validAnalysis, confidence: 0 };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept confidence of 1 (maximum)', () => {
      const input = { ...validAnalysis, confidence: 1 };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept confidence of 0.5 (midpoint)', () => {
      const input = { ...validAnalysis, confidence: 0.5 };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject negative confidence', () => {
      const input = { ...validAnalysis, confidence: -0.1 };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject confidence greater than 1', () => {
      const input = { ...validAnalysis, confidence: 1.01 };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject confidence of 2', () => {
      const input = { ...validAnalysis, confidence: 2 };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject non-numeric confidence', () => {
      const input = { ...validAnalysis, confidence: 'high' };
      const result = FrustrationAnalysisSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('invalid input rejection', () => {
    it('should reject when reasoning is missing', () => {
      const { reasoning, ...rest } = validAnalysis;
      const result = FrustrationAnalysisSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject when type is missing', () => {
      const { type, ...rest } = validAnalysis;
      const result = FrustrationAnalysisSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject when confidence is missing', () => {
      const { confidence, ...rest } = validAnalysis;
      const result = FrustrationAnalysisSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 7. MatchResultSchema
// ---------------------------------------------------------------------------
describe('MatchResultSchema', () => {
  const validExperience = {
    id: 'exp-001',
    frustrationSignature: 'TypeError: x is not a function',
    failedApproaches: ['Tried restarting'],
    lessons: ['Check import paths'],
    createdAt: '2026-02-16T10:00:00Z',
  };

  const validMatch = {
    experience: validExperience,
    confidence: 0.92,
    suggestedAction: 'Check your import statements for typos',
  };

  describe('valid input parsing', () => {
    it('should parse a valid match result', () => {
      const result = MatchResultSchema.parse(validMatch);
      expect(result.confidence).toBe(0.92);
      expect(result.suggestedAction).toBe(
        'Check your import statements for typos',
      );
      expect(result.experience.id).toBe('exp-001');
    });
  });

  describe('confidence range validation (0-1)', () => {
    it('should accept confidence of 0', () => {
      const input = { ...validMatch, confidence: 0 };
      const result = MatchResultSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept confidence of 1', () => {
      const input = { ...validMatch, confidence: 1 };
      const result = MatchResultSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject negative confidence', () => {
      const input = { ...validMatch, confidence: -0.5 };
      const result = MatchResultSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject confidence greater than 1', () => {
      const input = { ...validMatch, confidence: 1.5 };
      const result = MatchResultSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('invalid input rejection', () => {
    it('should reject when experience is missing', () => {
      const { experience, ...rest } = validMatch;
      const result = MatchResultSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject when suggestedAction is missing', () => {
      const { suggestedAction, ...rest } = validMatch;
      const result = MatchResultSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject when experience is invalid (missing required fields)', () => {
      const input = {
        ...validMatch,
        experience: { id: 'exp-001' }, // missing other required fields
      };
      const result = MatchResultSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. SentinelSettingsSchema
// ---------------------------------------------------------------------------
describe('SentinelSettingsSchema', () => {
  describe('valid input parsing', () => {
    it('should parse a minimal valid settings object with defaults', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {
            baseUrl: 'http://localhost:11434',
            completionModel: 'qwen3:4b',
            embeddingModel: 'qwen3-embedding:0.6b',
          },
        },
        storage: {
          dbPath: '~/.sentinel/sentinel.db',
        },
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.provider).toBe('ollama');
      expect(result.llm.ollama.baseUrl).toBe('http://localhost:11434');
    });

    it('should parse settings with bedrock provider', () => {
      const input = {
        llm: {
          provider: 'bedrock',
          ollama: {
            baseUrl: 'http://localhost:11434',
            completionModel: 'qwen3:4b',
            embeddingModel: 'qwen3-embedding:0.6b',
          },
          bedrock: {
            region: 'us-west-2',
            completionModel: 'anthropic.claude-sonnet-4-20250514',
            embeddingModel: 'amazon.titan-embed-text-v2:0',
          },
        },
        storage: {
          dbPath: '/custom/path/sentinel.db',
        },
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.provider).toBe('bedrock');
      expect(result.llm.bedrock?.region).toBe('us-west-2');
    });

    it('should allow bedrock to be omitted (optional)', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {
            baseUrl: 'http://localhost:11434',
            completionModel: 'qwen3:4b',
            embeddingModel: 'qwen3-embedding:0.6b',
          },
        },
        storage: {
          dbPath: '~/.sentinel/sentinel.db',
        },
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.bedrock).toBeUndefined();
    });
  });

  describe('default values', () => {
    it('should apply default values for ollama settings when not provided', () => {
      // If defaults are defined in the schema, a minimal object should get them
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.ollama.baseUrl).toBe('http://localhost:11434');
      expect(result.llm.ollama.completionModel).toBe('qwen3:4b');
      expect(result.llm.ollama.embeddingModel).toBe('qwen3-embedding:0.6b');
    });

    it('should apply default dbPath when not provided', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.storage.dbPath).toBe('~/.sentinel/sentinel.db');
    });

    it('should apply default bedrock values when bedrock is provided empty', () => {
      const input = {
        llm: {
          provider: 'bedrock',
          ollama: {},
          bedrock: {},
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.bedrock?.region).toBe('us-east-1');
      expect(result.llm.bedrock?.completionModel).toBe(
        'us.anthropic.claude-sonnet-4-20250514-v1:0',
      );
      expect(result.llm.bedrock?.embeddingModel).toBe(
        'amazon.titan-embed-text-v2:0',
      );
    });
  });

  // -------------------------------------------------------------------------
  // debug field tests
  // -------------------------------------------------------------------------
  describe('debug field', () => {
    it('should default debug to false when not provided', () => {
      // When debug is omitted from the input, the schema should apply
      // the default value of false via z.boolean().default(false).
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.debug).toBe(false);
    });

    it('should accept debug: true', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        debug: true,
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.debug).toBe(true);
    });

    it('should accept debug: false', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        debug: false,
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.debug).toBe(false);
    });

    it('should reject non-boolean debug value', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        debug: 'yes',
      };
      const result = SentinelSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // NEW: enabled field tests (RED phase - these WILL FAIL until implemented)
  //
  // Requirements:
  //   - SentinelSettingsSchema should have an `enabled` boolean field
  //   - When `enabled` is omitted, it should default to `true`
  //   - When `enabled: false` is explicitly set, it should parse as false
  //   - When `enabled: true` is explicitly set, it should parse as true
  //   - Non-boolean values for `enabled` should be rejected
  //
  // Rationale:
  //   The `enabled` field allows users to globally disable Sentinel without
  //   removing the hook configuration. When enabled is false, hooks should
  //   pass through without performing analysis.
  // -------------------------------------------------------------------------
  describe('enabled field', () => {
    it('should default enabled to true when not provided', () => {
      // When `enabled` is omitted from the input, the schema should apply
      // the default value of true via z.boolean().default(true).
      // This ensures Sentinel is active by default after installation.
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.enabled).toBe(true);
    });

    it('should accept enabled: false explicitly', () => {
      // Users must be able to explicitly disable Sentinel by setting
      // enabled: false in their settings file.
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        enabled: false,
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.enabled).toBe(false);
    });

    it('should accept enabled: true explicitly', () => {
      // Explicitly setting enabled: true should work and return true.
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        enabled: true,
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.enabled).toBe(true);
    });

    it('should reject non-boolean enabled value (string)', () => {
      // enabled must be a boolean, not a string like "true" or "yes".
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        enabled: 'true',
      };
      const result = SentinelSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean enabled value (number)', () => {
      // enabled must be a boolean, not a number like 1 or 0.
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        enabled: 1,
      };
      const result = SentinelSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should include enabled in the parsed output even when other fields use defaults', () => {
      // Verify that the `enabled` field coexists with other defaulted fields
      // and appears in the final parsed object alongside debug, recall, etc.
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      // All default fields should be present
      expect(result).toHaveProperty('enabled');
      expect(result).toHaveProperty('debug');
      expect(result).toHaveProperty('recall');
      expect(result.enabled).toBe(true);
      expect(result.debug).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // thinkingModel field tests
  // -------------------------------------------------------------------------
  describe('thinkingModel field', () => {
    it('should parse ollama settings with thinkingModel', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {
            thinkingModel: 'qwen3:8b',
          },
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.ollama.thinkingModel).toBe('qwen3:8b');
    });

    it('should parse ollama settings without thinkingModel (optional)', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.ollama.thinkingModel).toBeUndefined();
    });

    it('should parse bedrock settings with thinkingModel', () => {
      const input = {
        llm: {
          provider: 'bedrock',
          ollama: {},
          bedrock: {
            thinkingModel: 'us.anthropic.claude-opus-4-20250514-v1:0',
          },
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.bedrock?.thinkingModel).toBe('us.anthropic.claude-opus-4-20250514-v1:0');
    });

    it('should parse bedrock settings without thinkingModel (optional)', () => {
      const input = {
        llm: {
          provider: 'bedrock',
          ollama: {},
          bedrock: {},
        },
        storage: {},
      };
      const result = SentinelSettingsSchema.parse(input);
      expect(result.llm.bedrock?.thinkingModel).toBeUndefined();
    });
  });

  describe('invalid input rejection', () => {
    it('should reject an invalid provider value', () => {
      const input = {
        llm: {
          provider: 'openai',
          ollama: {
            baseUrl: 'http://localhost:11434',
            completionModel: 'qwen3:4b',
            embeddingModel: 'qwen3-embedding:0.6b',
          },
        },
        storage: {
          dbPath: '~/.sentinel/sentinel.db',
        },
      };
      const result = SentinelSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when llm section is missing', () => {
      const input = {
        storage: { dbPath: '~/.sentinel/sentinel.db' },
      };
      const result = SentinelSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject when storage section is missing', () => {
      const input = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
      };
      const result = SentinelSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 8b. RecallSettingsSchema
// ---------------------------------------------------------------------------
describe('RecallSettingsSchema', () => {
  it('should apply default maxAdvicesPerSession of 5 when empty object is given', () => {
    const result = RecallSettingsSchema.parse({});
    expect(result.maxAdvicesPerSession).toBe(5);
  });

  it('should accept a custom maxAdvicesPerSession value', () => {
    const result = RecallSettingsSchema.parse({ maxAdvicesPerSession: 10 });
    expect(result.maxAdvicesPerSession).toBe(10);
  });

  it('should reject maxAdvicesPerSession less than 1', () => {
    const result = RecallSettingsSchema.safeParse({ maxAdvicesPerSession: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer maxAdvicesPerSession', () => {
    const result = RecallSettingsSchema.safeParse({ maxAdvicesPerSession: 2.5 });
    expect(result.success).toBe(false);
  });

  it('should reject negative maxAdvicesPerSession', () => {
    const result = RecallSettingsSchema.safeParse({ maxAdvicesPerSession: -1 });
    expect(result.success).toBe(false);
  });
});

describe('SentinelSettingsSchema - recall field', () => {
  it('should apply default recall settings when recall is omitted', () => {
    const input = {
      llm: {
        provider: 'ollama',
        ollama: {},
      },
      storage: {},
    };
    const result = SentinelSettingsSchema.parse(input);
    expect(result.recall).toBeDefined();
    expect(result.recall.maxAdvicesPerSession).toBe(5);
  });

  it('should accept custom recall settings', () => {
    const input = {
      llm: {
        provider: 'ollama',
        ollama: {},
      },
      storage: {},
      recall: { maxAdvicesPerSession: 3 },
    };
    const result = SentinelSettingsSchema.parse(input);
    expect(result.recall.maxAdvicesPerSession).toBe(3);
  });

  it('should apply recall defaults when recall is an empty object', () => {
    const input = {
      llm: {
        provider: 'ollama',
        ollama: {},
      },
      storage: {},
      recall: {},
    };
    const result = SentinelSettingsSchema.parse(input);
    expect(result.recall.maxAdvicesPerSession).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 9. Barrel export verification
// ---------------------------------------------------------------------------
describe('Barrel exports from src/types/index', () => {
  it('should export all schemas', () => {
    expect(TranscriptMessageSchema).toBeDefined();
    expect(ToolCallEntrySchema).toBeDefined();
    expect(TranscriptDataSchema).toBeDefined();
    expect(FailureExperienceSchema).toBeDefined();
    expect(AutoMemoryCandidateSchema).toBeDefined();
    expect(FrustrationAnalysisSchema).toBeDefined();
    expect(MatchResultSchema).toBeDefined();
    expect(SentinelSettingsSchema).toBeDefined();
    expect(RecallSettingsSchema).toBeDefined();
  });

  it('should export schemas that are Zod schemas (have .parse method)', () => {
    const schemas = [
      TranscriptMessageSchema,
      ToolCallEntrySchema,
      TranscriptDataSchema,
      FailureExperienceSchema,
      AutoMemoryCandidateSchema,
      FrustrationAnalysisSchema,
      MatchResultSchema,
      SentinelSettingsSchema,
    ];

    for (const schema of schemas) {
      expect(typeof schema.parse).toBe('function');
      expect(typeof schema.safeParse).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// 10. LLMProvider interface (compile-time type check)
// ---------------------------------------------------------------------------
describe('LLMProvider interface', () => {
  it('should be usable as a type for objects with the correct shape', () => {
    // This is a compile-time check. If LLMProvider is not exported or has
    // a different shape, TypeScript compilation will fail.
    const mockProvider: LLMProvider = {
      getModelName: (): string => 'mock',
      generateCompletion: async (
        _system: string,
        _user: string,
      ): Promise<string> => {
        return 'mock response';
      },
      generateEmbedding: async (_text: string): Promise<number[]> => {
        return [0.1, 0.2, 0.3];
      },
      isAvailable: async (): Promise<boolean> => {
        return true;
      },
    };

    // Runtime checks to ensure the mock conforms
    expect(typeof mockProvider.getModelName).toBe('function');
    expect(typeof mockProvider.generateCompletion).toBe('function');
    expect(typeof mockProvider.generateEmbedding).toBe('function');
    expect(typeof mockProvider.isAvailable).toBe('function');
  });

  it('should have generateCompletion return a Promise<string>', async () => {
    const mockProvider: LLMProvider = {
      getModelName: () => 'mock',
      generateCompletion: async () => 'response',
      generateEmbedding: async () => [1, 2, 3],
      isAvailable: async () => true,
    };

    const result = await mockProvider.generateCompletion('system', 'user');
    expect(typeof result).toBe('string');
  });

  it('should have generateEmbedding return a Promise<number[]>', async () => {
    const mockProvider: LLMProvider = {
      getModelName: () => 'mock',
      generateCompletion: async () => 'response',
      generateEmbedding: async () => [0.1, 0.2, 0.3],
      isAvailable: async () => true,
    };

    const result = await mockProvider.generateEmbedding('test text');
    expect(Array.isArray(result)).toBe(true);
    expect(
      result.every((n: number) => typeof n === 'number'),
    ).toBe(true);
  });

  it('should have isAvailable return a Promise<boolean>', async () => {
    const mockProvider: LLMProvider = {
      getModelName: () => 'mock',
      generateCompletion: async () => 'response',
      generateEmbedding: async () => [1, 2],
      isAvailable: async () => false,
    };

    const result = await mockProvider.isAvailable();
    expect(typeof result).toBe('boolean');
  });
});
