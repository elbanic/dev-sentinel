# Dev Sentinel — Product Requirements Document

> **Version:** 1.0

---

## Philosophy

> **What broke you guards you.**

AI coding tools are project-scoped by design. Each session starts fresh —
accumulated context degrades performance, and cross-project knowledge
derails the current task. This is the right design.

However, developers repeat themselves. Similar errors, similar approaches,
similar failures — and eventually, a hard-won lesson. But that lesson
lives only in the developer's head, invisible to any tool, lost across
sessions and projects.

What if those experiences of failure and frustration could be generalized
to help you before you repeat them?

Sentinel is not about project or organization-level knowledge sharing.
It is a developer's personal experience, generalized and recalled at the
right moment — "you've been here before."

---

## What It Does

```
Developer: "Fix this error with retry"
                │
                ▼
        Sentinel (invisible watchdog)
        "3 months ago, retry failed. The root cause was partition key skew."
                │
                ▼
        ⚡ Sentinel (confidence: 85%)
        ├──────────────────────────────────────────────┤
         ▸ 3 months ago, you tried retry for this
           error and it failed. Root cause was
           partition key skew.
         → "Check partition key distribution first"
        ╰──────────────────────────────────────────────╯

        Claude has no idea this warning exists.
        The prompt is passed through unchanged.
        Only the developer sees it.
```

---

## Design Principles

### 1. Silence is the default
Say nothing most of the time. Intervene **only** when a signal related to a past failure is detected.

### 2. Never speak without evidence
Don't give generic advice. Present evidence from **this developer's own** past failure records. Every warning includes a source experience and confidence score.

### 3. Never invade Claude's territory
Never modify the prompt or inject into Claude's context. Claude is completely unaware of Sentinel's existence.

### 4. Never stop Claude from working
If Sentinel crashes, Claude Code continues normally. All errors are swallowed silently.

---

## Use Cases

### UC-1: Frustrated retry detection

Intervene when a frustrated developer is about to retry an approach that failed before.

| Prompt | Frustrated? | Past Record | Intervene? |
|--------|------------|-------------|------------|
| "Why isn't this working again, try retry" | Yes | Retry failed previously | Yes |
| "Fix this error with retry" | No | Retry failed previously | No (not frustrated) |
| "Check partition key distribution" | Yes | Successful approach | No (no conflict) |

### UC-2: Frustration detection → automatic experience capture

Automatically save a draft when the developer struggles and eventually resolves (or abandons) the issue.

```
Turn 1: "Fix this error"
         → LLM: type = 'normal' → pass through
         → Claude responds → Stop fires → no flag → skip

Turn 2: "Ugh, still not working"
         → LLM: type = 'frustrated' → flag session ('frustrated')
         → Claude responds → Stop fires → flag = 'frustrated' → skip (waiting)

Turn 3: "Any other approach?"
         → LLM: type = 'frustrated' → already flagged
         → Claude responds → Stop fires → flag = 'frustrated' → skip (waiting)

Turn 4: "Oh that's it! It works!"
         → LLM: type = 'resolution' → upgrade flag → 'capture'
         → Claude responds → Stop fires → flag = 'capture'
         → parse transcript → generate draft → clear flag
```

---

## Core Features

| # | Feature | Description |
|---|---------|-------------|
| F1 | **Hook Integration** | UserPromptSubmit + Stop hook. Returns `{}` or `{"systemMessage": "..."}` |
| F2 | **Frustration Detection** | LLM classifies each prompt as `normal`, `frustrated`, `resolution`, or `abandonment`. Korean + English |
| F3 | **Active Recall (RAG)** | Vector search + LLM judge → advice from past experiences |
| F4 | **Experience Capture** | Transcript parsing → auto-generate failure note drafts |
| F5 | **Draft Review CLI** | `sentinel review list/confirm/reject` |
| F6 | **LLM Abstraction** | Ollama (local) / Bedrock (cloud). `generateCompletion` + `generateEmbedding` |
| F7 | **Graceful Degradation** | Any failure results in silent pass-through |

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Frustration detection accuracy | > 80% |
| False positive rate | < 20% |
| Total analysis + warning latency | < 3000ms |
| Impact on Claude when Sentinel fails | 0 |
