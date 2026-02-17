# Settings Reference

Sentinel configuration lives at `~/.sentinel/settings.json`. All fields are optional — sensible defaults are applied when omitted.

## Full Example

```json
{
  "enabled": true,
  "debug": false,
  "llm": {
    "provider": "ollama",
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "completionModel": "qwen3:4b",
      "embeddingModel": "qwen3-embedding:0.6b"
    },
    "bedrock": {
      "profile": "sentinel",
      "region": "us-east-1",
      "completionModel": "us.anthropic.claude-3-5-haiku-20241022-v1:0",
      "embeddingModel": "amazon.titan-embed-text-v2:0"
    }
  },
  "storage": {
    "dbPath": "~/.sentinel/sentinel.db"
  },
  "recall": {
    "maxAdvicesPerSession": 5
  },
  "analysis": {
    "frustrationThreshold": 0.85
  }
}
```

## Fields

### `enabled`

| | |
|---|---|
| Type | `boolean` |
| Default | `true` |

Enable or disable Sentinel. When `false`, hooks return immediately with no LLM calls, no DB access. Toggle via CLI:

```bash
sentinel disable    # Set enabled: false
sentinel enable     # Set enabled: true
sentinel status     # Check current state
```

### `debug`

| | |
|---|---|
| Type | `boolean` |
| Default | `false` |

When `true`, writes detailed hook logs to `~/.sentinel/hook-debug.log`. Useful for troubleshooting.

### `llm`

#### `llm.provider`

| | |
|---|---|
| Type | `"ollama"` or `"bedrock"` |
| Default | `"ollama"` |

Which LLM backend to use.

#### `llm.ollama`

| Field | Default | Description |
|-------|---------|-------------|
| `baseUrl` | `http://localhost:11434` | Ollama server URL |
| `completionModel` | `qwen3:4b` | Model for text analysis |
| `embeddingModel` | `qwen3-embedding:0.6b` | Model for vector embeddings |

Requires [Ollama](https://ollama.com) running locally with models pulled:

```bash
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
```

#### `llm.bedrock`

| Field | Default | Description |
|-------|---------|-------------|
| `profile` | _(none)_ | AWS profile name from `~/.aws/config`. If omitted, uses default credential chain (`AWS_PROFILE`, env vars, etc.) |
| `region` | `us-east-1` | AWS region |
| `completionModel` | `us.anthropic.claude-sonnet-4-20250514-v1:0` | Bedrock model ID for text analysis |
| `embeddingModel` | `amazon.titan-embed-text-v2:0` | Bedrock model ID for embeddings |

Minimal Bedrock setup:

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

### `storage`

#### `storage.dbPath`

| | |
|---|---|
| Type | `string` |
| Default | `~/.sentinel/sentinel.db` |

Path to the SQLite database. Supports `~` for home directory.

### `recall`

#### `recall.maxAdvicesPerSession`

| | |
|---|---|
| Type | `integer` (>= 1) |
| Default | `5` |

Maximum number of warnings Sentinel will show per Claude Code session. Prevents advice fatigue.

### `analysis`

#### `analysis.frustrationThreshold`

| | |
|---|---|
| Type | `number` (0 to 1) |
| Default | Provider-dependent (see below) |

Minimum confidence score required to classify a prompt as "frustrated". Higher values mean fewer false positives but may miss some genuine frustration.

**Provider defaults** (used when this field is omitted):

| Provider | Default Threshold |
|----------|-------------------|
| `ollama` | `0.75` |
| `bedrock` | `0.85` |

Bedrock models tend to produce higher confidence scores, so the default threshold is higher.

**Tuning guide:**

| Threshold | Behavior |
|-----------|----------|
| `0.70` | Sensitive — catches most frustration, more false positives |
| `0.85` | Balanced — catches clear frustration signals |
| `0.92` | Conservative — only explicit failure loops trigger |

Example: make Sentinel more sensitive:

```json
{
  "analysis": {
    "frustrationThreshold": 0.7
  }
}
```
