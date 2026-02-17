# E2E Test Session — Qwen3 (Ollama)

> Qwen3:4b local LLM provider E2E test results. Using `/api/chat` + `think:false` + `format:"json"`.

---

## Environment

| Item | Value |
|------|-------|
| LLM Provider | Ollama |
| Completion Model | `qwen3:4b` |
| Embedding Model | `qwen3-embedding:0.6b` |
| Base URL | `http://localhost:11434` |
| Target Project | (local project) |

### Settings

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

---

## Test Scenarios

### Scenario 1: Experience Capture (Frustration → Resolution)

```
Prompt 1 (frustrated): Where is tailwind.config.ts? Answer fast
Prompt 2 (frustrated): It's not at that path. I've been looking but the config doesn't work. Why?
Prompt 3 (frustrated): That doesn't work either. Checked postcss.config too, still not applying
Prompt 4 (resolution): Got it! The @tailwind import was missing in globals.css. Fixed, thanks
```

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Prompt 1 analysis | frustrated | | |
| Prompt 2 analysis | frustrated | | |
| Prompt 3 analysis | frustrated | | |
| Prompt 4 analysis | resolution | | |
| Flag lifecycle | frustrated → capture → cleared | | |
| Transcript parsing | Messages extracted | | |
| Note generation | Structured JSON from LLM | | |
| Draft stored | Candidate in DB | | |
| Experience quality | Meaningful fields | | |

### Scenario 2: Active Recall

```
CSS isn't applying, I think the tailwind config file is the problem
```

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Analysis | frustrated | | |
| Vector search | Match found | | |
| RAG judge | Relevant | | |
| systemMessage | Warning with boxed UI | | |

### Scenario 3: Experience Capture (Frustration → Abandonment)

```
Prompt 1 (normal):       Explain the project structure
Prompt 2 (frustrated):   I set the environment variables but the DB won't connect. What's wrong?
Prompt 3 (frustrated):   Did what you said, still getting connection refused. Makes no sense
Prompt 4 (abandonment):  Forget it. I'll revisit this later. Let's move on
```

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Prompt 1 analysis | normal | | |
| Prompt 2 analysis | frustrated | | |
| Prompt 3 analysis | frustrated | | |
| Prompt 4 analysis | abandonment | | |
| Flag lifecycle | frustrated → capture → cleared | | |
| Note generation | successfulApproach = null | | |
| Draft stored | Candidate in DB | | |

---

## Debug Commands

```bash
tail -f ~/.sentinel/hook-debug.log
sqlite3 ~/.sentinel/sentinel.db "SELECT substr(prompt,1,40), analysis FROM session_turns ORDER BY id DESC LIMIT 10;"
sqlite3 ~/.sentinel/sentinel.db "SELECT * FROM session_flags;"
sentinel review list
```
