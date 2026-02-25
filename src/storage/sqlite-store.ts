import Database from 'better-sqlite3';
import type { AutoMemoryCandidate, EffectivenessStats, ExperienceRevision, FailureExperience, HookErrorComponent, PersistentErrorSummary } from '../types/index';

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
  matched_experience_id: string | null;
}

interface CandidateRow {
  id: string;
  session_id: string;
  transcript_data: string | null;
  frustration_signature: string;
  failed_approaches: string; // JSON
  successful_approach: string | null;
  matched_experience_id: string | null;
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
  revision: number;
}

interface ExperienceRevisionRow {
  id: string;
  experience_id: string;
  revision: number;
  frustration_signature: string;
  failed_approaches: string; // JSON
  successful_approach: string | null;
  lessons: string; // JSON
  created_at: string;
}

interface HookErrorRow {
  component: string;
  count: number;
  last_error: string;
  last_occurred: string;
}

interface PatternAnalysisRow {
  id: string;
  analysis_json: string;
  experience_count: number;
  created_at: string;
}

interface PatternTranslationRow {
  analysis_id: string;
  language: string;
  translated_json: string;
  created_at: string;
}

interface FrustrationTrendRow {
  date: string;
  count: number;
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

    // Migration: add revision column to experiences table
    try {
      this.db.exec('ALTER TABLE experiences ADD COLUMN revision INTEGER DEFAULT 1');
    } catch {
      // Column already exists, ignore
    }

    // Migration: add matched_experience_id column to session_flags table
    try {
      this.db.exec('ALTER TABLE session_flags ADD COLUMN matched_experience_id TEXT');
    } catch {
      // Column already exists, ignore
    }

    // Migration: add matched_experience_id column to auto_memory_candidates table
    try {
      this.db.exec('ALTER TABLE auto_memory_candidates ADD COLUMN matched_experience_id TEXT');
    } catch {
      // Column already exists, ignore
    }

    // Migration: add outcome column to session_advices table (Feature 2: Feedback Loop)
    try {
      this.db.exec("ALTER TABLE session_advices ADD COLUMN outcome TEXT DEFAULT 'unknown'");
    } catch {
      // Column already exists, ignore
    }

    // Create experience_revisions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experience_revisions (
        id TEXT PRIMARY KEY,
        experience_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        frustration_signature TEXT NOT NULL,
        failed_approaches TEXT NOT NULL,
        successful_approach TEXT,
        lessons TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Create hook_errors table for persistent error tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hook_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component TEXT NOT NULL,
        hook TEXT NOT NULL,
        error_message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_hook_errors_component_created
        ON hook_errors(component, created_at);
    `);

    // Create pattern_analyses and pattern_translations tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pattern_analyses (
        id TEXT PRIMARY KEY,
        analysis_json TEXT NOT NULL,
        experience_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS pattern_translations (
        analysis_id TEXT NOT NULL,
        language TEXT NOT NULL,
        translated_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (analysis_id, language)
      );
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

  setFlag(sessionId: string, status: string, matchedExperienceId?: string): void {
    this.ensureOpen();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_flags (session_id, status, matched_experience_id, flagged_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(sessionId, status, matchedExperienceId ?? null);
  }

  getFlag(sessionId: string): FlagRow | null {
    this.ensureOpen();
    const row = this.db
      .prepare(
        'SELECT session_id, status, matched_experience_id, flagged_at, updated_at FROM session_flags WHERE session_id = ?',
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
        `INSERT INTO auto_memory_candidates (id, session_id, transcript_data, frustration_signature, failed_approaches, successful_approach, matched_experience_id, lessons, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidate.id,
        candidate.sessionId,
        candidate.transcriptData ?? null,
        candidate.frustrationSignature,
        JSON.stringify(candidate.failedApproaches),
        candidate.successfulApproach ?? null,
        candidate.matchedExperienceId ?? null,
        JSON.stringify(candidate.lessons),
        candidate.status,
        candidate.createdAt,
      );
  }

  getPendingDrafts(): AutoMemoryCandidate[] {
    this.ensureOpen();
    const rows = this.db
      .prepare(
        'SELECT id, session_id, transcript_data, frustration_signature, failed_approaches, successful_approach, matched_experience_id, lessons, status, created_at FROM auto_memory_candidates WHERE status = ?',
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
        `INSERT INTO experiences (id, frustration_signature, failed_approaches, successful_approach, lessons, created_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        experience.id,
        experience.frustrationSignature,
        JSON.stringify(experience.failedApproaches),
        experience.successfulApproach ?? null,
        JSON.stringify(experience.lessons),
        experience.createdAt,
        experience.revision ?? 1,
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
        'SELECT id, frustration_signature, failed_approaches, successful_approach, lessons, created_at, revision FROM experiences WHERE id = ?',
      )
      .get(id) as ExperienceRow | undefined;

    if (!row) return null;

    return this.experienceRowToModel(row);
  }

  getAllExperiences(): FailureExperience[] {
    this.ensureOpen();
    const rows = this.db
      .prepare(
        'SELECT id, frustration_signature, failed_approaches, successful_approach, lessons, created_at, revision FROM experiences ORDER BY created_at DESC',
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

  updateExperience(experience: FailureExperience): void {
    this.ensureOpen();
    this.db
      .prepare(
        `UPDATE experiences SET frustration_signature = ?, failed_approaches = ?, successful_approach = ?, lessons = ?, created_at = ?, revision = ? WHERE id = ?`,
      )
      .run(
        experience.frustrationSignature,
        JSON.stringify(experience.failedApproaches),
        experience.successfulApproach ?? null,
        JSON.stringify(experience.lessons),
        experience.createdAt,
        experience.revision ?? 1,
        experience.id,
      );
  }

  // =========================================================================
  // experience_revisions
  // =========================================================================

  storeRevision(revision: ExperienceRevision): void {
    this.ensureOpen();
    this.db
      .prepare(
        `INSERT INTO experience_revisions (id, experience_id, revision, frustration_signature, failed_approaches, successful_approach, lessons, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revision.id,
        revision.experienceId,
        revision.revision,
        revision.frustrationSignature,
        JSON.stringify(revision.failedApproaches),
        revision.successfulApproach ?? null,
        JSON.stringify(revision.lessons),
        revision.createdAt,
      );
  }

  getRevisions(experienceId: string): ExperienceRevision[] {
    this.ensureOpen();
    const rows = this.db
      .prepare(
        'SELECT id, experience_id, revision, frustration_signature, failed_approaches, successful_approach, lessons, created_at FROM experience_revisions WHERE experience_id = ? ORDER BY revision ASC',
      )
      .all(experienceId) as ExperienceRevisionRow[];
    return rows.map((row) => this.revisionRowToModel(row));
  }

  // =========================================================================
  // hook_errors
  // =========================================================================

  recordHookError(component: HookErrorComponent, hook: string, errorMessage: string, createdAt?: string): void {
    this.ensureOpen();
    if (createdAt) {
      this.db
        .prepare('INSERT INTO hook_errors (component, hook, error_message, created_at) VALUES (?, ?, ?, ?)')
        .run(component, hook, errorMessage, createdAt);
    } else {
      this.db
        .prepare('INSERT INTO hook_errors (component, hook, error_message) VALUES (?, ?, ?)')
        .run(component, hook, errorMessage);
    }
  }

  getPersistentErrors(windowHours: number = 1, threshold: number = 3): PersistentErrorSummary[] {
    this.ensureOpen();
    const rows = this.db
      .prepare(`
        SELECT component, cnt as count, error_message as last_error, created_at as last_occurred
        FROM (
          SELECT *, COUNT(*) OVER (PARTITION BY component) as cnt,
            ROW_NUMBER() OVER (PARTITION BY component ORDER BY created_at DESC) as rn
          FROM hook_errors WHERE created_at >= datetime('now', '-' || ? || ' hours')
        ) WHERE rn = 1 AND cnt >= ?
      `)
      .all(windowHours, threshold) as HookErrorRow[];

    return rows.map((row) => ({
      component: row.component as PersistentErrorSummary['component'],
      count: row.count,
      lastError: row.last_error,
      lastOccurred: row.last_occurred,
    }));
  }

  cleanupOldErrors(retentionDays: number = 7): number {
    this.ensureOpen();
    const result = this.db
      .prepare("DELETE FROM hook_errors WHERE created_at < datetime('now', '-' || ? || ' days')")
      .run(retentionDays);
    return result.changes;
  }

  // =========================================================================
  // pattern_analyses + pattern_translations
  // =========================================================================

  storePatternAnalysis(id: string, analysisJson: string, experienceCount: number): void {
    this.ensureOpen();
    this.db
      .prepare('INSERT INTO pattern_analyses (id, analysis_json, experience_count) VALUES (?, ?, ?)')
      .run(id, analysisJson, experienceCount);
  }

  getLatestPatternAnalysis(): PatternAnalysisRow | null {
    this.ensureOpen();
    const row = this.db
      .prepare('SELECT id, analysis_json, experience_count, created_at FROM pattern_analyses ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get() as PatternAnalysisRow | undefined;
    return row ?? null;
  }

  storePatternTranslation(analysisId: string, language: string, translatedJson: string): void {
    this.ensureOpen();
    this.db
      .prepare('INSERT OR REPLACE INTO pattern_translations (analysis_id, language, translated_json) VALUES (?, ?, ?)')
      .run(analysisId, language, translatedJson);
  }

  getPatternTranslation(analysisId: string, language: string): PatternTranslationRow | null {
    this.ensureOpen();
    const row = this.db
      .prepare('SELECT analysis_id, language, translated_json, created_at FROM pattern_translations WHERE analysis_id = ? AND language = ?')
      .get(analysisId, language) as PatternTranslationRow | undefined;
    return row ?? null;
  }

  deletePatternTranslations(analysisId: string): void {
    this.ensureOpen();
    this.db
      .prepare('DELETE FROM pattern_translations WHERE analysis_id = ?')
      .run(analysisId);
  }

  getFrustrationTrend(days: number): FrustrationTrendRow[] {
    this.ensureOpen();
    return this.db
      .prepare(`
        SELECT date(created_at) as date, COUNT(*) as count
        FROM session_turns
        WHERE json_extract(analysis, '$.type') = 'frustrated'
          AND created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY date(created_at)
        ORDER BY date ASC
      `)
      .all(days) as FrustrationTrendRow[];
  }

  resetAll(): void {
    this.ensureOpen();
    this.db.exec('DELETE FROM experiences');
    this.db.exec('DELETE FROM auto_memory_candidates');
    this.db.exec('DELETE FROM session_flags');
    this.db.exec('DELETE FROM session_turns');
    this.db.exec('DELETE FROM session_advices');
    this.db.exec('DELETE FROM experience_revisions');
    this.db.exec('DELETE FROM hook_errors');
    this.db.exec('DELETE FROM pattern_analyses');
    this.db.exec('DELETE FROM pattern_translations');
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

  markAdvicesEffective(sessionId: string): number {
    this.ensureOpen();
    const result = this.db
      .prepare(
        "UPDATE session_advices SET outcome = 'effective' WHERE session_id = ? AND outcome = 'unknown'",
      )
      .run(sessionId);
    return result.changes;
  }

  markPriorAdviceIneffective(experienceId: string, currentSessionId: string): number {
    this.ensureOpen();
    const result = this.db
      .prepare(
        "UPDATE session_advices SET outcome = 'ineffective' WHERE experience_id = ? AND session_id != ? AND outcome = 'unknown'",
      )
      .run(experienceId, currentSessionId);
    return result.changes;
  }

  getEffectivenessStats(experienceId: string): EffectivenessStats {
    this.ensureOpen();
    const rows = this.db
      .prepare(
        'SELECT outcome, COUNT(*) as count FROM session_advices WHERE experience_id = ? GROUP BY outcome',
      )
      .all(experienceId) as { outcome: string; count: number }[];

    let effective = 0;
    let ineffective = 0;
    let unknown = 0;
    for (const row of rows) {
      if (row.outcome === 'effective') effective = row.count;
      else if (row.outcome === 'ineffective') ineffective = row.count;
      else unknown = row.count;
    }

    const total = effective + ineffective;
    const effectivenessRate = total === 0 ? null : effective / total;

    return { experienceId, effective, ineffective, unknown, effectivenessRate };
  }

  getAllEffectivenessStats(): EffectivenessStats[] {
    this.ensureOpen();
    const rows = this.db
      .prepare(
        'SELECT experience_id, outcome, COUNT(*) as count FROM session_advices GROUP BY experience_id, outcome',
      )
      .all() as { experience_id: string; outcome: string; count: number }[];

    const map = new Map<string, { effective: number; ineffective: number; unknown: number }>();
    for (const row of rows) {
      if (!map.has(row.experience_id)) {
        map.set(row.experience_id, { effective: 0, ineffective: 0, unknown: 0 });
      }
      const entry = map.get(row.experience_id)!;
      if (row.outcome === 'effective') entry.effective = row.count;
      else if (row.outcome === 'ineffective') entry.ineffective = row.count;
      else entry.unknown = row.count;
    }

    const stats: EffectivenessStats[] = [];
    for (const [experienceId, counts] of map) {
      const total = counts.effective + counts.ineffective;
      stats.push({
        experienceId,
        effective: counts.effective,
        ineffective: counts.ineffective,
        unknown: counts.unknown,
        effectivenessRate: total === 0 ? null : counts.effective / total,
      });
    }
    return stats;
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
      matchedExperienceId: row.matched_experience_id ?? undefined,
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
      revision: row.revision,
    };
  }

  private revisionRowToModel(row: ExperienceRevisionRow): ExperienceRevision {
    return {
      id: row.id,
      experienceId: row.experience_id,
      revision: row.revision,
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
