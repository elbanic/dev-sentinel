import { randomUUID } from 'crypto';
import type { LLMProvider } from '../types/index';
import type { SqliteStore } from '../storage/sqlite-store';
import type { VectorStore } from '../storage/vector-store';
import type { TranscriptData } from '../types/index';
import type { CreateProgramDeps, WriteFns } from './types';
import { PROMPTS } from '../llm/prompts';
import { stripThinkBlock } from '../llm/strip-think-block';
import { parseLLMJson } from '../utils/parse-llm-json';
import { extractNoteFields } from '../utils/extract-note-fields';
import { buildContextMessage } from '../capture/note-generator';

// ---------------------------------------------------------------------------
// Shared helper types
// ---------------------------------------------------------------------------

export interface ConfirmExperienceOpts {
  id: string;
  content: string;
  frustrationSignature: string;
  failedApproaches: string[];
  successfulApproach?: string;
  lessons: string[];
  createdAt: string;
  llmProvider: LLMProvider;
  sqliteStore: SqliteStore;
  vectorStore: VectorStore;
}

export interface ConfirmExperienceResult {
  stored: boolean;
  duplicateOf?: string;
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.95;

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function summarizeInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = JSON.stringify(input);
  return truncateStr(str, 100);
}

export function truncateStr(s: string, max: number): string {
  return s.length > max ? s.substring(0, max) + '...' : s;
}

// ---------------------------------------------------------------------------
// confirmExperience — LLM analyze -> embedding -> store experience + vector
// ---------------------------------------------------------------------------

/**
 * Shared pipeline: optionally run LLM summarization on content,
 * build embedding, store experience + vector.
 * Returns { stored: false, duplicateOf } if a near-identical experience already exists.
 */
export async function confirmExperience(opts: ConfirmExperienceOpts): Promise<ConfirmExperienceResult> {
  let { frustrationSignature, failedApproaches, successfulApproach, lessons } = opts;
  const { id, content, createdAt, llmProvider, sqliteStore, vectorStore } = opts;

  // Run LLM summarization on provided content
  if (content) {
    try {
      const response = await llmProvider.generateCompletion(
        PROMPTS.lessonSummarization,
        content,
        { think: true },
      );
      const stripped = stripThinkBlock(response);
      const parsed = parseLLMJson(stripped);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const fields = extractNoteFields(obj, {
          frustrationSignature, failedApproaches, successfulApproach, lessons,
        });
        frustrationSignature = fields.frustrationSignature;
        failedApproaches = fields.failedApproaches;
        successfulApproach = fields.successfulApproach;
        lessons = fields.lessons;
      }
    } catch {
      // LLM failure: use provided values as fallback
    }
  }

  // Build embedding text (fall back to raw content if all structured fields are empty)
  const failed = failedApproaches.join('; ');
  const fixed = successfulApproach ?? '';
  const lessonsText = lessons.join('; ');
  const structured = `${frustrationSignature}. Failed: ${failed}. Fixed: ${fixed}. Lessons: ${lessonsText}`;
  const hasStructuredData = frustrationSignature || failed || fixed || lessonsText;
  const embeddingText = hasStructuredData ? structured : (content || structured);

  // Generate embedding
  const embedding = await llmProvider.generateEmbedding(embeddingText);

  // Check for near-duplicate in vector store
  const duplicates = vectorStore.search(embedding, 1, DUPLICATE_SIMILARITY_THRESHOLD);
  if (duplicates.length > 0) {
    return { stored: false, duplicateOf: duplicates[0].id };
  }

  // Store experience + vector
  sqliteStore.storeExperience({
    id,
    frustrationSignature,
    failedApproaches,
    successfulApproach,
    lessons,
    createdAt,
    revision: 1,
  });

  vectorStore.store(id, embedding, { frustrationSignature });
  return { stored: true };
}

// ---------------------------------------------------------------------------
// Evolution helpers
// ---------------------------------------------------------------------------

export function buildEvolutionJudgeInput(
  existing: { frustrationSignature: string; failedApproaches: string[]; successfulApproach?: string; lessons: string[] },
  newFields: { frustrationSignature: string; failedApproaches: string[]; successfulApproach?: string; lessons: string[] },
): string {
  return `── Existing Experience ──
Situation: ${existing.frustrationSignature}
Failed approaches: ${existing.failedApproaches.join('; ') || '(none)'}
Successful approach: ${existing.successfulApproach || '(none)'}
Lessons: ${existing.lessons.join('; ') || '(none)'}

── New Encounter ──
Situation: ${newFields.frustrationSignature}
Failed approaches: ${newFields.failedApproaches.join('; ') || '(none)'}
Successful approach: ${newFields.successfulApproach || '(none)'}
Lessons: ${newFields.lessons.join('; ') || '(none)'}`;
}

export function parseEvolutionJudgment(raw: string): {
  isBetter: boolean;
  reasoning: string;
  mergedLessons: string[];
  newFailedApproachNote: string;
} | null {
  try {
    const parsed = parseLLMJson(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.isBetter !== 'boolean') return null;
    return {
      isBetter: obj.isBetter,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      mergedLessons: Array.isArray(obj.mergedLessons) ? obj.mergedLessons.map(String) : [],
      newFailedApproachNote: typeof obj.newFailedApproachNote === 'string' ? obj.newFailedApproachNote : '',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// confirmSingleDraft — confirm a single draft with evolution support
// ---------------------------------------------------------------------------

/**
 * Confirm a single draft: build content, run LLM summarization, store experience.
 * If the draft has a matchedExperienceId, attempt evolution before falling back to normal flow.
 * Returns a status indicating the outcome so callers can write appropriate messages.
 * Throws on failure (caller handles error reporting).
 */
export async function confirmSingleDraft(
  draft: ReturnType<SqliteStore['getPendingDrafts']>[number],
  deps: CreateProgramDeps,
  io: WriteFns,
): Promise<'evolved' | 'stored' | 'duplicate'> {
  const { sqliteStore, vectorStore, llmProvider } = deps;
  const { write, writeErr } = io;

  let content = '';
  if (draft.transcriptData) {
    const frames = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
    let frameIdx = 0;
    const spinner = setInterval(() => {
      write(`\r${frames[frameIdx++ % frames.length]} Summarizing transcript with LLM...`);
    }, 80);
    try {
      const transcriptData: TranscriptData = JSON.parse(draft.transcriptData);

      // Look up frustration context from session turns
      let frustrationContext: { prompt: string; intent: string } | undefined;
      try {
        const turns = sqliteStore.getTurnsBySession(draft.sessionId);
        for (const turn of turns) {
          try {
            const analysis = JSON.parse(turn.analysis);
            if (analysis.type === 'frustrated') {
              frustrationContext = {
                prompt: turn.prompt,
                intent: analysis.intent ? String(analysis.intent).substring(0, 200) : '',
              };
              break;
            }
          } catch { /* skip invalid JSON */ }
        }
      } catch { /* proceed without context */ }

      content = buildContextMessage(transcriptData, frustrationContext);
    } catch {
      // Failed to parse transcript, content stays empty
    }
    clearInterval(spinner);
    if (content) {
      write('\r\u2713 Summarization complete.              \n');
    } else {
      write('\r\u26A0 Failed to parse transcript data.     \n');
    }
  }

  // --- Evolution branch ---
  if (draft.matchedExperienceId) {
    const existingExp = sqliteStore.getExperience(draft.matchedExperienceId);
    if (existingExp) {
      try {
        // 1st LLM call: summarize the new transcript
        const summarizationResponse = await llmProvider.generateCompletion(
          PROMPTS.lessonSummarization,
          content || '(no content)',
          { think: true },
        );
        const summarizationStripped = stripThinkBlock(summarizationResponse);
        const summarizationParsed = parseLLMJson(summarizationStripped);

        let newFields = {
          frustrationSignature: draft.frustrationSignature,
          failedApproaches: draft.failedApproaches,
          successfulApproach: draft.successfulApproach,
          lessons: draft.lessons,
        };
        if (summarizationParsed && typeof summarizationParsed === 'object' && !Array.isArray(summarizationParsed)) {
          const obj = summarizationParsed as Record<string, unknown>;
          newFields = extractNoteFields(obj, newFields);
        }

        // 2nd LLM call: evolution judge
        const judgeInput = buildEvolutionJudgeInput(existingExp, newFields);
        const judgeResponse = await llmProvider.generateCompletion(
          PROMPTS.evolutionJudge,
          judgeInput,
          { think: true },
        );
        const judgeStripped = stripThinkBlock(judgeResponse);
        const judgment = parseEvolutionJudgment(judgeStripped);

        if (judgment && judgment.isBetter) {
          // Store revision history (snapshot of current state)
          sqliteStore.storeRevision({
            id: randomUUID(),
            experienceId: existingExp.id,
            revision: existingExp.revision ?? 1,
            frustrationSignature: existingExp.frustrationSignature,
            failedApproaches: existingExp.failedApproaches,
            successfulApproach: existingExp.successfulApproach,
            lessons: existingExp.lessons,
            createdAt: existingExp.createdAt,
          });

          // Build updated failed approaches: existing ones + old success demoted + judgment note
          const updatedFailedApproaches = [...existingExp.failedApproaches];
          if (existingExp.successfulApproach) {
            updatedFailedApproaches.push(existingExp.successfulApproach);
          }
          if (judgment.newFailedApproachNote) {
            updatedFailedApproaches.push(judgment.newFailedApproachNote);
          }

          // Update experience
          const newRevision = (existingExp.revision ?? 1) + 1;
          sqliteStore.updateExperience({
            id: existingExp.id,
            frustrationSignature: newFields.frustrationSignature || existingExp.frustrationSignature,
            failedApproaches: updatedFailedApproaches,
            successfulApproach: newFields.successfulApproach,
            lessons: judgment.mergedLessons.length > 0 ? judgment.mergedLessons : newFields.lessons,
            createdAt: existingExp.createdAt,
            revision: newRevision,
          });

          // Re-embed with same ID (INSERT OR REPLACE in vector store)
          try {
            const failed = updatedFailedApproaches.join('; ');
            const fixed = newFields.successfulApproach ?? '';
            const lessonsText = (judgment.mergedLessons.length > 0 ? judgment.mergedLessons : newFields.lessons).join('; ');
            const sig = newFields.frustrationSignature || existingExp.frustrationSignature;
            const embeddingText = `${sig}. Failed: ${failed}. Fixed: ${fixed}. Lessons: ${lessonsText}`;
            const embedding = await llmProvider.generateEmbedding(embeddingText);
            vectorStore.store(existingExp.id, embedding, { frustrationSignature: sig });
          } catch {
            writeErr(`Warning: re-embedding failed for "${existingExp.id}", vector may be stale.\n`);
          }

          sqliteStore.deleteCandidate(draft.id);
          write(`Draft "${draft.id}" evolved experience "${existingExp.id}" to v${newRevision}.\n`);
          return 'evolved';
        }
        // isBetter === false: fall through to normal flow
      } catch {
        // Evolution LLM failed: fall through to normal flow (graceful fallback)
      }
    }
    // existingExp not found or evolution declined: fall through to normal flow
  }

  // --- Normal flow (existing code) ---
  const result = await confirmExperience({
    id: draft.id,
    content,
    frustrationSignature: draft.frustrationSignature,
    failedApproaches: draft.failedApproaches,
    successfulApproach: draft.successfulApproach,
    lessons: draft.lessons,
    createdAt: draft.createdAt,
    llmProvider,
    sqliteStore,
    vectorStore,
  });

  sqliteStore.deleteCandidate(draft.id);
  if (!result.stored) {
    write(`Draft "${draft.id}" skipped (duplicate of existing experience).\n`);
    return 'duplicate';
  }
  return 'stored';
}
