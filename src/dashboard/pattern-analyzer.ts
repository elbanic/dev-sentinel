import { randomUUID } from 'crypto';
import type { LLMProvider, EffectivenessStats, FailureExperience, PatternAnalysisResult } from '../types/index';
import { PatternAnalysisResultSchema } from '../types/index';
import type { SqliteStore } from '../storage/sqlite-store';
import { PROMPTS } from '../llm/prompts';
import { stripThinkBlock } from '../llm/strip-think-block';
import { parseLLMJson } from '../utils/parse-llm-json';

/**
 * Build a user message from experiences + trend data for the LLM analysis prompt.
 */
export function buildAnalysisInput(
  experiences: FailureExperience[],
  trendData: Array<{ date: string; count: number }>,
  effectivenessMap?: Map<string, EffectivenessStats>,
): string {
  let input = '== Confirmed Experiences ==\n\n';

  for (const exp of experiences) {
    input += `--- Experience: ${exp.frustrationSignature} ---\n`;
    input += `Failed Approaches: ${exp.failedApproaches.join('; ')}\n`;
    input += `Successful Approach: ${exp.successfulApproach ?? '(unresolved)'}\n`;
    input += `Lessons: ${exp.lessons.join('; ')}\n`;
    input += `Revision: v${exp.revision ?? 1}\n`;
    if (effectivenessMap) {
      const stats = effectivenessMap.get(exp.id);
      if (stats && (stats.effective + stats.ineffective) > 0) {
        const rate = Math.round((stats.effectivenessRate ?? 0) * 100);
        input += `Advice Effectiveness: ${stats.effective} effective, ${stats.ineffective} ineffective, ${stats.unknown} unknown (${rate}%)\n`;
      }
    }
    input += '\n';
  }

  input += '== Frustration Trend (last 30 days) ==\n\n';
  if (trendData.length === 0) {
    input += 'No frustration data available.\n';
  } else {
    for (const entry of trendData) {
      input += `${entry.date}: ${entry.count} frustrated prompts\n`;
    }
  }

  return input;
}

/**
 * Run full pattern analysis: gather data -> LLM call -> validate -> store -> return.
 */
export async function analyzePatterns(
  llmProvider: LLMProvider,
  sqliteStore: SqliteStore,
): Promise<{ id: string; analysis: PatternAnalysisResult; experienceCount: number; createdAt: string }> {
  const experiences = sqliteStore.getAllExperiences();
  if (experiences.length === 0) {
    throw new Error('No experiences found. Add confirmed experiences before analyzing patterns.');
  }

  const trendData = sqliteStore.getFrustrationTrend(30);
  const allStats = sqliteStore.getAllEffectivenessStats();
  const effectivenessMap = new Map(allStats.map((s) => [s.experienceId, s]));
  const input = buildAnalysisInput(experiences, trendData, effectivenessMap);

  const raw = await llmProvider.generateCompletion(PROMPTS.patternAnalysis, input, { think: true });
  const cleaned = stripThinkBlock(raw);

  const parsed = parseLLMJson(cleaned);
  if (parsed === null) {
    throw new Error('LLM returned invalid JSON for pattern analysis');
  }

  const validation = PatternAnalysisResultSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(`Pattern analysis validation failed: ${validation.error.message}`);
  }

  const analysis = validation.data;
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  sqliteStore.storePatternAnalysis(id, JSON.stringify(analysis), experiences.length);

  return { id, analysis, experienceCount: experiences.length, createdAt };
}

/**
 * Get or create a translation of the pattern analysis.
 * Returns cached translation if available, otherwise calls LLM to translate.
 */
export async function getOrTranslatePattern(
  analysisId: string,
  language: string,
  llmProvider: LLMProvider,
  sqliteStore: SqliteStore,
): Promise<PatternAnalysisResult> {
  // Check cache first
  const cached = sqliteStore.getPatternTranslation(analysisId, language);
  if (cached) {
    return JSON.parse(cached.translated_json) as PatternAnalysisResult;
  }

  // Get the original analysis
  const analysisRow = sqliteStore.getLatestPatternAnalysis();
  if (!analysisRow || analysisRow.id !== analysisId) {
    throw new Error(`Pattern analysis ${analysisId} not found`);
  }

  const languageNames: Record<string, string> = {
    ko: 'Korean',
    ja: 'Japanese',
    zh: 'Chinese',
    es: 'Spanish',
  };

  const langName = languageNames[language] ?? language;
  const userMsg = `Translate the following JSON values into ${langName}. Output valid JSON only.\n\n${analysisRow.analysis_json}`;

  const raw = await llmProvider.generateCompletion(PROMPTS.patternTranslation, userMsg, { think: false });
  const cleaned = stripThinkBlock(raw);

  const parsed = parseLLMJson(cleaned);
  if (parsed === null) {
    throw new Error('LLM returned invalid JSON for pattern translation');
  }

  const validation = PatternAnalysisResultSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(`Pattern translation validation failed: ${validation.error.message}`);
  }

  const translated = validation.data;
  sqliteStore.storePatternTranslation(analysisId, language, JSON.stringify(translated));

  return translated;
}
