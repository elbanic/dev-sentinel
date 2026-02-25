# Dev Sentinel

<div align="center">

**Struggle Equity.**

*What broke you guards you.*

</div>

Dev Sentinel watches your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions and turns your struggles into reusable knowledge. Claude has zero knowledge of Sentinel — your prompt passes through unchanged.

---

### How It Works

1. **Generate Experience from Frustration**

   Detect struggle and turn it into structured memory.

2. **Evolve the Experience**

   Refine raw failure into hardened knowledge.

3. **Validate the Guard**

   Measure whether past lessons actually prevent repetition.

4. **Connect the Patterns**

   Link failures across contexts to uncover root causes.

*The result: struggles compound into engineering intuition.*

---

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

For best performance, AWS Bedrock is also supported (requires AWS credentials). See [SETTINGS.md](SETTINGS.md).

## Setup

In your project directory:

```bash
sentinel init
```

This registers Claude Code hooks and creates default config:
- `.claude/settings.local.json` — UserPromptSubmit, Stop, SessionEnd hooks
- `~/.sentinel/settings.json` — Sentinel config

## Quick Start

### Dashboard

```bash
sentinel dashboard
```

Opens a local web dashboard showing your experiences, drafts, and patterns at a glance. Data populates as you use Sentinel and confirm experiences.

### Review Drafts

When Sentinel captures a struggle session, it creates a draft for your review:

```bash
sentinel review list                 # Show pending drafts
sentinel review confirm <id>         # Confirm → LLM summarizes → stored as experience
sentinel review confirm --recent     # Confirm most recent draft
sentinel review confirm --all        # Confirm all pending drafts
```

## More

- [COMMANDS.md](COMMANDS.md) — Full command reference
- [SETTINGS.md](SETTINGS.md) — Configuration options
- [EXAMPLE.md](EXAMPLE.md) — Walkthrough with diagrams

## License

MIT

Default models ([Qwen3](https://huggingface.co/Qwen/Qwen3-4B)) are licensed under Apache 2.0 by Alibaba Cloud. Models are not bundled — users download them independently via Ollama.
