# CLAUDE.md - Dev Sentinel

## Language Preferences

- **Conversation**: Always respond in Korean
- **Documentation & Code**: Write in English by default (unless explicitly requested otherwise)

## Git Commit Rules

- **Do NOT add Co-Authored-By** line in commit messages
- Before committing or pushing, ALWAYS review the code to ensure you're not uploading any security-related credentials.
- **NEVER push if the GitHub repo is public.** Before any `git push`, check repo visibility with `gh repo view --json visibility`. If `"visibility": "PUBLIC"`, REFUSE to push and warn the user. Do NOT push even if the user explicitly requests it — always ask them to make the repo private first.

## Code Change Approval

- **All implementation MUST be approved by the user before starting.** When you find an issue or plan a change, describe the problem and proposed solution first. Do NOT start writing code until the user explicitly says to proceed.
- **Deleting unused code MUST require explicit user approval.** Analysis and reporting are fine, but NEVER delete files or remove code without the user clearly saying to do so.
- **Analyze before implementing.** When a problem is found, verify root cause with actual evidence (logs, API calls, test output) before proposing a fix. Do NOT guess at solutions or chain assumptions — one wrong assumption leads to cascading bad changes that make the codebase worse.

## Documentation Lookup

- **When implementing with frameworks or libraries (e.g., Zod, Commander, better-sqlite3, Jest, fast-check, AWS SDK), ALWAYS use context7 MCP to fetch up-to-date documentation first.** Do not rely on memory alone — API surfaces change across versions.

## Shell / CLI Testing

- **NEVER use `!` (exclamation mark) in shell commands or test strings.** Bash interprets `!` as history expansion, causing commands to silently fail or produce unexpected results. Use alternative phrasing or escape with `\!` if absolutely necessary.

## Anti-Patterns (NEVER use)

- **Keyword matching / hardcoded word lists**: Do NOT use hardcoded keyword sets, phrase lists, or regex-based classification for analysis tasks. All analysis (intent, sentiment, frustration detection, lesson summarization) MUST use LLM. If you need to improve extraction quality, use LLM summarization, not string matching.
- **Over-abstraction**: No CachedAnalyzer wrappers, ParallelAgent wrappers, StreamingPipeline wrappers, or ReflectiveJudge wrappers. Keep pipeline stages as direct function calls.
- **Observer/state machine for sentiment**: Do NOT use a state machine to track frustration→resolution patterns. Use LLM analysis on the prompt directly.

---

## Project Philosophy

> **Struggle Equity.** *What broke you guards you.*

Dev Sentinel watches Claude Code sessions and turns developer struggles into reusable knowledge. Claude has zero knowledge of Sentinel — the prompt passes through unchanged.

### How It Works

1. **Generate Experience from Frustration** — Detect struggle and turn it into structured memory.
2. **Evolve the Experience** — Refine raw failure into hardened knowledge.
3. **Validate the Guard** — Measure whether past lessons actually prevent repetition.
4. **Connect the Patterns** — Link failures across contexts to uncover root causes.

The result: struggles compound into engineering intuition.

### What Sentinel Is NOT

Sentinel does not just handle errors or provide solutions. It reminds the developer: "You've been here before — you might be circling the same trap. Consider shifting your approach." Sentinel is a **perspective nudge** and an **experience building assistant**.

---

## Architecture: Unified Frustration Pipeline

```
UserPromptSubmit hook:
  prompt
  └─ LLM: frustration analysis → type?
     ├─ frustrated → setFlag('frustrated') + searchMemory()
     │                ├─ match → systemMessage (Active Recall)
     │                └─ no match → wait for outcome
     ├─ resolution/abandonment → upgradeFlag('capture')
     └─ normal → pass through (stdout: '{}')

Stop hook (fires after every Claude response):
  flag status?
  ├─ 'capture' → store full transcript → create draft → clearFlag() (Experience Capture)
  └─ otherwise → skip (stdout: '{"decision":"approve"}')

User (async):
  sentinel review list → confirm/reject drafts
  confirmed → experiences table + vector store
```

### Key Design Decisions

1. **Single analysis point**: Frustration detection happens ONCE in UserPromptSubmit, not split across hooks
2. **2-stage flag capture**: `'frustrated'` (waiting for outcome) → `'capture'` (ready for draft). Prevents incomplete drafts since Stop hook fires after every response.
3. **LLM-only analysis**: No keyword fallback, no state machines. LLM fails → graceful skip
4. **Local-first**: All data stored locally. Cloud LLM is opt-in
5. **Graceful degradation**: Every pipeline stage is individually try-caught. Sentinel failure never affects Claude Code
6. **Full transcript storage**: Stop hook stores the complete session transcript without slicing. Context extraction is deferred to `sentinel review confirm`, where LLM receives the full transcript + frustration metadata to identify the relevant portion.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js |
| Metadata DB | SQLite (better-sqlite3) |
| Vector DB | SQLite-backed vector store |
| Embedding | Ollama (qwen3-embedding) / AWS Bedrock (Titan) |
| LLM | Ollama (local, default) / AWS Bedrock (cloud, opt-in) |
| Testing | Jest + fast-check (property-based) |
| CLI | Commander |
| Validation | Zod |

---

## Directory Structure (target)

```
src/
├── types/                    # TypeScript interfaces + Zod schemas
├── llm/                      # LLM provider abstraction
│   ├── local-llm-provider.ts    # Ollama
│   ├── bedrock-llm-provider.ts  # AWS Bedrock
│   ├── mock-llm-provider.ts     # Testing
│   ├── llm-provider-manager.ts  # Provider selection + fallback
│   └── prompts.ts               # System prompts
├── storage/                  # Data persistence
│   ├── sqlite-store.ts          # Metadata DB
│   └── vector-store.ts          # Embedding storage + search
├── analysis/                 # Frustration detection
│   └── frustration-analyzer.ts  # LLM-based: normal|frustrated|resolution|abandonment
├── capture/                  # Experience Capture (Stop hook)
│   ├── transcript-parser.ts     # JSONL transcript → structured data
│   └── note-generator.ts        # structured data → failure note draft
├── recall/                   # Active Recall (UserPromptSubmit hook)
│   └── memory-matcher.ts        # RAG: search vector store + judge relevance
├── hook/                     # Claude Code hook handlers
│   ├── user-prompt-submit-handler.ts
│   └── stop-hook-handler.ts
├── config/                   # Configuration
│   └── settings-loader.ts
├── cli/                      # CLI utilities
│   └── init-command.ts          # sentinel init
└── cli.ts                    # CLI entry point

tests/
├── unit/
└── property/
```

---

## Core Components

### 1. LLM Provider (`src/llm/`)
- `LLMProvider` interface: `generateCompletion(system, user)`, `generateEmbedding(text)`, `isAvailable()`
- Ollama provider (local, default)
- Bedrock provider (cloud, opt-in via settings)
- Mock provider (testing)
- Provider manager: provider selection, health check, graceful fallback

### 2. Vector Store (`src/storage/vector-store.ts`)
- SQLite-backed vector storage
- Cosine similarity search
- Dimension-agnostic (adapts to embedding model)

### 3. Transcript Parser (`src/capture/transcript-parser.ts`)
- Parse Claude Code JSONL transcript files
- Extract: user messages, assistant messages, tool calls, error messages
- Structured `TranscriptData` output

### 4. Frustration Analyzer (`src/analysis/frustration-analyzer.ts`)
- Single LLM call per prompt → `{ type, confidence, intent, context, reasoning }`
- `type`: `'normal'` | `'frustrated'` | `'resolution'` | `'abandonment'`
- Graceful fallback: `{ type: 'normal', confidence: 0 }` on any failure

### 5. RAG Memory Matcher (`src/recall/memory-matcher.ts`)
- Embed current prompt → search vector store for similar experiences
- LLM judge: is the match actually relevant?
- Returns match with confidence + suggested action

### 6. CLI (`src/cli.ts`)
- `sentinel init` — auto-configure hooks + settings
- `sentinel review list` — pending drafts
- `sentinel review confirm <id>` — draft → experience + vector store
- `sentinel review reject <id>` — delete draft
- `sentinel status` — DB stats

---

## TDD-First Development (Mandatory)

**ALL code changes MUST follow the TDD workflow.** Exceptions: pure docs, config files.

This project uses a 4-agent TDD feedback loop. Agents are defined in `.claude/agents/`.

| Agent | TDD Phase | Purpose |
|-------|-----------|---------|
| 🧪 `test-architect` | RED | Design & write failing tests |
| ⚙️ `implementer` | GREEN | Write minimal code to pass tests |
| 🔍 `code-reviewer` | Quality Gate | Review code, approve/reject |
| ✨ `refactorer` | REFACTOR | Improve code without changing behavior |

### TDD Cycle

```
🧪 test-architect → ⚙️ implementer → 🔍 code-reviewer → ✨ refactorer
                                           │
                                      REJECT → back to implementer
```

### Loop Rules

- MAX 3 ITERATIONS per cycle
- If unresolved after 3 loops: **STOP** and report to user
- On task completion: **ASK** user confirmation before updating TODO.md

---

## Lessons Learned (from claude-sentinel v1)

See `docs/LESSONS_LEARNED.md` for detailed technical lessons.
