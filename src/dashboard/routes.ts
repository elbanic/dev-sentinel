import type { Express, Request, Response } from 'express';
import type { CreateProgramDeps } from '../cli/types';
import type { WriteFns } from '../cli/types';
import { confirmSingleDraft } from '../cli/confirm-experience';
import { analyzePatterns, getOrTranslatePattern } from './pattern-analyzer';

const VALID_PATTERN_LANGUAGES = ['ko', 'ja', 'zh', 'es'];

/**
 * Registers all dashboard API routes on the given Express app.
 */
export function registerRoutes(app: Express, deps: CreateProgramDeps): void {
  const { sqliteStore, llmProvider } = deps;

  // GET /api/overview — stats for overview cards
  app.get('/api/overview', (_req: Request, res: Response) => {
    const experiences = sqliteStore.getAllExperiences();
    const evolvedCount = experiences.filter((e) => (e.revision ?? 1) > 1).length;
    const pendingDrafts = sqliteStore.getPendingDrafts();
    const systemErrors = sqliteStore.getPersistentErrors();

    // Feature 2: aggregate advice effectiveness
    const allStats = sqliteStore.getAllEffectivenessStats();
    let effective = 0, ineffective = 0, unknown = 0;
    for (const s of allStats) {
      effective += s.effective;
      ineffective += s.ineffective;
      unknown += s.unknown;
    }
    const total = effective + ineffective;
    const rate = total === 0 ? null : Math.round((effective / total) * 100);

    res.json({
      experienceCount: experiences.length,
      evolvedCount,
      pendingDraftCount: pendingDrafts.length,
      systemErrors,
      adviceEffectiveness: { effective, ineffective, unknown, rate },
    });
  });

  // GET /api/experiences — all experiences
  app.get('/api/experiences', (_req: Request, res: Response) => {
    const experiences = sqliteStore.getAllExperiences();
    res.json(experiences);
  });

  // GET /api/experiences/:id — experience detail + revisions
  app.get('/api/experiences/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const experience = sqliteStore.getExperience(id);
    if (!experience) {
      res.status(404).json({ error: 'Experience not found' });
      return;
    }
    const revisions = sqliteStore.getRevisions(id);
    const effectiveness = sqliteStore.getEffectivenessStats(id);
    res.json({ experience, revisions, effectiveness });
  });

  // GET /api/drafts — pending drafts
  app.get('/api/drafts', (_req: Request, res: Response) => {
    const drafts = sqliteStore.getPendingDrafts();
    res.json(drafts);
  });

  // GET /api/drafts/:id — single draft detail
  app.get('/api/drafts/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const drafts = sqliteStore.getPendingDrafts();
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.json(draft);
  });

  // POST /api/drafts/:id/reject — reject and delete draft
  app.post('/api/drafts/:id/reject', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const drafts = sqliteStore.getPendingDrafts();
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    sqliteStore.deleteCandidate(id);
    res.json({ success: true });
  });

  // POST /api/drafts/:id/confirm — confirm draft (triggers LLM)
  app.post('/api/drafts/:id/confirm', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const drafts = sqliteStore.getPendingDrafts();
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    const noopIo: WriteFns = {
      write: () => {},
      writeErr: () => {},
    };

    try {
      const status = await confirmSingleDraft(draft, deps, noopIo);
      res.json({ status });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // =========================================================================
  // Patterns endpoints
  // =========================================================================

  // GET /api/patterns — cached analysis + meta
  app.get('/api/patterns', (_req: Request, res: Response) => {
    const latest = sqliteStore.getLatestPatternAnalysis();
    const currentExperienceCount = sqliteStore.getExperienceCount();

    if (!latest) {
      res.json({ analysis: null, currentExperienceCount, newSinceAnalysis: 0 });
      return;
    }

    const newSinceAnalysis = Math.max(0, currentExperienceCount - latest.experience_count);

    res.json({
      analysis: {
        id: latest.id,
        result: JSON.parse(latest.analysis_json),
        experienceCount: latest.experience_count,
        createdAt: latest.created_at,
      },
      currentExperienceCount,
      newSinceAnalysis,
    });
  });

  // POST /api/patterns/analyze — run new analysis
  app.post('/api/patterns/analyze', async (_req: Request, res: Response) => {
    try {
      const result = await analyzePatterns(llmProvider, sqliteStore);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/patterns/translate/:lang — get or create translation
  app.get('/api/patterns/translate/:lang', async (req: Request, res: Response) => {
    const lang = req.params.lang as string;

    if (!VALID_PATTERN_LANGUAGES.includes(lang)) {
      res.status(400).json({ error: `Invalid language. Valid options: ${VALID_PATTERN_LANGUAGES.join(', ')}` });
      return;
    }

    const latest = sqliteStore.getLatestPatternAnalysis();
    if (!latest) {
      res.status(404).json({ error: 'No analysis found. Run analysis first.' });
      return;
    }

    try {
      const translated = await getOrTranslatePattern(latest.id, lang, llmProvider, sqliteStore);
      res.json(translated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/patterns/trend — daily frustration counts
  app.get('/api/patterns/trend', (_req: Request, res: Response) => {
    const trend = sqliteStore.getFrustrationTrend(30);
    res.json(trend);
  });
}
