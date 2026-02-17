# TODO — Dev Sentinel

## Dependency Graph

```
Phase 1: Foundation
  1.1 Project Setup
  1.2 Types & Schemas
       │
       ├─────────────────────┐
       │                     │
Phase 2: Core Infrastructure (parallel triple)
  2.1 SQLite Store   2.2 LLM Provider   2.3 Settings Loader
       │                     │
       │    ┌────────────────┤
       │    │                │
Phase 3: Storage & Parsing (parallel pair, both need LLM Provider)
       │  3.1 Vector Store  3.2 Transcript Parser
       │    │                │
       │    │                │
Phase 4: Analysis Modules (parallel pair)
       │  4.1 RAG Matcher   4.2 Note Generator
       │    │  (needs 2.2,   │  (needs 2.2,
       │    │   3.1)         │   3.2)
       │    │                │
Phase 5: Frustration Detection (needs 2.2)
  5.1 Frustration Analyzer
       │
       ├─────────────────────┐
       │                     │
Phase 6: Hook Handlers (parallel pair)
  6.1 UserPromptSubmit   6.2 Stop Hook
  (needs 2.1, 5.1, 4.1)  (needs 2.1, 3.2, 4.2)
       │                     │
       └──────────┬──────────┘
                  │
Phase 7: CLI & Integration (parallel triple)
  7.1 CLI (review command)
  7.2 sentinel init
  7.3 Integration Tests
```

---

## Phase 1: Foundation

> No parallelism. Sequential.

- [x] **1.1 Project Setup** ✅
  - `package.json`, `tsconfig.json`, Jest config, fast-check
  - Directory structure (`src/`, `tests/unit/`, `tests/property/`)
  - Build script, test script
  - `.claude/settings.local.json` hook config template

- [x] **1.2 Types & Schemas** ✅
  - Zod schemas + TypeScript types for:
    - `LLMProvider` interface (`generateCompletion`, `generateEmbedding`, `isAvailable`)
    - `TranscriptData`, `TranscriptMessage`, `ToolCallEntry`
    - `FailureExperience` (frustration_signature, failed_approaches, successful_approach, lessons)
    - `AutoMemoryCandidate` (draft with status lifecycle)
    - `FrustrationAnalysis` (type: `'normal'|'frustrated'|'resolution'|'abandonment'`, confidence, intent, context, reasoning)
    - `MatchResult` (experience, confidence, suggestedAction)
    - `SentinelSettings` (llm provider config)
  - Barrel export `src/types/index.ts`
  - 100 tests (unit 60 + property 16 + index 1) all passing

---

## Phase 2: Core Infrastructure

> **2.1, 2.2, and 2.3 are parallel.** No dependency between them.

- [x] **2.1 SQLite Store** ✅ `src/storage/sqlite-store.ts`
  - Tables: `session_turns`, `session_flags`, `auto_memory_candidates`, `experiences`
  - `session_flags` schema: `session_id TEXT PK`, `status TEXT ('frustrated'|'capture')`, `flagged_at TEXT`, `updated_at TEXT`
  - CRUD: `storeTurn`, `getTurnsBySession`, `setFlag(session_id, status)`, `getFlag(session_id)`, `upgradeFlag(session_id, newStatus)`, `clearFlag(session_id)`, `storeCandidate`, `getPendingDrafts`, `storeExperience`, `getExperience`, `deleteCandidate`, `updateCandidateStatus`
  - `runInTransaction()` for atomic multi-table writes
  - `initialize()`, `close()`

- [x] **2.2 LLM Provider** ✅ `src/llm/`
  - `LLMProvider` interface implementation
  - `local-llm-provider.ts` — Ollama (`generateCompletion` via `/api/generate`, `generateEmbedding` via `/api/embeddings`)
  - `bedrock-llm-provider.ts` — AWS Bedrock (`ConverseCommand`, `InvokeModelCommand`)
  - `mock-llm-provider.ts` — Testing (deterministic, spy-capable, `shouldFail` mode)
  - `llm-provider-manager.ts` — Provider selection, health tracking, fallback
  - `prompts.ts` — System prompts (frustration analysis, lesson summarization, RAG judge)

- [x] **2.3 Settings Loader** ✅ `src/config/settings-loader.ts`
  - `loadSettings(): SentinelSettings` — read `~/.sentinel/settings.json`, Zod validate, return defaults on missing/invalid

---

## Phase 3: Storage & Parsing

> **3.1 and 3.2 are parallel.** Both depend on Phase 2 completion.
> - 3.1 has no direct dependency on LLM — it stores/retrieves `number[]`
> - 3.2 has no dependency on 2.1 or 2.2, but is grouped here for phase ordering

- [x] **3.1 Vector Store** ✅ `src/storage/vector-store.ts`
  - SQLite-backed: `vectors` table (id TEXT PK, embedding BLOB, metadata TEXT, created_at TEXT)
  - `store(id, embedding, metadata)`, `search(queryEmbedding, topK, minSimilarity)`, `delete(id)`, `clearVectors()`
  - Cosine similarity in TypeScript (zero-vector safe)
  - UPSERT behavior (INSERT OR REPLACE), Float64Array BLOB storage
  - `VectorSearchResult` interface exported: `{ id, similarity, metadata }`
  - Store embedding model name in metadata for migration detection
  - 20 unit tests + 9 property tests (self-similarity, symmetry, range, round-trip, topK, delete, metadata)

- [x] **3.2 Transcript Parser** ✅ `src/capture/transcript-parser.ts`
  - `parseTranscriptFile(filePath): TranscriptData | null`
  - Parse Claude Code JSONL format (human, assistant, tool_use, tool_result)
  - Extract: user messages, assistant messages, tool calls (from both tool_use entries and assistant tool_calls), error messages
  - Error detection from tool output (regex — allowed here, this is transcript parsing not prompt analysis)
  - Never-throw guarantee (double try-catch), null on file not found / empty / no valid data
  - 23 unit tests + 8 property tests (round-trip, invalid JSON resilience, error count bound, message count)

---

## Phase 4: Analysis Modules

> **4.1 and 4.2 are parallel.**
> - 4.1 needs 2.1 (SQLite) + 2.2 (LLM) + 3.1 (Vector Store)
> - 4.2 needs 2.2 (LLM) + 3.2 (Transcript Parser)

- [x] **4.1 RAG Memory Matcher** ✅ `src/recall/memory-matcher.ts`
  - `searchMemory(prompt, llmProvider, vectorStore, sqliteStore): MatchResult | null`
  - Pipeline: embed → vectorStore.search(topK=3, minSimilarity=0.7) → getExperience → LLM judge (PROMPTS.ragJudge) → best match by confidence
  - Inner try-catch per candidate: skip on failure, try next
  - Outer try-catch: never throws, returns null on any unhandled error
  - Confidence clamped to [0, 1] range
  - 30 unit tests (happy path, empty results, irrelevant judge, embedding/judge/store failures, multiple candidates, malformed JSON, edge cases)

- [x] **4.2 Note Generator** ✅ `src/capture/note-generator.ts`
  - `generateNote(transcriptData, sessionId, llmProvider?): AutoMemoryCandidate | null`
  - Error detection: errors array + tool call error fields (both trigger note generation)
  - Fallback-first pattern: extract from transcript, then LLM overrides selectively
  - LLM lessons via PROMPTS.lessonSummarization, JSON parsing with markdown code block support
  - Fallback: assistant message sentences as lessons when LLM unavailable/fails
  - Resolution detection heuristic for successfulApproach
  - Never throws (double try-catch)
  - 37 unit tests (normal flow, LLM extraction, LLM failure fallback, no LLM, null returns, frustration signature, failed approaches, edge cases)

---

## Phase 5: Frustration Detection

> Sequential. Depends on 2.2 (LLM Provider).
> Separate from Phase 4 because this is the NEW design piece — needs dedicated attention.

- [x] **5.1 Frustration Analyzer** ✅ `src/analysis/frustration-analyzer.ts`
  - `analyzeFrustration(prompt, llmProvider): FrustrationAnalysis`
  - Single LLM call: `generateCompletion(PROMPTS.frustrationAnalysis, prompt)`
  - 2-stage JSON parsing: direct `JSON.parse` → markdown fence extraction (regex)
  - Zod `safeParse` validation for type safety
  - Graceful fallback: `{ type: 'normal', confidence: 0, reasoning: '' }` on any failure
  - Never throws (outer try-catch wraps entire pipeline)
  - Korean + English support (handled by LLM, not by code)
  - 34 unit tests + 12 property tests (totality, type safety, confidence bounds, schema conformance, deterministic fallback)

---

## Phase 6: Hook Handlers

> **6.1 and 6.2 are parallel.**
> - 6.1 needs 2.1 (SQLite) + 5.1 (Frustration) + 4.1 (RAG)
> - 6.2 needs 2.1 (SQLite) + 3.2 (Transcript Parser) + 4.2 (Note Generator)

- [x] **6.1 UserPromptSubmit Handler** ✅ `src/hook/user-prompt-submit-handler.ts`
  - `handleUserPromptSubmit({ prompt, sessionId, llmProvider, sqliteStore, vectorStore }): Promise<string>`
  - Step 1: `analyzeFrustration(prompt, llmProvider)` → FrustrationAnalysis (single LLM call)
  - Step 2: Branch on `type`:
    - `frustrated`: `setFlag(sessionId, 'frustrated')` → `searchMemory(prompt, ...)` → match? → systemMessage with suggestedAction
    - `resolution`/`abandonment`: existing flag = `'frustrated'`? → `upgradeFlag(sessionId, 'capture')`
    - `normal`: pass through
  - Step 3: `storeTurn(sessionId, prompt, JSON.stringify(analysis))` — always called regardless of type
  - Step 4: `getPendingDrafts()` → filter other sessions → append notification to systemMessage
  - Output: `'{}'` or `'{"systemMessage":"..."}'` (match advice + draft notification joined with `\n\n`)
  - Never throws — outer try-catch → `'{}'`
  - `EMPTY_RESPONSE` constant for consistency
  - 48 unit tests (frustrated+match, frustrated+no match, resolution/abandonment flag upgrade, normal passthrough, pending drafts, storeTurn always, error handling for every dependency, input validation, combined scenarios)

- [x] **6.2 Stop Hook Handler** ✅ `src/hook/stop-hook-handler.ts`
  - `handleStop({ sessionId, transcriptPath, llmProvider, sqliteStore }): Promise<string>`
  - Step 1: `getFlag(sessionId)` → status !== `'capture'`? → approve immediately
    - Includes: no flag, status = `'frustrated'`, unknown statuses, empty string
  - Step 2: `parseTranscriptFile(transcriptPath)` → TranscriptData | null
  - Step 3: `generateNote(transcriptData, sessionId, llmProvider)` → AutoMemoryCandidate | null
  - Step 4: Dedup check via `getPendingDrafts()` → `storeCandidate(note)` if no duplicate
  - Step 5: `clearFlag(sessionId)` — guaranteed via `try...finally` pattern
  - Extracted `runCapturePipeline()` helper for readability (4-level nesting → 2-level)
  - Extracted `safeClearFlag()` utility for error-safe flag clearing
  - `APPROVE_RESPONSE` constant: `'{"decision":"approve"}'` (always)
  - Never throws — multi-layered error handling (getFlag, parse, generate, store, clearFlag each isolated)
  - 43 unit tests (flag absent, frustrated, capture full pipeline, null parse/note, throws at every stage, dedup, invalid input, clearFlag guarantee, edge cases)

---

## Phase 7: CLI & Integration

> **7.1, 7.2, and 7.3 are parallel.**
> All depend on all previous phases.

- [x] **7.1 CLI** ✅ `src/cli.ts`
  - `createProgram(deps)` factory with Commander.js — dependency injection for testability
  - `sentinel review list` — show pending drafts (formatted list with ID + frustrationSignature)
  - `sentinel review confirm <id>` — draft → experience (SQLite) + embedding (Vector Store)
    - Embedding text: `"{frustrationSignature}. Failed: {failedApproaches}. Fixed: {successfulApproach}. Lessons: {lessons}"`
    - Order: generate embedding first (async, may fail) → then store experience + vector + delete candidate
  - `sentinel review reject <id>` — delete draft
  - `sentinel --hook user-prompt-submit` — parse stdin JSON, delegate to handler
  - `sentinel --hook stop` — parse stdin JSON, delegate to handler
  - `sentinel status` — DB stats (experience count + pending draft count)
  - Added `getExperienceCount()` to SqliteStore for status command
  - Output through `configureOutput()` for testability
  - 34 unit tests (review list/confirm/reject, hook routing, status, edge cases)

- [x] **7.2 `sentinel init`** ✅ `src/cli/init-command.ts`
  - `initCommand(options: InitOptions): Promise<InitResult>` — pure function with injected paths
  - Auto-generate `.claude/settings.local.json` with hook config
    - Merge with existing file if present (don't overwrite user settings)
    - UserPromptSubmit + Stop hooks pointing to `sentinel --hook ...`
    - Idempotent: `hasSentinelHook()` detects existing sentinel hooks, prevents duplication
    - Graceful: malformed JSON in existing file treated as empty
  - Create `~/.sentinel/` directory (`{ recursive: true }`)
  - Create `~/.sentinel/settings.json` with DEFAULT_SETTINGS (only if not exists)
  - Injectable `ollamaHealthCheck` — warn if unreachable, skip if undefined, treat throw as unreachable
  - Returns `{ messages, warnings }` — never throws
  - 38 unit tests (clean env, merge, idempotency, settings contents, Ollama checks, edge cases)

- [x] **7.3 Integration Tests** ✅ `tests/integration/pipeline.integration.test.ts`
  - `SmartMockLLMProvider` — extends MockLLMProvider with sequential JSON responses for frustration/RAG
  - Active Recall: seed DB → matching prompt → systemMessage returned
  - Flag lifecycle: frustrated → resolution → Stop hook → draft created, flag cleared
  - Frustrated → abandonment → Stop hook → draft created
  - Frustrated → Stop fires while 'frustrated' → NO draft (still waiting)
  - CLI: review confirm → experience + vector stored
  - CLI: sentinel init → hook config + settings files created
  - Graceful degradation: LLM down → silent pass-through (both hooks)
  - Full round-trip: frustrated → resolution → Stop → confirm → recall
  - Pending draft notifications across sessions
  - 26 integration tests, all using MockLLMProvider (no Ollama dependency)

---

## Phase 8: Packaging & Distribution

> Sequential. Depends on all previous phases.

- [x] **8.1 npm Package Setup** ✅
  - `package.json`: `name: "dev-sentinel"`, `version`, `bin`, `files`, `engines`
  - `bin` field: `{ "sentinel": "./dist/cli.js" }` — npm package name is `dev-sentinel`, CLI binary is `sentinel`
  - `files` field: `["dist"]` — only ship `dist/`, not `src/` or `tests/`
  - `prepublishOnly` script: `npm run build && npm test`
  - Shebang line in cli.ts: `#!/usr/bin/env node`
  - Verify: `npm pack --dry-run` → confirm tarball contains only `dist/` + `package.json`
  - 27 unit tests (package.json structure, shebang, build output, npm pack verification)

---

## Parallel Work Summary

| Phase | Tasks | Parallel? |
|-------|-------|-----------|
| 1 | 1.1 → 1.2 | Sequential |
| 2 | 2.1, 2.2, 2.3 | **Parallel** |
| 3 | 3.1, 3.2 | **Parallel** |
| 4 | 4.1, 4.2 | **Parallel** |
| 5 | 5.1 | Sequential |
| 6 | 6.1, 6.2 | **Parallel** |
| 7 | 7.1, 7.2, 7.3 | **Parallel** |
| 8 | 8.1 | Sequential |

Critical path: `1.1 → 1.2 → 2.2 → 5.1 → 6.1 → 7.2`
