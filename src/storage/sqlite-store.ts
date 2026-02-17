import Database from 'better-sqlite3';
import type { AutoMemoryCandidate, FailureExperience } from '../types/index';

// Row types returned by better-sqlite3 queries
interface TurnRow {
  id: number;
  session_id: string;
  prompt: string;
  analysis: string;
  created_at: string;
}

interface FlagRow {
  session_id: string;
  status: string;
  flagged_at: string;
  updated_at: string;
}

interface CandidateRow {
  id: string;
  session_id: string;
  transcript_data: string | null;
  frustration_signature: string;
  failed_approaches: string; // JSON
  successful_approach: string | null;
  lessons: string; // JSON
  status: string;
  created_at: string;
}

interface ExperienceRow {
  id: string;
  frustration_signature: string;
  failed_approaches: string; // JSON
  successful_approach: string | null;
  lessons: string; // JSON
  created_at: string;
}

export class SqliteStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  /**
   * Creates all required tables. Must be called before any other operation.
   */
  initialize(): void {
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        analysis TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS session_flags (
        session_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        flagged_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS auto_memory_candidates (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        transcript_data TEXT,
        frustration_signature TEXT NOT NULL DEFAULT '',
        failed_approaches TEXT NOT NULL DEFAULT '[]',
        successful_approach TEXT,
        lessons TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        frustration_signature TEXT NOT NULL,
        failed_approaches TEXT NOT NULL,
        successful_approach TEXT,
        lessons TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_advices (
        session_id TEXT NOT NULL,
        experience_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, experience_id)
      );

      CREATE INDEX IF NOT EXISTS idx_session_turns_session_id
        ON session_turns(session_id);
    `);

  }

  /**
   * Closes the database connection. After this, all methods will throw.
   */
  close(): void {
    this.db.close();
  }

  // -- Guard to ensure DB is open --
  private ensureOpen(): void {
    if (!this.db.open) {
      throw new Error('Database is closed');
    }
  }

  // =========================================================================
  // session_turns
  // =========================================================================

  storeTurn(sessionId: string, prompt: string, analysis: string): void {
    this.ensureOpen();
    this.db
      .prepare(
        'INSERT INTO session_turns (session_id, prompt, analysis) VALUES (?, ?, ?)',
      )
      .run(sessionId, prompt, analysis);
  }

  getTurnsBySession(sessionId: string): TurnRow[] {
    this.ensureOpen();
    return this.db
      .prepare(
        'SELECT id, session_id, prompt, analysis, created_at FROM session_turns WHERE session_id = ? ORDER BY id ASC',
      )
      .all(sessionId) as TurnRow[];
  }

  // =========================================================================
  // session_flags
  // =========================================================================

  setFlag(sessionId: string, status: string): void {
    this.ensureOpen();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_flags (session_id, status, flagged_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))`,
      )
      .run(sessionId, status);
  }

  getFlag(sessionId: string): FlagRow | null {
    this.ensureOpen();
    const row = this.db
      .prepare(
        'SELECT session_id, status, flagged_at, updated_at FROM session_flags WHERE session_id = ?',
      )
      .get(sessionId) as FlagRow | undefined;
    return row ?? null;
  }

  upgradeFlag(sessionId: string, newStatus: string): void {
    this.ensureOpen();
    this.db
      .prepare(
        `UPDATE session_flags SET status = ?, updated_at = datetime('now') WHERE session_id = ?`,
      )
      .run(newStatus, sessionId);
  }

  clearFlag(sessionId: string): void {
    this.ensureOpen();
    this.db
      .prepare('DELETE FROM session_flags WHERE session_id = ?')
      .run(sessionId);
  }

  // =========================================================================
  // auto_memory_candidates
  // =========================================================================

  storeCandidate(candidate: AutoMemoryCandidate): void {
    this.ensureOpen();
    this.db
      .prepare(
        `INSERT INTO auto_memory_candidates (id, session_id, transcript_data, frustration_signature, failed_approaches, successful_approach, lessons, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidate.id,
        candidate.sessionId,
        candidate.transcriptData ?? null,
        candidate.frustrationSignature,
        JSON.stringify(candidate.failedApproaches),
        candidate.successfulApproach ?? null,
        JSON.stringify(candidate.lessons),
        candidate.status,
        candidate.createdAt,
      );
  }

  getPendingDrafts(): AutoMemoryCandidate[] {
    this.ensureOpen();
    const rows = this.db
      .prepare(
        'SELECT id, session_id, transcript_data, frustration_signature, failed_approaches, successful_approach, lessons, status, created_at FROM auto_memory_candidates WHERE status = ?',
      )
      .all('pending') as CandidateRow[];

    return rows.map((row) => this.candidateRowToModel(row));
  }

  deleteCandidate(id: string): void {
    this.ensureOpen();
    this.db
      .prepare('DELETE FROM auto_memory_candidates WHERE id = ?')
      .run(id);
  }

  updateCandidateStatus(id: string, newStatus: string): void {
    this.ensureOpen();
    this.db
      .prepare('UPDATE auto_memory_candidates SET status = ? WHERE id = ?')
      .run(newStatus, id);
  }

  // =========================================================================
  // experiences
  // =========================================================================

  storeExperience(experience: FailureExperience): void {
    this.ensureOpen();
    this.db
      .prepare(
        `INSERT INTO experiences (id, frustration_signature, failed_approaches, successful_approach, lessons, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        experience.id,
        experience.frustrationSignature,
        JSON.stringify(experience.failedApproaches),
        experience.successfulApproach ?? null,
        JSON.stringify(experience.lessons),
        experience.createdAt,
      );
  }

  getExperienceCount(): number {
    this.ensureOpen();
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM experiences')
      .get() as { count: number };
    return row.count;
  }

  getExperience(id: string): FailureExperience | null {
    this.ensureOpen();
    const row = this.db
      .prepare(
        'SELECT id, frustration_signature, failed_approaches, successful_approach, lessons, created_at FROM experiences WHERE id = ?',
      )
      .get(id) as ExperienceRow | undefined;

    if (!row) return null;

    return this.experienceRowToModel(row);
  }

  getAllExperiences(): FailureExperience[] {
    this.ensureOpen();
    const rows = this.db
      .prepare(
        'SELECT id, frustration_signature, failed_approaches, successful_approach, lessons, created_at FROM experiences ORDER BY created_at DESC',
      )
      .all() as ExperienceRow[];
    return rows.map((row) => this.experienceRowToModel(row));
  }

  deleteExperience(id: string): boolean {
    this.ensureOpen();
    const result = this.db
      .prepare('DELETE FROM experiences WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  resetAll(): void {
    this.ensureOpen();
    this.db.exec('DELETE FROM experiences');
    this.db.exec('DELETE FROM auto_memory_candidates');
    this.db.exec('DELETE FROM session_flags');
    this.db.exec('DELETE FROM session_turns');
    this.db.exec('DELETE FROM session_advices');
  }

  // =========================================================================
  // session_advices
  // =========================================================================

  getAdvisedExperienceIds(sessionId: string): string[] {
    this.ensureOpen();
    const rows = this.db
      .prepare('SELECT experience_id FROM session_advices WHERE session_id = ?')
      .all(sessionId) as { experience_id: string }[];
    return rows.map((row) => row.experience_id);
  }

  recordAdvice(sessionId: string, experienceId: string): void {
    this.ensureOpen();
    this.db
      .prepare(
        'INSERT OR IGNORE INTO session_advices (session_id, experience_id) VALUES (?, ?)',
      )
      .run(sessionId, experienceId);
  }

  // =========================================================================
  // Transactions
  // =========================================================================

  runInTransaction<T>(fn: () => T): T {
    this.ensureOpen();
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private candidateRowToModel(row: CandidateRow): AutoMemoryCandidate {
    return {
      id: row.id,
      sessionId: row.session_id,
      transcriptData: row.transcript_data ?? undefined,
      frustrationSignature: row.frustration_signature,
      failedApproaches: this.parseJsonArray(row.failed_approaches),
      successfulApproach: row.successful_approach ?? undefined,
      lessons: this.parseJsonArray(row.lessons),
      status: row.status as AutoMemoryCandidate['status'],
      createdAt: row.created_at,
    };
  }

  private experienceRowToModel(row: ExperienceRow): FailureExperience {
    return {
      id: row.id,
      frustrationSignature: row.frustration_signature,
      failedApproaches: this.parseJsonArray(row.failed_approaches),
      successfulApproach: row.successful_approach ?? undefined,
      lessons: this.parseJsonArray(row.lessons),
      createdAt: row.created_at,
    };
  }

  private parseJsonArray(json: string): string[] {
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  }
}
