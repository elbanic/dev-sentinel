import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------
const confidenceScore = z.number().min(0).max(1);

// ---------------------------------------------------------------------------
// 1. TranscriptMessageSchema
// ---------------------------------------------------------------------------
export const TranscriptMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().optional(),
});

export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>;

// ---------------------------------------------------------------------------
// 2. ToolCallEntrySchema
// ---------------------------------------------------------------------------
export const ToolCallEntrySchema = z.object({
  name: z.string(),
  input: z.unknown(),
  output: z.string().optional(),
  error: z.string().optional(),
});

export type ToolCallEntry = z.infer<typeof ToolCallEntrySchema>;

// ---------------------------------------------------------------------------
// 3. TranscriptDataSchema
// ---------------------------------------------------------------------------
export const TranscriptDataSchema = z.object({
  messages: z.array(TranscriptMessageSchema),
  toolCalls: z.array(ToolCallEntrySchema),
  errors: z.array(z.string()),
});

export type TranscriptData = z.infer<typeof TranscriptDataSchema>;

// ---------------------------------------------------------------------------
// 4. FailureExperienceSchema
// ---------------------------------------------------------------------------
export const FailureExperienceSchema = z.object({
  id: z.string(),
  frustrationSignature: z.string(),
  failedApproaches: z.array(z.string()),
  successfulApproach: z.string().optional(),
  lessons: z.array(z.string()),
  createdAt: z.string(),
  revision: z.number().int().min(1).default(1),
});

export type FailureExperience = z.infer<typeof FailureExperienceSchema>;

// ---------------------------------------------------------------------------
// 4b. ExperienceRevisionSchema
// ---------------------------------------------------------------------------
export const ExperienceRevisionSchema = z.object({
  id: z.string(),
  experienceId: z.string(),
  revision: z.number().int().min(1),
  frustrationSignature: z.string(),
  failedApproaches: z.array(z.string()),
  successfulApproach: z.string().optional(),
  lessons: z.array(z.string()),
  createdAt: z.string(),
});

export type ExperienceRevision = z.infer<typeof ExperienceRevisionSchema>;

// ---------------------------------------------------------------------------
// 5. AutoMemoryCandidateSchema
// ---------------------------------------------------------------------------
export const AutoMemoryCandidateSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  transcriptData: z.string().optional(),
  frustrationSignature: z.string(),
  failedApproaches: z.array(z.string()),
  successfulApproach: z.string().optional(),
  matchedExperienceId: z.string().optional(),
  lessons: z.array(z.string()),
  status: z.enum(['pending', 'confirmed', 'rejected']),
  createdAt: z.string(),
});

export type AutoMemoryCandidate = z.infer<typeof AutoMemoryCandidateSchema>;

// ---------------------------------------------------------------------------
// 6. FrustrationAnalysisSchema
// ---------------------------------------------------------------------------
export const FrustrationAnalysisSchema = z.object({
  type: z.enum(['normal', 'frustrated', 'resolution', 'abandonment']),
  confidence: confidenceScore,
  intent: z.string().optional(),
  context: z.string().optional(),
  errorKeyword: z.string().optional(),
  reasoning: z.string(),
});

export type FrustrationAnalysis = z.infer<typeof FrustrationAnalysisSchema>;

// ---------------------------------------------------------------------------
// 7. MatchResultSchema
// ---------------------------------------------------------------------------
export const MatchResultSchema = z.object({
  experience: FailureExperienceSchema,
  confidence: confidenceScore,
  suggestedAction: z.string(),
});

export type MatchResult = z.infer<typeof MatchResultSchema>;

// ---------------------------------------------------------------------------
// 8. SentinelSettingsSchema
// ---------------------------------------------------------------------------
const OllamaSettingsSchema = z.object({
  baseUrl: z.string().default('http://localhost:11434'),
  completionModel: z.string().default('qwen3:4b'),
  thinkingModel: z.string().optional(),
  embeddingModel: z.string().default('qwen3-embedding:0.6b'),
});

const BedrockSettingsSchema = z.object({
  region: z.string().default('us-east-1'),
  completionModel: z.string().default('us.anthropic.claude-sonnet-4-20250514-v1:0'),
  thinkingModel: z.string().optional(),
  embeddingModel: z.string().default('amazon.titan-embed-text-v2:0'),
  profile: z.string().optional(),
});

const StorageSettingsSchema = z.object({
  dbPath: z.string().default('~/.sentinel/sentinel.db'),
});

export const RecallSettingsSchema = z.object({
  maxAdvicesPerSession: z.number().int().min(1).default(5),
});

export const AnalysisSettingsSchema = z.object({
  frustrationThreshold: z.number().min(0).max(1).optional(),
});

export const SentinelSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  debug: z.boolean().default(false),
  llm: z.object({
    provider: z.enum(['ollama', 'bedrock']),
    ollama: OllamaSettingsSchema,
    bedrock: BedrockSettingsSchema.optional(),
  }),
  storage: StorageSettingsSchema,
  recall: RecallSettingsSchema.default({ maxAdvicesPerSession: 5 }),
  analysis: AnalysisSettingsSchema.default({}),
});

export type SentinelSettings = z.infer<typeof SentinelSettingsSchema>;

// ---------------------------------------------------------------------------
// 9. LLMProvider interface
// ---------------------------------------------------------------------------
export interface CompletionOptions {
  think?: boolean;
}

export interface LLMProvider {
  getModelName(): string;
  generateCompletion(system: string, user: string, options?: CompletionOptions): Promise<string>;
  generateEmbedding(text: string): Promise<number[]>;
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// 10. PatternAnalysisResultSchema
// ---------------------------------------------------------------------------
export const PatternAnalysisResultSchema = z.object({
  insight: z.string(),
  weakAreas: z.array(z.object({
    category: z.string(),
    count: z.number().int().min(0),
    description: z.string(),
  })),
  resolutionRate: z.number().min(0).max(100),
});

export type PatternAnalysisResult = z.infer<typeof PatternAnalysisResultSchema>;

// ---------------------------------------------------------------------------
// 11. Advice Outcome + Effectiveness Stats
// ---------------------------------------------------------------------------
export type AdviceOutcome = 'unknown' | 'effective' | 'ineffective';

export interface EffectivenessStats {
  experienceId: string;
  effective: number;
  ineffective: number;
  unknown: number;
  effectivenessRate: number | null; // null when effective+ineffective === 0
}

// ---------------------------------------------------------------------------
// 12. Persistent Error Tracking
// ---------------------------------------------------------------------------
export type HookErrorComponent = 'llm' | 'database' | 'vector' | 'transcript';

export interface PersistentErrorSummary {
  component: HookErrorComponent;
  count: number;
  lastError: string;
  lastOccurred: string;
}
