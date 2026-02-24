# Improvement Notes

> Ideas for future improvement. Only pursue when a real bottleneck is measured.

---

## Vector Store Search Optimization

**Current state**: `vector-store.ts` performs a full-scan on every `search()` call — loads all rows from SQLite, computes cosine similarity against each one. For a personal experience store (hundreds of entries), this completes in single-digit milliseconds and is perfectly adequate.

**When to revisit**: If experience count grows to 10,000+ and search latency becomes noticeable in the hook pipeline.

### Option 1: In-memory cache

Load vectors into memory once at process start, search in-memory instead of hitting SQLite every time. Effective for CLI commands that perform repeated searches (e.g., `sentinel review confirm --all`). Limited benefit for hook mode since each hook invocation is a fresh process.

### Option 2: SQLite vector extension (sqlite-vss)

Use a native SQLite extension like sqlite-vss to build an ANN (Approximate Nearest Neighbor) index inside SQLite. Preserves the current architecture (SQLite-based, local-first) while improving search performance. Trade-off: adds a native binary dependency.

### Option 3: 2-tier filtering

Pre-filter candidates by metadata (e.g., frustrationSignature category, tech stack) before running cosine similarity on the reduced set. Leverages the existing metadata field stored alongside each vector. No new dependencies required.
