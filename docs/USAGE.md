# Usage Guide

## 1. Build & Install (from source)

### Prerequisites

- Node.js >= 18
- npm
- [Ollama](https://ollama.com/) (for local LLM)

### Build

```bash
git clone <repo-url> dev-sentinel
cd dev-sentinel
npm install
npm run build
```

### Install globally

`npm link` registers the `sentinel` command globally so it can be invoked from any directory:

```bash
npm link
```

Verify the installation:

```bash
sentinel --help
```

### Pull required Ollama models

```bash
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
```

### Initialize hooks

```bash
sentinel init
```

This will:

1. Prompt you to choose **global** (`~/.claude/settings.json`) or **local** (`.claude/settings.local.json`) hook installation.
2. Create the `~/.sentinel/` directory.
3. Generate `~/.sentinel/settings.json` with default settings (if it doesn't already exist).

> Hook changes require restarting the Claude Code session.

---

## 2. Uninstall

### Step 1 — Remove the global command

```bash
cd /path/to/dev-sentinel
npm unlink
```

### Step 2 — Remove Claude Code hooks

Depending on how you installed (global or local), edit the appropriate file and remove the sentinel entries from the `hooks` object:

**Global** — `~/.claude/settings.json`:

```bash
# Open in your editor
vi ~/.claude/settings.json
```

**Local** — `.claude/settings.local.json` (inside your project):

```bash
vi .claude/settings.local.json
```

Remove the `sentinel --hook user-prompt-submit` and `sentinel --hook stop` entries from `UserPromptSubmit` and `Stop` arrays respectively. If sentinel was the only hook, you can remove the entire `hooks` key.

### Step 3 — Delete sentinel data

```bash
rm -rf ~/.sentinel
```

This removes the SQLite database, vector store, debug logs, and settings.

### Step 4 — (Optional) Unload Ollama models

If you no longer need the models:

```bash
ollama rm qwen3:4b
ollama rm qwen3-embedding:0.6b
```

---

## 3. Debug Mode

### Enable debug logging

Edit `~/.sentinel/settings.json`:

```json
{
  "debug": true
}
```

When enabled, sentinel writes timestamped log entries to `~/.sentinel/hook-debug.log`.

### Watch logs in real time

```bash
tail -f ~/.sentinel/hook-debug.log
```

### Inspect the database directly

```bash
# Recent session turns
sqlite3 ~/.sentinel/sentinel.db \
  "SELECT session_id, substr(prompt, 1, 60), analysis
   FROM session_turns ORDER BY rowid DESC LIMIT 10;"

# Flagged sessions
sqlite3 ~/.sentinel/sentinel.db \
  "SELECT * FROM session_flags ORDER BY flagged_at DESC LIMIT 10;"

# Pending drafts
sqlite3 ~/.sentinel/sentinel.db \
  "SELECT id, session_id, status, frustration_signature
   FROM auto_memory_candidates;"
```

For a comprehensive debugging reference, see [DEBUG.md](./DEBUG.md).

---

## 4. System Requirements for Qwen3 (Local LLM)

Dev Sentinel uses two Ollama models by default:

| Model | Purpose | Size |
|-------|---------|------|
| `qwen3:4b` | Frustration analysis, note generation, relevance judging | ~2.5 GB |
| `qwen3-embedding:0.6b` | Text embedding for vector search | ~0.4 GB |

### Minimum specs (to avoid impacting other sessions)

The key concern is that Ollama model inference should not starve Claude Code or other processes of resources. Ollama loads models into memory (VRAM or RAM) and processes requests sequentially by default.

#### Apple Silicon Mac (recommended)

| Spec | Minimum | Recommended |
|------|---------|-------------|
| Chip | M1 | M1 Pro / M2 or later |
| RAM | 16 GB | 32 GB |
| Disk | 5 GB free (for models) | 10 GB free |

Apple Silicon shares unified memory between CPU and GPU. With 16 GB, Ollama uses ~3 GB for models, leaving ~13 GB for the OS, Claude Code, editors, and browsers. This is workable but tight — close unnecessary apps during heavy sessions.

#### Intel / AMD (CPU-only inference)

| Spec | Minimum | Recommended |
|------|---------|-------------|
| RAM | 16 GB | 32 GB |
| CPU | 4 cores | 8+ cores |
| Disk | 5 GB free | 10 GB free |

Without a GPU, Ollama runs entirely on CPU. qwen3:4b inference will be slower (~30-60s per call) and will briefly spike CPU usage. 32 GB RAM is strongly recommended to avoid memory pressure.

#### With discrete GPU (NVIDIA)

| Spec | Minimum | Recommended |
|------|---------|-------------|
| VRAM | 4 GB | 6+ GB |
| RAM | 16 GB | 16 GB |
| Disk | 5 GB free | 10 GB free |

With a CUDA-capable GPU, Ollama offloads inference to the GPU, keeping CPU and system RAM free for other processes. This is the best setup for multi-session work.

### Performance notes

- **Ollama sequential processing**: Ollama handles one inference request at a time by default. Sentinel hooks queue behind each other but do not block Claude Code's own operations.
- **Thinking mode overhead**: qwen3:4b generates `<think>` blocks (~600 tokens of reasoning) before each response. This adds ~10-20s per call on typical hardware. See [DEBUG.md](./DEBUG.md) § Known Issues for mitigation options.
- **Model loading**: The first request after Ollama starts (or after model eviction) incurs a one-time model loading delay (~5-10s). Subsequent requests are faster since the model stays in memory.
- **Cloud alternative**: If local resources are constrained, switch to AWS Bedrock by setting `llm.provider` to `"bedrock"` in `~/.sentinel/settings.json`. Cloud inference is ~1-3s per call with no local resource usage.
