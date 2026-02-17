import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorSearchResult {
  id: string;
  similarity: number;
  metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Cosine similarity helper
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

// ---------------------------------------------------------------------------
// Row type returned by better-sqlite3 queries
// ---------------------------------------------------------------------------

interface VectorRow {
  id: string;
  embedding: Buffer;
  metadata: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// VectorStore
// ---------------------------------------------------------------------------

export class VectorStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  /**
   * Creates the vectors table. Must be called before any other operation.
   */
  initialize(): void {
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * Closes the database connection. After this, all methods will throw.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Stores a vector with its metadata. Uses INSERT OR REPLACE for UPSERT behavior.
   */
  store(id: string, embedding: number[], metadata: Record<string, string>): void {
    this.ensureOpen();
    const buffer = Buffer.from(new Float64Array(embedding).buffer);
    this.db
      .prepare(
        'INSERT OR REPLACE INTO vectors (id, embedding, metadata) VALUES (?, ?, ?)',
      )
      .run(id, buffer, JSON.stringify(metadata));
  }

  /**
   * Searches for vectors similar to the query embedding using cosine similarity.
   * Returns at most topK results with similarity >= minSimilarity, sorted descending.
   */
  search(queryEmbedding: number[], topK: number, minSimilarity: number): VectorSearchResult[] {
    this.ensureOpen();

    const rows = this.db
      .prepare('SELECT id, embedding, metadata FROM vectors')
      .all() as VectorRow[];

    const results: VectorSearchResult[] = [];

    for (const row of rows) {
      const uint8 = new Uint8Array(row.embedding);
      const storedEmbedding = Array.from(
        new Float64Array(uint8.buffer, uint8.byteOffset, uint8.byteLength / 8),
      );
      const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);

      if (similarity >= minSimilarity) {
        results.push({
          id: row.id,
          similarity,
          metadata: JSON.parse(row.metadata) as Record<string, string>,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    // Return at most topK results
    return results.slice(0, topK);
  }

  /**
   * Deletes a vector by ID.
   */
  delete(id: string): void {
    this.ensureOpen();
    this.db.prepare('DELETE FROM vectors WHERE id = ?').run(id);
  }

  /**
   * Removes all vectors from the store.
   */
  clearVectors(): void {
    this.ensureOpen();
    this.db.exec('DELETE FROM vectors');
  }

  // -- Guard to ensure DB is open --
  private ensureOpen(): void {
    if (!this.db.open) {
      throw new Error('Database is closed');
    }
  }
}
