# Dev Sentinel

<div align="center">
<h3><em>"What broke you guards you."</em></h3>
</div>

Dev Sentinel watches your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions and does two things:

1. **Active Recall** — warns when you're about to repeat a past failure
2. **Experience Capture** — turns failure sessions into searchable knowledge

Claude has zero knowledge of Sentinel — your prompt passes through unchanged.

## Install

```bash
git clone https://github.com/elbanic/dev-sentinel.git
cd dev-sentinel
npm install
npm link
```

Requires [Ollama](https://ollama.com) running locally (default). Pull the models:

```bash
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
```

## Setup

In your project directory:

```bash
sentinel init
```

This registers three Claude Code hooks and creates default config:
- `.claude/settings.local.json` — UserPromptSubmit, Stop, SessionEnd hooks
- `~/.sentinel/settings.json` — Sentinel config (Ollama default)

## How it works

```
You type a frustrated prompt in Claude Code
  → Sentinel detects frustration (LLM analysis)
  → Searches past experiences via vector similarity
  → Injects a warning into Claude's context if match found

Capture triggers (either one creates a draft):
  1. You say "fixed it" or "forget it" → explicit resolution/abandonment
  2. Session ends while frustrated flag is active → automatic capture

You review drafts
  → sentinel review confirm  → LLM summarizes → stored as experience
  → sentinel review reject   → discarded

Same problem recurs and you find a better fix
  → Experience evolves: old solution demotes, new one replaces it
```

### Capture flow

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

See [EXAMPLE.md](EXAMPLE.md) for full walkthrough with diagrams.

## Experience Evolution

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

## Commands

```bash
# Hooks (called by Claude Code, not directly)
sentinel --hook user-prompt-submit
sentinel --hook stop
sentinel --hook session-end

# Control
sentinel init                        # Register hooks + create config
sentinel enable                      # Enable Sentinel
sentinel disable                     # Disable (hooks become no-op)
sentinel status                      # Show state + DB stats

# Experiences
sentinel list                        # List stored experiences
sentinel detail <id>                 # Full experience details
sentinel history <id>                # Revision history
sentinel delete <id>                 # Delete an experience
sentinel add <path>                  # Import .md files as experiences

# Drafts
sentinel review list                 # Show pending drafts
sentinel review detail <id>          # Full draft transcript
sentinel review confirm <id>         # Confirm → LLM summarize → store
sentinel review confirm --recent     # Confirm most recent draft
sentinel review confirm --all        # Confirm all pending drafts
sentinel review reject <id>          # Delete draft
sentinel review reject --all         # Delete all drafts

# Maintenance
sentinel reset --confirm             # Clear all data
sentinel debug on|off|--tail         # Toggle debug logging
```

## Config

`~/.sentinel/settings.json`:

```json
{
  "llm": {
    "provider": "ollama",
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "completionModel": "qwen3:4b",
      "embeddingModel": "qwen3-embedding:0.6b"
    }
  }
}
```

AWS Bedrock is also supported:

```json
{
  "llm": {
    "provider": "bedrock",
    "bedrock": {
      "profile": "my-aws-profile"
    }
  }
}
```

See [SETTINGS.md](SETTINGS.md) for all configuration options including frustration threshold tuning, debug logging, and more.

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

## License

MIT

Default models ([Qwen3](https://huggingface.co/Qwen/Qwen3-4B)) are licensed under Apache 2.0 by Alibaba Cloud. Models are not bundled — users download them independently via Ollama.
