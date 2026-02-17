# Dev Sentinel

<div align="center">
<h3><em>"We fail every day, but that failure becomes the success of our next attempt."</em></h3>
</div>

Dev Sentinel watches your Claude Code sessions and does two things:

1. **Warns** when you're about to repeat a past failure
2. **Captures** new failure experiences for future reference

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

This creates:
- `.claude/settings.local.json` — Claude Code hooks
- `~/.sentinel/settings.json` — Sentinel config (Ollama default)

## How it works

```
You type a frustrated prompt in Claude Code
  → Sentinel detects frustration (LLM)
  → Searches past experiences for a match
  → Injects a warning if found

Session ends with resolution/abandonment
  → Transcript automatically saved as draft by Sentinel

You review and confirm through `sentinel review list`
  → Stored as experience for future sessions
```

See [EXAMPLE.md](EXAMPLE.md) for full walkthrough of all three scenarios.

## Commands

```bash
sentinel enable              # Enable Sentinel
sentinel disable             # Disable Sentinel (hooks become no-op)
sentinel status              # Show enabled/disabled state + DB stats
sentinel list                # List stored experiences
sentinel detail <id>         # Show full experience details
sentinel delete <id>         # Delete an experience
sentinel add <path>          # Import .md files as experiences
sentinel review list         # Show pending drafts
sentinel review detail <id>  # Show full draft transcript
sentinel review confirm <id> # Confirm draft → experience
sentinel review reject <id>  # Delete draft
sentinel reset --confirm     # Clear all data
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

## License

MIT

Default models ([Qwen3](https://huggingface.co/Qwen/Qwen3-4B)) are licensed under Apache 2.0 by Alibaba Cloud. Models are not bundled — users download them independently via Ollama.
