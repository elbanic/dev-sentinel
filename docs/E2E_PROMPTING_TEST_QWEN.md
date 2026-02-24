# E2E Prompting Test — Qwen (Local Ollama)

Manual end-to-end tests that exercise the full Sentinel pipeline with a local Ollama LLM.
These tests verify that the local-first experience works correctly for users who prefer not to use cloud providers.

**Completion Model**: `qwen3:4b` (Ollama)
**Embedding Model**: `qwen3-embedding:0.6b` (Ollama)
**Frustration Threshold**: 0.75

---

## Vector DB Re-embedding: Why It's Required

### The Problem

Sentinel stores experience embeddings as raw float arrays in `vectors.db`. When you switch embedding models (e.g., Bedrock Titan → Qwen), the stored vectors become **incompatible** with new query vectors:

- Different models produce embeddings in **different vector spaces** — even if the dimensions happen to match (both Titan and Qwen produce 1024-dim vectors), the values are not comparable
- Cosine similarity between a Titan-generated vector and a Qwen-generated query vector produces **meaningless results** — matches will be random, not semantic
- Active Recall and duplicate detection both depend on vector search, so **both features silently break** without re-embedding

### The Solution

Before testing with a different embedding model, re-embed all existing experiences:

```bash
# 1. Back up existing vector DB (optional)
cp ~/.sentinel/vectors.db ~/.sentinel/vectors-bedrock-backup.db

# 2. Remove current vectors.db
rm ~/.sentinel/vectors.db

# 3. Re-embed all experiences with the new model
npx ts-node -e '
import { SqliteStore } from "./src/storage/sqlite-store";
import { VectorStore } from "./src/storage/vector-store";
import { LocalLLMProvider } from "./src/llm/local-llm-provider";
import { resolveHome } from "./src/utils/resolve-home";

async function reembed() {
  const dbPath = resolveHome("~/.sentinel/sentinel.db");
  const sqliteStore = new SqliteStore(dbPath);
  sqliteStore.initialize();

  const vectorStore = new VectorStore(resolveHome("~/.sentinel/vectors.db"));
  vectorStore.initialize();

  const llm = new LocalLLMProvider(
    "http://localhost:11434",
    "qwen3:4b",
    "qwen3-embedding:0.6b",
  );

  const experiences = sqliteStore.getAllExperiences();
  console.log(`Re-embedding ${experiences.length} experiences with Qwen...`);

  for (const exp of experiences) {
    const failed = exp.failedApproaches.join("; ");
    const fixed = exp.successfulApproach ?? "";
    const lessons = exp.lessons.join("; ");
    const text = `${exp.frustrationSignature}. Failed: ${failed}. Fixed: ${fixed}. Lessons: ${lessons}`;

    const embedding = await llm.generateEmbedding(text);
    vectorStore.store(exp.id, embedding, { frustrationSignature: exp.frustrationSignature });
    console.log(`  OK: ${exp.id} (${exp.frustrationSignature.substring(0, 50)}...)`);
  }

  console.log("Done.");
  sqliteStore.close();
  vectorStore.close();
}

reembed().catch(console.error);
'
```

**Key point**: Experience metadata in `sentinel.db` (SQLite) is model-agnostic — only the vector DB needs re-embedding. No data is lost.

### Future Consideration

A `sentinel re-embed` CLI command or model-specific vector DB files (`vectors-{model}.db`) would eliminate this manual step. See discussion in the codebase for tradeoffs.

---

## Prerequisites

```bash
# 1. Switch provider to ollama
# In ~/.sentinel/settings.json, set:
#   "llm": { "provider": "ollama", ... }

# 2. Verify Ollama is running with required models
curl -s http://localhost:11434/api/tags | python3 -c \
  "import sys,json; [print(m['name']) for m in json.load(sys.stdin).get('models',[])]"
# Expected: qwen3:4b, qwen3-embedding:0.6b

# 3. Re-embed existing experiences (see above)

# 4. Verify
npx ts-node src/cli.ts status
# Expected: Status: enabled, Experiences: N (matching SQLite count)
```

---

## Test 1: Draft Confirm — LLM Summarization

**Goal**: Verify that Qwen extracts structured fields from raw transcript.

### Steps

```bash
# 1. Frustrated prompt (new topic to avoid evolution)
echo '{"prompt":"pip install keeps failing with dependency conflicts. I have tried pip install --upgrade and pip cache purge but nothing works. The numpy version requirement keeps conflicting with pandas.","session_id":"qwen-test-010"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit

# 2. Resolution
echo '{"prompt":"Fixed it. The issue was that I had both numpy 1.x and 2.x requirements from different packages. Using pip install --constraint with a constraints.txt file that pins numpy to 1.26 resolved all conflicts.","session_id":"qwen-test-010"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit

# 3. Stop hook with transcript
cat > /tmp/sentinel-qwen-test1.jsonl << 'EOF'
{"type":"human","message":{"role":"user","content":"pip install keeps failing with dependency conflicts. I have tried pip install --upgrade and pip cache purge but nothing works. The numpy version requirement keeps conflicting with pandas."}}
{"type":"assistant","message":{"role":"assistant","content":"Let me analyze the dependency conflict. This is likely a version pinning issue between numpy and pandas."}}
{"type":"tool_use","name":"Bash","input":{"command":"pip install pandas numpy 2>&1 | tail -20"},"output":"ERROR: Cannot install pandas 2.1.0 and numpy 2.0.0 because these package versions have conflicting dependencies.\nThe conflict is caused by: pandas 2.1.0 depends on numpy>=1.22.4 and <2.0.0"}
{"type":"assistant","message":{"role":"assistant","content":"The issue is clear - pandas 2.1.0 requires numpy < 2.0.0 but pip is trying to install numpy 2.0.0. You should use pip constraints to pin numpy to a compatible version."}}
{"type":"human","message":{"role":"user","content":"Fixed it. The issue was that I had both numpy 1.x and 2.x requirements from different packages. Using pip install --constraint with a constraints.txt file that pins numpy to 1.26 resolved all conflicts."}}
{"type":"assistant","message":{"role":"assistant","content":"Using constraints.txt is the proper solution for pinning transitive dependency versions without modifying requirements.txt."}}
EOF

echo '{"session_id":"qwen-test-010","transcript_path":"/tmp/sentinel-qwen-test1.jsonl"}' \
  | npx ts-node src/cli.ts --hook stop

# 4. Confirm and inspect
npx ts-node src/cli.ts review confirm --recent
npx ts-node src/cli.ts detail <id>
```

### Expected

- Debug log: `qwen3:4b, frustrated(>=0.75)` then `resolution(>=0.75)`
- Experience has structured fields:
  - `Issue`: mentions pip/numpy/pandas dependency conflict
  - `Failed Approaches`: populated
  - `Successful Approach`: mentions constraints.txt
  - `Lessons`: actionable items about dependency management

### Actual Result (2026-02-24)

```
Issue: Dependency conflicts between numpy and pandas due to version pinning in pip install

Failed Approaches:
  - Using pip install --upgrade without specifying constraints

Successful Approach:
  Using pip install --constraint with constraints.txt that pins numpy to 1.26

Lessons: (3 items — use constraints, verify versions, prefer constraints.txt)
```

**PASS**

---

## Test 2: Active Recall

**Goal**: Verify that Qwen embeddings produce accurate semantic matches.

### Steps

```bash
echo '{"prompt":"UGH pip is broken again. pandas and numpy version conflict AGAIN. Why does Python dependency management always break like this??","session_id":"qwen-test-020"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit
```

### Expected

- JSON output with `systemMessage` containing:
  - Sentinel banner with confidence >= 90%
  - Matched pip/numpy experience from Test 1
  - Actionable suggestion

### Actual Result (2026-02-24)

```json
{
  "systemMessage": "... Sentinel (confidence: 95%) ... Issue: Dependency conflicts between numpy and pandas ... -> Create a constraints.txt file that pins numpy to 1.26 ..."
}
```

**PASS** — 95% confidence, correct match.

---

## Test 3: Experience Evolution

**Goal**: Verify that Qwen can judge whether a new solution is better and evolve an experience.

### Steps

```bash
# 1. Resolution with improved solution (same session as Test 2)
echo '{"prompt":"Actually found a much better approach. Instead of constraints.txt, I switched to uv which handles dependency resolution natively without conflicts. uv pip install pandas numpy just works.","session_id":"qwen-test-020"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit

# 2. Stop hook with evolution transcript
cat > /tmp/sentinel-qwen-evo.jsonl << 'EOF'
{"type":"human","message":{"role":"user","content":"UGH pip is broken again. pandas and numpy version conflict AGAIN. Why does Python dependency management always break like this??"}}
{"type":"assistant","message":{"role":"assistant","content":"Let me check the dependency tree. This might be related to the pip constraints approach."}}
{"type":"tool_use","name":"Bash","input":{"command":"uv pip install pandas numpy"},"output":"Resolved 5 packages in 0.5s\nInstalled pandas 2.2.0, numpy 1.26.4"}
{"type":"assistant","message":{"role":"assistant","content":"uv handles dependency resolution much better than pip. It uses a modern SAT solver that avoids conflicts automatically."}}
{"type":"human","message":{"role":"user","content":"Actually found a much better approach. Instead of constraints.txt, I switched to uv which handles dependency resolution natively without conflicts. uv pip install pandas numpy just works."}}
{"type":"assistant","message":{"role":"assistant","content":"Yes, uv is significantly better at dependency resolution."}}
EOF

echo '{"session_id":"qwen-test-020","transcript_path":"/tmp/sentinel-qwen-evo.jsonl"}' \
  | npx ts-node src/cli.ts --hook stop

# 3. Verify and confirm
npx ts-node src/cli.ts review list          # should show (evolution candidate)
npx ts-node src/cli.ts review confirm --recent
npx ts-node src/cli.ts detail <id>
npx ts-node src/cli.ts history <id>
```

### Expected

- `review list` shows `(evolution candidate)` tag
- Confirm output: `evolved experience "<id>" to v2`
- Evolved experience:
  - `Revision: 2`
  - Old solution (constraints.txt) demoted to `failedApproaches`
  - New solution (uv) as `successfulApproach`
  - `Lessons` merged

### Actual Result (2026-02-24)

```
Draft "..." evolved experience "..." to v2.

Revision: 2
Failed Approaches:
  - pip install --upgrade (original)
  - constraints.txt (demoted from v1 successfulApproach)
  - "Previous fix was partial" note from evolution judge
Successful Approach: Switched to uv — native dependency resolver with SAT solver
Lessons: (4 items — merged, favoring modern tooling)
```

**PASS** — constraints.txt demoted, uv promoted, lessons merged.

---

## Test 4: SessionEnd Hook (No Resolution/Abandonment)

**Goal**: Verify that session-end captures frustrated sessions even without explicit resolution.

### Steps

```bash
# 1. Frustrated prompt
echo '{"prompt":"This Docker build keeps failing with COPY --from=builder error. I have rebuilt the base image twice and it still does not work. The multi-stage build is completely broken.","session_id":"qwen-test-040"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit

# 2. Create transcript (no resolution — session ends mid-debugging)
cat > /tmp/sentinel-qwen-session-end.jsonl << 'EOF'
{"type":"human","message":{"role":"user","content":"This Docker build keeps failing with COPY --from=builder error. I have rebuilt the base image twice and it still does not work. The multi-stage build is completely broken."}}
{"type":"assistant","message":{"role":"assistant","content":"Let me look at your Dockerfile. The COPY --from=builder error usually means the builder stage name doesn't match or the build context is wrong."}}
{"type":"tool_use","name":"Read","input":{"file_path":"Dockerfile"},"output":"FROM node:20 AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:20-slim\nWORKDIR /app\nCOPY --from=builder /app/dist ./dist\nCOPY --from=builder /app/node_modules ./node_modules"}
{"type":"assistant","message":{"role":"assistant","content":"I see the issue - let me check if the build output is actually going to /app/dist."}}
{"type":"tool_use","name":"Bash","input":{"command":"docker build --target builder -t test-builder ."},"output":"Step 5/6 : RUN npm run build\n> tsc --outDir build\nerror TS6059: File '/app/src/index.ts' is not under 'rootDir'"}
{"type":"assistant","message":{"role":"assistant","content":"Found it - the TypeScript compiler outputs to /app/build not /app/dist."}}
EOF

# 3. Session-end hook (NOT stop hook)
echo '{"session_id":"qwen-test-040","transcript_path":"/tmp/sentinel-qwen-session-end.jsonl"}' \
  | npx ts-node src/cli.ts --hook session-end

# 4. Confirm and inspect
npx ts-node src/cli.ts review list
npx ts-node src/cli.ts review confirm --recent
npx ts-node src/cli.ts detail <id>
```

### Expected

- session-end produces **no stdout**
- Debug log: `frustrated turn found, intent: ...`
- Draft created and confirmable
- LLM extracts structured fields from debugging transcript

### Actual Result (2026-02-24)

```
Debug log:
  [stop] frustrated turn found, intent: COPY --from=builder error
  [stop] storeCandidate: d224db74-... (raw transcript, 4 msgs)

# Note: This draft matched the existing Docker experience and triggered evolution
Draft "..." evolved experience "..." to v2.

Revision: 2 (evolved via session-end capture)
Issue: Docker multi-stage build COPY --from=builder error due to incorrect output directory
Lessons: (5 items — docker build --target, path cross-referencing, etc.)
```

**PASS** — session-end captured the frustrated session and even triggered evolution against the existing Docker experience.

---

## Summary

| # | Scenario | Qwen Result | Notes |
|---|----------|-------------|-------|
| 1 | Draft Confirm (LLM summarization) | **PASS** | Structured field extraction works |
| 2 | Active Recall | **PASS** | 95% confidence match |
| 3 | Experience Evolution | **PASS** | constraints.txt → uv, solution demotion correct |
| 4 | SessionEnd (no resolution) | **PASS** | Capture + evolution in one step |

## Qwen vs Bedrock Comparison

| Aspect | Qwen3:4b (Local) | Bedrock Haiku (Cloud) |
|--------|------------------|----------------------|
| Frustration detection | `frustrated(0.92)` | `frustrated(0.92)` |
| Default threshold | 0.75 | 0.85 |
| Recall confidence | 95% | 95% |
| Summarization quality | Good, slightly more concise | Good, more detailed |
| Speed (first call) | Slower (model loading) | Consistent |
| Speed (subsequent) | Faster (no network) | Network latency |
| Privacy | Full local | Data sent to AWS |
| Cost | Free | Per-token billing |

Both providers produce production-quality results for all four test scenarios.
