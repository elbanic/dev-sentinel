# Tech Reference — Reusable Implementation Details

> Implementation patterns and code structures from v1 worth carrying over.

---

## 1. LLM Provider Interface

The core abstraction. All providers implement this:

```typescript
interface LLMProvider {
  readonly providerType: 'local' | 'cloud';
  isAvailable(): Promise<boolean>;
  generateCompletion(systemPrompt: string, userPrompt: string): Promise<string>;
  generateEmbedding(text: string): Promise<number[]>;
}
```

### Ollama Provider (local)

- HTTP API: `http://localhost:11434/api/generate` (completion), `/api/embeddings` (embedding)
- `stream: false` for synchronous response
- Separate models for completion (`qwen3:4b`) and embedding (`qwen3-embedding:0.6b`)
- `isAvailable()`: lightweight generate call with `num_predict: 1`

### Bedrock Provider (cloud)

- AWS SDK: `@aws-sdk/client-bedrock-runtime`
- `ConverseCommand` for completion, `InvokeModelCommand` for embedding
- Uses IAM credentials from environment (no API key in code)
- Embedding model: `amazon.titan-embed-text-v2:0`

### Mock Provider (testing)

- Deterministic responses based on input patterns
- `shouldFail` mode for error path testing
- Tracks all calls for spy assertions
- Must implement full interface including `generateCompletion`

### Provider Manager

- Wraps provider with health tracking (error count, consecutive failures)
- `recordSuccess()` / `recordError()` for circuit breaker pattern
- Optional fallback string when provider fails
- `getHealthStatus()` for monitoring

---

## 2. Vector Store

SQLite-backed, no external dependencies:

```typescript
class VectorStore {
  initialize(): void;
  store(id: string, embedding: number[], metadata?: string): void;
  search(queryEmbedding: number[], topK: number, minSimilarity: number): SearchResult[];
  delete(id: string): void;
  clearVectors(): void;  // for model migration
  close(): void;
}
```

- Cosine similarity computed in TypeScript (no SQL extension needed)
- Embedding stored as JSON text in SQLite (simple, portable)
- `clearVectors()` for when embedding model changes dimensions
- Store model name in metadata for migration detection

---

## 3. Transcript Parser

Claude Code writes JSONL transcript files. Parser extracts structured data:

```typescript
interface TranscriptData {
  userMessages: TranscriptMessage[];
  assistantMessages: TranscriptMessage[];
  toolCalls: ToolCallEntry[];
  errorMessages: string[];
  totalEntries: number;
}

function parseTranscriptFile(filePath: string): TranscriptData | null;
```

### JSONL format (Claude Code)

Each line is a JSON object with `type` field:
- `"user"` → user message with `message.content[].text`
- `"assistant"` → assistant message with `message.content[].text` and `message.content[].type === "tool_use"`
- Tool results come back as `"user"` type with `tool_result` content

### Error detection patterns

From v1 (regex-based, used ONLY for transcript parsing — not for prompt analysis):
```
/error|typeerror|referenceerror|syntaxerror|exception|failed|econnrefused|etimedout/i
```

---

## 4. LLM Prompts

### Frustration Analysis (NEW — to be designed)

```
System: Analyze the developer prompt for emotional state and intent.
Classify into one of four types:
- "frustrated": developer is struggling, expressing frustration or desperation
- "resolution": developer indicates the problem is solved or working
- "abandonment": developer is giving up or moving on from the problem
- "normal": neutral prompt, question, or instruction

Return JSON: {
  type: "normal" | "frustrated" | "resolution" | "abandonment",
  confidence: number (0-1),
  intent: string (what the developer wants to do),
  context: string (error/technology/approach summary),
  reasoning: string (why you classified this way)
}
```

### Lesson Summarization (from v1, proven)

```
System: You are a technical lesson extractor.
Given assistant messages from a debugging conversation, extract concise actionable lessons.
Return a JSON array of strings, each lesson being 1-2 sentences.
Focus on:
- Root cause of the error
- What specific fix resolved it
- What approach should be avoided next time
Maximum 3 lessons. Only return valid JSON array, no other text.
```

### RAG Judge (from v1, proven)

```
System: You are a relevance judge.
Given a developer's current prompt and a past failure experience,
determine if the past experience is relevant to the current situation.
Return JSON: {
  isRelevant: boolean,
  confidence: number (0-1),
  reasoning: string,
  suggestedAction: string (advice based on the past experience)
}
```

---

## 5. JSON Extraction from LLM Responses

LLM responses often contain markdown fences or extra text. Robust extraction:

```typescript
function extractJson(raw: string): string | null {
  if (!raw?.trim()) return null;

  // Try markdown code fence: ```json ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]?.trim()) return fenceMatch[1].trim();

  // Try raw JSON object
  const jsonMatch = raw.match(/(\{[\s\S]*\})/);
  if (jsonMatch?.[1]?.trim()) return jsonMatch[1].trim();

  // Try raw JSON array
  const arrayMatch = raw.match(/(\[[\s\S]*\])/);
  if (arrayMatch?.[1]?.trim()) return arrayMatch[1].trim();

  return null;
}
```

Always use `ZodSchema.safeParse()` after `JSON.parse()` for type safety.

---

## 6. SQLite Store Patterns

### Stateless hook invocations

Each hook call is a new process. Open/close SQLite on each invocation:

```typescript
const store = new SqliteStore(dbPath);
try {
  store.initialize();
  // ... work ...
} finally {
  store.close();
}
```

### Transaction for multi-table writes

Confirm draft → experience requires writing to BOTH tables atomically:

```typescript
store.runInTransaction(() => {
  store.storeExperience(experience);
  store.updateCandidateStatus(candidateId, 'confirmed', experience.id);
});
// Build embedding text from experience fields (no LLM call)
const embeddingText = `${experience.frustration_signature}. Failed: ${experience.failed_approaches.join(', ')}. Fixed: ${experience.successful_approach ?? 'unresolved'}. Lessons: ${experience.lessons.join('. ')}`;
const embedding = await llmProvider.generateEmbedding(embeddingText);
// Then also write to vector store (separate DB, best-effort)
vectorStore.store(experience.id, embedding);
```

---

## 7. Settings Schema

```typescript
const SentinelSettingsSchema = z.object({
  llm: z.object({
    provider: z.enum(['ollama', 'bedrock']),
    model: z.string(),
    embeddingModel: z.string().optional(),
    // Ollama-specific
    baseUrl: z.string().optional(),
    // Bedrock-specific
    region: z.string().optional(),
  }),
  pipelineTimeoutMs: z.number().optional().default(15000),
});
```

Settings file: `~/.sentinel/settings.json`
