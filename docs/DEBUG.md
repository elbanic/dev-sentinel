# Debugging Dev Sentinel

---

## 1. Hook Log

```bash
tail -f ~/.sentinel/hook-debug.log
```

- `[user-prompt-submit]` — UserPromptSubmit hook
- `[stop]` — Stop hook

---

## 2. SQLite Queries

DB path: `~/.sentinel/sentinel.db`

### Recent turns

```bash
sqlite3 ~/.sentinel/sentinel.db \
  "SELECT session_id, substr(prompt, 1, 60), analysis
   FROM session_turns ORDER BY rowid DESC LIMIT 10;"
```

### Flagged sessions

```bash
sqlite3 ~/.sentinel/sentinel.db \
  "SELECT * FROM session_flags ORDER BY flagged_at DESC LIMIT 10;"
```

### Draft candidates

```bash
sqlite3 ~/.sentinel/sentinel.db \
  "SELECT id, session_id, status, frustration_signature, substr(failed_approaches, 1, 100), substr(lessons, 1, 100)
   FROM auto_memory_candidates;"
```

### Confirmed experiences

```bash
sqlite3 ~/.sentinel/sentinel.db \
  "SELECT id, frustration_signature, substr(lessons, 1, 100) FROM experiences;"
```

### Reset DB

```bash
rm -f ~/.sentinel/sentinel.db ~/.sentinel/vectors.db
```

---

## 3. Hook Configuration

`.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "sentinel --hook user-prompt-submit"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "sentinel --hook stop"
          }
        ]
      }
    ]
  }
}
```

Hook changes require restarting the Claude Code session.

---

## 4. Ollama Verification

### Check running models

```bash
curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; [print(m['name']) for m in json.load(sys.stdin)['models']]"
```

### Test LLM directly

```bash
curl -s http://localhost:11434/api/generate -d '{
  "model": "qwen3:4b",
  "prompt": "Why isn't this error getting fixed",
  "system": "Analyze the developer prompt. Classify as frustrated/resolution/abandonment/normal. Return JSON: { type: \"normal\"|\"frustrated\"|\"resolution\"|\"abandonment\", confidence: number, intent: string, context: string, reasoning: string }. Only JSON.",
  "stream": false
}' | python3 -c "import sys,json; print(json.load(sys.stdin)['response'])"
```

### Test embedding

```bash
curl -s http://localhost:11434/api/embeddings -d '{
  "model": "qwen3-embedding:0.6b",
  "prompt": "DynamoDB timeout error retry"
}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'dimensions: {len(d[\"embedding\"])}')"
```

---

## 5. Known Issues: Ollama Timing

### qwen3:4b thinking mode bottleneck

qwen3:4b generates `<think>` blocks (~600 tokens of reasoning) before each JSON response → ~20s per call.

### Ollama sequential processing

Ollama processes requests sequentially by default. Two "parallel" LLM calls actually queue.

**Mitigations**:

| Option | Approach |
|--------|----------|
| `OLLAMA_NUM_PARALLEL=2` | Enable parallel processing in Ollama |
| `num_predict` limit | Add `options.num_predict: 500` to reduce thinking overhead |
| Cloud LLM | Switch to Bedrock (~1-3s per call) |

### Flaky tests

CLI integration tests that spawn real processes connecting to Ollama are inherently flaky. All unit/property tests should use `MockLLMProvider` for determinism. See `docs/LESSONS_LEARNED.md` §6.

---

## 6. Pipeline Debugging

### "No warning shown" when expected

1. Check hook log for response: `grep "Response stdout" ~/.sentinel/hook-debug.log | tail -5`
2. Check if experiences exist: `SELECT count(*) FROM experiences`
3. Check vector store: `sqlite3 ~/.sentinel/vectors.db "SELECT count(*) FROM vectors"`
4. Test embedding works: (see §4)

### "No draft generated" after frustration

1. Check flag status: `SELECT session_id, status FROM session_flags WHERE session_id = '...'`
   - No row → session was never flagged (frustration not detected)
   - `status = 'frustrated'` → waiting for resolution/abandonment (this is normal — draft not yet due)
   - `status = 'capture'` → Stop hook should have generated draft — check steps below
2. Check if transcript file exists at the path from hook input
3. Check dedup: `SELECT * FROM auto_memory_candidates WHERE session_id = '...'`
4. Check hook log: `grep "stop" ~/.sentinel/hook-debug.log | tail -5`
