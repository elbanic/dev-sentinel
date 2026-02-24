import { Command } from 'commander';
import type { TranscriptData } from '../types/index';
import type { CreateProgramDeps, WriteFns } from './types';
import { confirmSingleDraft, summarizeInput, truncateStr } from './confirm-experience';

export function registerReviewCommands(program: Command, deps: CreateProgramDeps, io: WriteFns): void {
  const { sqliteStore } = deps;
  const { write, writeErr } = io;

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
      const SEP = '\u2500'.repeat(50) + '\n';
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
          write(`(raw transcript saved \u2014 LLM summary runs on confirm)\n`);
        } else if (draft.lessons.length > 0) {
          write('Lessons:\n');
          for (const l of draft.lessons) {
            write(`  \u2022 ${truncate(l, 70)}\n`);
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

      const SEP = '\u2500'.repeat(50) + '\n';
      write(SEP);
      write(`Draft: ${draft.id}\n`);
      write(`Created: ${draft.createdAt}\n`);
      write(`Issue: ${draft.frustrationSignature || '(empty)'}\n`);
      write(SEP);

      if (draft.transcriptData) {
        try {
          const data: TranscriptData = JSON.parse(draft.transcriptData);

          if (data.messages.length > 0) {
            write('\n\u2500\u2500 Transcript \u2500\u2500\n\n');
            for (const msg of data.messages) {
              const tag = msg.role === 'user' ? '[user]' : msg.role === 'assistant' ? '[assistant]' : `[${msg.role}]`;
              const content = msg.content.length > 500 ? msg.content.substring(0, 500) + '...' : msg.content;
              write(`${tag} ${content}\n\n`);
            }
          }

          const namedCalls = data.toolCalls.filter((tc) => tc.name);
          if (namedCalls.length > 0) {
            write('\u2500\u2500 Tool Calls \u2500\u2500\n\n');
            for (const tc of namedCalls) {
              let line = `\u2022 ${tc.name}(${summarizeInput(tc.input)})`;
              if (tc.output) line += ` \u2192 ${truncateStr(tc.output, 100)}`;
              if (tc.error) line += ` [ERROR]`;
              write(`${line}\n`);
            }
            write('\n');
          }

          if (data.errors.length > 0) {
            write('\u2500\u2500 Errors \u2500\u2500\n\n');
            for (const err of data.errors) {
              write(`\u2022 ${err}\n`);
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
            await confirmSingleDraft(draft, deps, io);
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
          const status = await confirmSingleDraft(draft, deps, io);
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
        const status = await confirmSingleDraft(draft, deps, io);
        if (status === 'stored') {
          write(`Draft "${id}" confirmed and stored as experience.\n`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeErr(`Error confirming draft "${id}": ${message}\n`);
      }
    });

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
}
