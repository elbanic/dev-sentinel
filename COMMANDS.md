# Commands Reference

## Hooks

Called by Claude Code automatically — not intended for direct use:

```bash
sentinel --hook user-prompt-submit   # Frustration detection + active recall
sentinel --hook stop                 # Capture on resolution/abandonment
sentinel --hook session-end          # Capture on session close
```

## Control

```bash
sentinel init                        # Register hooks + create config
sentinel enable                      # Enable Sentinel
sentinel disable                     # Disable (hooks become no-op)
sentinel status                      # Show state + DB stats
```

## Experiences

```bash
sentinel list                        # List stored experiences
sentinel detail <id>                 # Full experience details
sentinel history <id>                # Revision history
sentinel delete <id>                 # Delete an experience
sentinel add <path>                  # Import .md files as experiences
```

## Drafts

```bash
sentinel review list                 # Show pending drafts
sentinel review detail <id>          # Full draft transcript
sentinel review confirm <id>         # Confirm → LLM summarize → store
sentinel review confirm --recent     # Confirm most recent draft
sentinel review confirm --all        # Confirm all pending drafts
sentinel review reject <id>          # Delete draft
sentinel review reject --all         # Delete all drafts
```

## Dashboard

```bash
sentinel dashboard                   # Start local web dashboard (default port 3456)
sentinel dashboard --port 8080       # Custom port
```

## Maintenance

```bash
sentinel reset --confirm             # Clear all data
sentinel debug on|off|--tail         # Toggle debug logging
```

## How It Works (Technical)

### Capture Flow

```
UserPromptSubmit hook:
  prompt → LLM frustration analysis
  ├─ frustrated    → flag session + search memory (warn if match)
  ├─ resolution    → upgrade flag to 'capture'
  ├─ abandonment   → upgrade flag to 'capture'
  └─ normal        → pass through

Stop hook (after each Claude response):
  flag = 'capture' → store transcript as draft → clear flag

SessionEnd hook (session closes):
  flag = 'frustrated' → upgrade to 'capture' → store draft → clear flag
```

The SessionEnd hook ensures frustrated sessions are captured even when the developer moves on without saying anything — which is the common case.

### Experience Evolution

Experiences are not static. When you encounter the same problem and find a better solution, Sentinel evolves the existing experience instead of creating a duplicate:

```
Experience "Jest mock leaking" (v1):
  failed:  ["Cleared Jest cache"]
  success: "Used jest.isolateModules()"

  ── weeks later, same problem and another project ──

Experience "Jest mock leaking" (v2):
  failed:  ["Cleared Jest cache", "jest.isolateModules() — fragile"]
  success: "Refactored to dependency injection"
  revision: 2
```

This happens automatically during `sentinel review confirm` when the draft matches an existing experience. An LLM judge decides whether the new solution is better.

## Architecture

```
src/
├── hook/                     # Claude Code hook handlers
│   ├── user-prompt-submit-handler.ts   # Frustration detection + recall
│   ├── stop-hook-handler.ts            # Capture on resolution/abandonment
│   └── session-end-handler.ts          # Capture on session close
├── analysis/                 # LLM-based frustration analyzer
├── recall/                   # RAG memory matcher (vector search + judge)
├── capture/                  # Transcript parser + note generator
├── llm/                      # Provider abstraction (Ollama / Bedrock)
├── storage/                  # SQLite metadata + vector store
├── config/                   # Settings loader
└── cli.ts                    # CLI entry point (Commander)
```

All data stays local. Cloud LLM (Bedrock) is opt-in. Every pipeline stage is individually try-caught — Sentinel failure never affects Claude Code.
