#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { Command } from 'commander';
import type { LLMProvider } from './types/index';
import { SqliteStore } from './storage/sqlite-store';
import { VectorStore } from './storage/vector-store';
import { LLMProviderManager } from './llm/llm-provider-manager';
import { loadSettings, resolveFrustrationThreshold } from './config/settings-loader';
import { initCommand } from './cli/init-command';
import { handleUserPromptSubmit } from './hook/user-prompt-submit-handler';
import { handleStop } from './hook/stop-hook-handler';
import { handleSessionEnd } from './hook/session-end-handler';
import { resolveHome } from './utils/resolve-home';
import { debugLog } from './utils/debug-log';
import { toggleSentinelEnabled, setSentinelSetting } from './config/toggle-enabled';
import { PROMPTS } from './llm/prompts';
import { stripThinkBlock } from './llm/strip-think-block';
import { parseLLMJson } from './utils/parse-llm-json';
import { extractNoteFields } from './utils/extract-note-fields';
import type { TranscriptData } from './types/index';
import { buildContextMessage } from './capture/note-generator';

// ---------------------------------------------------------------------------
// Shared helper: LLM analyze → embedding → store experience + vector
// ---------------------------------------------------------------------------

interface ConfirmExperienceOpts {
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

interface ConfirmExperienceResult {
  stored: boolean;
  duplicateOf?: string;
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.95;

function summarizeInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = JSON.stringify(input);
  return truncateStr(str, 100);
}

function truncateStr(s: string, max: number): string {
  return s.length > max ? s.substring(0, max) + '...' : s;
}

/**
 * Shared pipeline: optionally run LLM summarization on content,
 * build embedding, store experience + vector.
 * Returns { stored: false, duplicateOf } if a near-identical experience already exists.
 */
async function confirmExperience(opts: ConfirmExperienceOpts): Promise<ConfirmExperienceResult> {
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

interface CreateProgramDeps {
  sqliteStore: SqliteStore;
  vectorStore: VectorStore;
  llmProvider: LLMProvider;
  stdin?: string;
  maxAdvicesPerSession?: number;
  frustrationThreshold?: number;
  enabled?: boolean;
  configDir?: string;
}

export function createProgram(deps: CreateProgramDeps): Command {
  const { sqliteStore, vectorStore, llmProvider, stdin, maxAdvicesPerSession, frustrationThreshold, enabled, configDir } = deps;

  const program = new Command();
  program.name('sentinel');
  program.version(require('../package.json').version);

  // Helper to write through Commander's configureOutput (for testability)
  const write = (msg: string) => {
    const configured = program.configureOutput();
    if (configured.writeOut) {
      configured.writeOut(msg);
    } else {
      process.stdout.write(msg);
    }
  };

  const writeErr = (msg: string) => {
    const configured = program.configureOutput();
    if (configured.writeErr) {
      configured.writeErr(msg);
    } else {
      process.stderr.write(msg);
    }
  };

  // --hook <hookName> option: routes stdin to hook handlers
  program.option('--hook <hookName>', 'Run a Claude Code hook handler');

  // Default action for when --hook is used (no subcommand)
  program.action(async () => {
    const hookName = program.opts().hook;
    if (hookName) {
      await runHook(hookName);
    }
  });

  async function runHook(hookName: string): Promise<void> {
    // When enabled is explicitly false, skip all hook processing (no output, no handler calls)
    if ((enabled ?? true) === false) return;

    if (hookName === 'user-prompt-submit') {
      try {
        const parsed = JSON.parse(stdin ?? '{}');
        const result = await handleUserPromptSubmit({
          prompt: parsed.prompt ?? '',
          sessionId: parsed.session_id ?? '',
          llmProvider,
          sqliteStore,
          vectorStore,
          maxAdvicesPerSession,
          frustrationThreshold,
        });
        write(result);
      } catch {
        // Invalid JSON or handler error -> output '{}'
        write('{}');
      }
    } else if (hookName === 'stop') {
      try {
        const parsed = JSON.parse(stdin ?? '{}');
        const result = await handleStop({
          sessionId: parsed.session_id ?? '',
          transcriptPath: parsed.transcript_path ?? '',
          llmProvider,
          sqliteStore,
        });
        write(result);
      } catch {
        write('{"decision":"approve"}');
      }
    } else if (hookName === 'session-end') {
      try {
        const parsed = JSON.parse(stdin ?? '{}');
        await handleSessionEnd({
          sessionId: parsed.session_id ?? '',
          transcriptPath: parsed.transcript_path ?? '',
          sqliteStore,
        });
      } catch {
        // SessionEnd errors are silently ignored -- no output
      }
    } else {
      // Unknown hook name
      writeErr(`Unknown hook: ${hookName}\n`);
    }
  }

  // ---- review subcommand group ----
  const review = program.command('review').description('Manage pending drafts');

  // review list
  review
    .command('list')
    .description('Show pending drafts')
    .action(() => {
      const drafts = sqliteStore.getPendingDrafts();
      if (drafts.length === 0) {
        write('No pending drafts.\n');
        return;
      }
      const SEP = '─'.repeat(50) + '\n';
      const truncate = (s: string, max: number) =>
        s.length > max ? s.substring(0, max) + '...' : s;

      for (const draft of drafts) {
        write(SEP);
        write(`Draft: ${draft.id}\n`);
        if (draft.matchedExperienceId) {
          write(`(evolution candidate)\n`);
        }
        write(`Created: ${draft.createdAt}\n`);
        write(`Issue: ${truncate(draft.frustrationSignature || '(empty)', 80)}\n`);
        if (draft.transcriptData) {
          write(`(raw transcript saved — LLM summary runs on confirm)\n`);
        } else if (draft.lessons.length > 0) {
          write('Lessons:\n');
          for (const l of draft.lessons) {
            write(`  • ${truncate(l, 70)}\n`);
          }
        }
      }
      write(SEP);
    });

  // review detail <id>
  review
    .command('detail <id>')
    .description('Show full transcript of a draft')
    .action((id: string) => {
      const drafts = sqliteStore.getPendingDrafts();
      const draft = drafts.find((d) => d.id === id);

      if (!draft) {
        writeErr(`Draft "${id}" not found.\n`);
        return;
      }

      const SEP = '─'.repeat(50) + '\n';
      write(SEP);
      write(`Draft: ${draft.id}\n`);
      write(`Created: ${draft.createdAt}\n`);
      write(`Issue: ${draft.frustrationSignature || '(empty)'}\n`);
      write(SEP);

      if (draft.transcriptData) {
        try {
          const data: TranscriptData = JSON.parse(draft.transcriptData);

          if (data.messages.length > 0) {
            write('\n── Transcript ──\n\n');
            for (const msg of data.messages) {
              const tag = msg.role === 'user' ? '[user]' : msg.role === 'assistant' ? '[assistant]' : `[${msg.role}]`;
              const content = msg.content.length > 500 ? msg.content.substring(0, 500) + '...' : msg.content;
              write(`${tag} ${content}\n\n`);
            }
          }

          const namedCalls = data.toolCalls.filter((tc) => tc.name);
          if (namedCalls.length > 0) {
            write('── Tool Calls ──\n\n');
            for (const tc of namedCalls) {
              let line = `• ${tc.name}(${summarizeInput(tc.input)})`;
              if (tc.output) line += ` → ${truncateStr(tc.output, 100)}`;
              if (tc.error) line += ` [ERROR]`;
              write(`${line}\n`);
            }
            write('\n');
          }

          if (data.errors.length > 0) {
            write('── Errors ──\n\n');
            for (const err of data.errors) {
              write(`• ${err}\n`);
            }
            write('\n');
          }
        } catch {
          writeErr('Failed to parse transcript data.\n');
        }
      } else {
        write('(no transcript data)\n');
      }

      write(SEP);
    });

  // review confirm [id] | --all | --recent
  review
    .command('confirm [id]')
    .description('Confirm a draft and store as experience')
    .option('--all', 'Confirm all pending drafts')
    .option('--recent', 'Confirm the most recent pending draft')
    .action(async (id: string | undefined, opts: { all?: boolean; recent?: boolean }) => {
      if (opts.all) {
        const drafts = sqliteStore.getPendingDrafts();
        if (drafts.length === 0) {
          write('No pending drafts.\n');
          return;
        }
        let confirmed = 0;
        for (let i = 0; i < drafts.length; i++) {
          const draft = drafts[i];
          write(`[${i + 1}/${drafts.length}] Confirming ${draft.id}...\n`);
          try {
            await confirmSingleDraft(draft);
            confirmed++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            writeErr(`Error confirming draft "${draft.id}": ${message}\n`);
          }
        }
        write(`Confirmed ${confirmed} of ${drafts.length} draft(s).\n`);
        return;
      }

      if (opts.recent) {
        const drafts = sqliteStore.getPendingDrafts();
        if (drafts.length === 0) {
          write('No pending drafts.\n');
          return;
        }
        // Most recent by createdAt
        const sorted = [...drafts].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        const draft = sorted[0];
        try {
          const status = await confirmSingleDraft(draft);
          if (status === 'stored') {
            write(`Draft "${draft.id}" confirmed and stored as experience.\n`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          writeErr(`Error confirming draft "${draft.id}": ${message}\n`);
        }
        return;
      }

      if (!id) {
        writeErr('Usage: sentinel review confirm <id> | --all | --recent\n');
        return;
      }

      // Single draft confirm
      const drafts = sqliteStore.getPendingDrafts();
      const draft = drafts.find((d) => d.id === id);

      if (!draft) {
        writeErr(`Draft "${id}" not found.\n`);
        return;
      }

      try {
        const status = await confirmSingleDraft(draft);
        if (status === 'stored') {
          write(`Draft "${id}" confirmed and stored as experience.\n`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeErr(`Error confirming draft "${id}": ${message}\n`);
      }
    });

  function buildEvolutionJudgeInput(
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

  function parseEvolutionJudgment(raw: string): {
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

  /**
   * Confirm a single draft: build content, run LLM summarization, store experience.
   * If the draft has a matchedExperienceId, attempt evolution before falling back to normal flow.
   * Returns a status indicating the outcome so callers can write appropriate messages.
   * Throws on failure (caller handles error reporting).
   */
  async function confirmSingleDraft(draft: ReturnType<SqliteStore['getPendingDrafts']>[number]): Promise<'evolved' | 'stored' | 'duplicate'> {
    let content = '';
    if (draft.transcriptData) {
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
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
        write('\r✓ Summarization complete.              \n');
      } else {
        write('\r⚠ Failed to parse transcript data.     \n');
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
            // Wrapped in its own try/catch: if embedding fails, the experience is still
            // updated (vector will be slightly stale but the metadata is correct).
            try {
              const failed = updatedFailedApproaches.join('; ');
              const fixed = newFields.successfulApproach ?? '';
              const lessonsText = (judgment.mergedLessons.length > 0 ? judgment.mergedLessons : newFields.lessons).join('; ');
              const sig = newFields.frustrationSignature || existingExp.frustrationSignature;
              const embeddingText = `${sig}. Failed: ${failed}. Fixed: ${fixed}. Lessons: ${lessonsText}`;
              const embedding = await llmProvider.generateEmbedding(embeddingText);
              vectorStore.store(existingExp.id, embedding, { frustrationSignature: sig });
            } catch {
              // Re-embedding failed: experience is updated but vector may be stale.
              // This is acceptable for graceful degradation.
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

  // review reject [id] | --all
  review
    .command('reject [id]')
    .description('Reject and delete a draft')
    .option('--all', 'Reject all pending drafts')
    .action((id: string | undefined, opts: { all?: boolean }) => {
      if (opts.all) {
        const drafts = sqliteStore.getPendingDrafts();
        if (drafts.length === 0) {
          write('No pending drafts.\n');
          return;
        }
        for (const draft of drafts) {
          sqliteStore.deleteCandidate(draft.id);
        }
        write(`Rejected ${drafts.length} draft(s).\n`);
        return;
      }

      if (!id) {
        writeErr('Usage: sentinel review reject <id> | --all\n');
        return;
      }

      // Single draft reject
      const drafts = sqliteStore.getPendingDrafts();
      const draft = drafts.find((d) => d.id === id);

      if (!draft) {
        writeErr(`Draft "${id}" not found.\n`);
        return;
      }

      sqliteStore.deleteCandidate(id);
      write(`Draft "${id}" rejected and deleted.\n`);
    });

  // ---- add command ----
  program
    .command('add <path>')
    .description('Import markdown notes as experiences')
    .action(async (inputPath: string) => {
      const resolved = path.resolve(inputPath);

      // Check existence
      if (!fs.existsSync(resolved)) {
        writeErr(`Path not found: ${resolved}\n`);
        return;
      }

      const stat = fs.statSync(resolved);
      let mdFiles: string[];

      if (stat.isDirectory()) {
        // Recursive glob for .md files
        const entries = fs.readdirSync(resolved, { recursive: true }) as string[];
        mdFiles = entries
          .filter((entry) => entry.endsWith('.md'))
          .map((entry) => path.join(resolved, entry));

        if (mdFiles.length === 0) {
          write('No .md files found in the folder.\n');
          return;
        }
      } else {
        // Single file
        if (!resolved.endsWith('.md')) {
          writeErr('Only .md (markdown) files are supported.\n');
          return;
        }
        mdFiles = [resolved];
      }

      let addedCount = 0;

      for (const filePath of mdFiles) {
        const basename = path.basename(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');

        if (content.trim().length === 0) {
          write(`Skipping empty file: ${basename}\n`);
          continue;
        }

        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let frameIdx = 0;
        const spinner = setInterval(() => {
          write(`\r${frames[frameIdx++ % frames.length]} Analyzing: ${basename}`);
        }, 80);

        try {
          const id = randomUUID();
          const result = await confirmExperience({
            id,
            content,
            frustrationSignature: '',
            failedApproaches: [],
            successfulApproach: undefined,
            lessons: [],
            createdAt: new Date().toISOString(),
            llmProvider,
            sqliteStore,
            vectorStore,
          });
          // Clear spinner line
          write('\r' + ' '.repeat(40) + '\r');
          if (result.stored) {
            addedCount++;
            write(`✓ Added: ${basename}\n`);
          } else {
            write(`⊘ Skipping duplicate: ${basename}\n`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          write('\r' + ' '.repeat(40) + '\r');
          writeErr(`✗ Failed: ${basename}: ${message}\n`);
        } finally {
          clearInterval(spinner);
        }
      }

      write(`Added ${addedCount} experience(s).\n`);
    });

  // ---- list command ----
  program
    .command('list')
    .description('List stored experiences')
    .action(() => {
      const experiences = sqliteStore.getAllExperiences();
      if (experiences.length === 0) {
        write('No experiences stored.\n');
        return;
      }
      const SEP = '─'.repeat(50) + '\n';
      const truncate = (s: string, max: number) =>
        s.length > max ? s.substring(0, max) + '...' : s;

      for (const exp of experiences) {
        write(SEP);
        const versionTag = exp.revision > 1 ? ` (v${exp.revision})` : '';
        write(`ID: ${exp.id}${versionTag}\n`);
        write(`Issue: ${truncate(exp.frustrationSignature || '(empty)', 80)}\n`);
        write(`Created: ${exp.createdAt}\n`);
        if (exp.lessons.length > 0) {
          write('Lessons:\n');
          for (const l of exp.lessons) {
            write(`  • ${truncate(l, 70)}\n`);
          }
        }
      }
      write(SEP);
      write(`Total: ${experiences.length} experience(s)\n`);
    });

  // ---- detail command ----
  program
    .command('detail <id>')
    .description('Show full details of a stored experience')
    .action((id: string) => {
      const experience = sqliteStore.getExperience(id);
      if (!experience) {
        writeErr(`Experience "${id}" not found.\n`);
        return;
      }

      const SEP = '─'.repeat(50) + '\n';
      write(SEP);
      write(`ID: ${experience.id}\n`);
      write(`Revision: ${experience.revision}\n`);
      write(`Created: ${experience.createdAt}\n`);
      write(`Issue: ${experience.frustrationSignature || '(empty)'}\n`);
      write(SEP);

      if (experience.failedApproaches.length > 0) {
        write('\nFailed Approaches:\n');
        for (const a of experience.failedApproaches) {
          write(`  • ${a}\n`);
        }
      }

      if (experience.successfulApproach) {
        write(`\nSuccessful Approach:\n  ${experience.successfulApproach}\n`);
      }

      if (experience.lessons.length > 0) {
        write('\nLessons:\n');
        for (const l of experience.lessons) {
          write(`  • ${l}\n`);
        }
      }

      write(SEP);
    });

  // ---- history command ----
  program
    .command('history <id>')
    .description('Show revision history for an experience')
    .action((id: string) => {
      const experience = sqliteStore.getExperience(id);
      if (!experience) {
        writeErr(`Experience "${id}" not found.\n`);
        return;
      }

      const revisions = sqliteStore.getRevisions(id);
      if (revisions.length === 0) {
        write(`No revision history for "${id}" (current: v${experience.revision ?? 1}).\n`);
        return;
      }

      const SEP = '─'.repeat(50) + '\n';
      write(`History for: ${id} (current: v${experience.revision ?? 1})\n`);
      write(SEP);

      for (const rev of revisions) {
        write(`v${rev.revision} — ${rev.createdAt}\n`);
        write(`  Situation: ${rev.frustrationSignature}\n`);
        if (rev.failedApproaches.length > 0) {
          write(`  Failed: ${rev.failedApproaches.join('; ')}\n`);
        }
        if (rev.successfulApproach) {
          write(`  Solution: ${rev.successfulApproach}\n`);
        }
        if (rev.lessons.length > 0) {
          write(`  Lessons: ${rev.lessons.join('; ')}\n`);
        }
        write('\n');
      }
    });

  // ---- delete command ----
  program
    .command('delete <id>')
    .description('Delete a stored experience')
    .action((id: string) => {
      const experience = sqliteStore.getExperience(id);
      if (!experience) {
        writeErr(`Experience "${id}" not found.\n`);
        return;
      }
      sqliteStore.deleteExperience(id);
      vectorStore.delete(id);
      write(`Experience "${id}" deleted.\n`);
    });

  // ---- reset command ----
  program
    .command('reset')
    .description('Clear all data (experiences, drafts, vectors)')
    .option('--confirm', 'Confirm the reset operation')
    .action((opts: { confirm?: boolean }) => {
      if (!opts.confirm) {
        writeErr('This will delete ALL data. Run with --confirm to proceed.\n');
        return;
      }
      sqliteStore.resetAll();
      vectorStore.clearVectors();
      write('All data has been reset.\n');
    });

  // ---- status command ----
  program
    .command('status')
    .description('Show DB statistics')
    .action(() => {
      const dir = configDir ?? path.join(os.homedir(), '.sentinel');
      const settingsPath = path.join(dir, 'settings.json');
      const settings = loadSettings(settingsPath);
      write(`Status: ${settings.enabled ? 'enabled' : 'disabled'}\n`);
      write(`Debug: ${settings.debug ? 'on' : 'off'}\n`);
      const experienceCount = sqliteStore.getExperienceCount();
      const pendingDrafts = sqliteStore.getPendingDrafts();
      write(`Experiences: ${experienceCount}\n`);
      write(`Pending drafts: ${pendingDrafts.length}\n`);
    });

  // ---- enable command ----
  program
    .command('enable')
    .description('Enable Sentinel')
    .action(() => {
      const dir = configDir ?? path.join(os.homedir(), '.sentinel');
      toggleSentinelEnabled(dir, true);
      write('Sentinel enabled.\n');
    });

  // ---- disable command ----
  program
    .command('disable')
    .description('Disable Sentinel')
    .action(() => {
      const dir = configDir ?? path.join(os.homedir(), '.sentinel');
      toggleSentinelEnabled(dir, false);
      write('Sentinel disabled.\n');
    });

  // ---- debug command ----
  program
    .command('debug [state]')
    .description('Turn debug mode on/off, or tail the log (sentinel debug on|off|--tail)')
    .option('--tail', 'Follow debug log output in real-time')
    .action((state: string | undefined, opts: { tail?: boolean }) => {
      const dir = configDir ?? path.join(os.homedir(), '.sentinel');

      if (opts.tail) {
        const logPath = path.join(dir, 'hook-debug.log');
        if (!fs.existsSync(logPath)) {
          write(`Log file not found: ${logPath}\n`);
          write('Enable debug mode first: sentinel debug on\n');
          return;
        }
        write(`Tailing ${logPath} (Ctrl+C to stop)\n\n`);
        const tail = spawn('tail', ['-f', logPath], { stdio: 'inherit' });
        tail.on('error', (err) => {
          write(`Failed to tail log: ${err.message}\n`);
        });
        return;
      }

      if (!state) {
        write('Usage: sentinel debug on|off|--tail\n');
        return;
      }

      const normalized = state.toLowerCase();
      if (normalized !== 'on' && normalized !== 'off') {
        write('Usage: sentinel debug on|off|--tail\n');
        return;
      }
      const enabled = normalized === 'on';
      setSentinelSetting(dir, 'debug', enabled);
      write(`Debug mode ${enabled ? 'on' : 'off'}.\n`);
    });

  return program;
}

// ---------------------------------------------------------------------------
// stdin reader (only reads when stdin is piped, i.e., non-TTY)
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => resolve(''));
  });
}

// ---------------------------------------------------------------------------
// promptScope() — interactive prompt for global/local scope selection
// ---------------------------------------------------------------------------

function promptScope(): Promise<'global' | 'local'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log('Where should sentinel hooks be installed?');
    console.log('  1) Global — all projects (~/.claude/settings.json)');
    console.log('  2) Local  — this project only (.claude/settings.local.json)');
    rl.question('> ', (answer) => {
      rl.close();
      resolve(answer.trim() === '1' ? 'global' : 'local');
    });
  });
}

// ---------------------------------------------------------------------------
// main() — bootstrap the CLI with real dependencies
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const isHookMode = process.argv.includes('--hook');

  try {
    // 1. Load settings
    const settings = loadSettings();

    // Early exit: when disabled in hook mode, skip DB/LLM init entirely (no stdout)
    if (isHookMode && !settings.enabled) {
      return;
    }

    // 2. Resolve sentinel directory from dbPath
    const dbPath = resolveHome(settings.storage.dbPath);
    const sentinelDir = path.dirname(dbPath);
    fs.mkdirSync(sentinelDir, { recursive: true });

    // 3. Read stdin if in hook mode
    let stdinData: string | undefined;
    if (isHookMode) {
      stdinData = await readStdin();
    }

    // 4. Instantiate stores
    const sqliteStore = new SqliteStore(dbPath);
    sqliteStore.initialize();

    const vectorDbPath = path.join(sentinelDir, 'vectors.db');
    const vectorStore = new VectorStore(vectorDbPath);
    vectorStore.initialize();

    // 5. Instantiate LLM provider
    const providerManager = new LLMProviderManager(settings);
    const llmProvider = providerManager.getProvider();

    // 6. Build the program with all dependencies
    const program = createProgram({
      sqliteStore,
      vectorStore,
      llmProvider,
      stdin: stdinData,
      maxAdvicesPerSession: settings.recall.maxAdvicesPerSession,
      frustrationThreshold: resolveFrustrationThreshold(settings),
      enabled: settings.enabled,
    });

    // 7. Register init command
    program
      .command('init')
      .description('Initialize sentinel hooks')
      .action(async () => {
        const scope = await promptScope();
        const result = await initCommand({
          projectDir: process.cwd(),
          homeDir: os.homedir(),
          scope,
        });
        const write = (msg: string) => {
          const configured = program.configureOutput();
          if (configured.writeOut) {
            configured.writeOut(msg);
          } else {
            process.stdout.write(msg);
          }
        };
        const writeErr = (msg: string) => {
          const configured = program.configureOutput();
          if (configured.writeErr) {
            configured.writeErr(msg);
          } else {
            process.stderr.write(msg);
          }
        };
        result.messages.forEach((m) => write(m + '\n'));
        result.warnings.forEach((w) => writeErr('Warning: ' + w + '\n'));
      });

    // 8. Parse and execute
    await program.parseAsync(process.argv);

    // 9. Debug log in hook mode
    if (isHookMode) {
      debugLog(`stdin: ${(stdinData ?? '').slice(0, 200)}`, sentinelDir);
    }
  } catch (err) {
    // In hook mode, always output valid JSON so Claude Code doesn't break
    if (isHookMode) {
      const hookName = process.argv[process.argv.indexOf('--hook') + 1];
      if (hookName === 'stop') {
        process.stdout.write('{"decision":"approve"}');
      } else if (hookName === 'session-end') {
        // No output needed for session-end
      } else {
        process.stdout.write('{}');
      }
    } else {
      // Non-hook mode: re-throw for normal CLI error handling
      throw err;
    }
  }
}

// Only run when executed as CLI entry point (not when imported for testing)
if (require.main === module) {
  main();
}
