import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Command } from 'commander';
import type { CreateProgramDeps, WriteFns } from './types';
import { confirmExperience } from './confirm-experience';

export function registerExperienceCommands(program: Command, deps: CreateProgramDeps, io: WriteFns): void {
  const { sqliteStore, vectorStore, llmProvider } = deps;
  const { write, writeErr } = io;

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

        const frames = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
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
            write(`\u2713 Added: ${basename}\n`);
          } else {
            write(`\u2298 Skipping duplicate: ${basename}\n`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          write('\r' + ' '.repeat(40) + '\r');
          writeErr(`\u2717 Failed: ${basename}: ${message}\n`);
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
      const SEP = '\u2500'.repeat(50) + '\n';
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
            write(`  \u2022 ${truncate(l, 70)}\n`);
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

      const SEP = '\u2500'.repeat(50) + '\n';
      write(SEP);
      write(`ID: ${experience.id}\n`);
      write(`Revision: ${experience.revision}\n`);
      write(`Created: ${experience.createdAt}\n`);
      write(`Issue: ${experience.frustrationSignature || '(empty)'}\n`);
      write(SEP);

      if (experience.failedApproaches.length > 0) {
        write('\nFailed Approaches:\n');
        for (const a of experience.failedApproaches) {
          write(`  \u2022 ${a}\n`);
        }
      }

      if (experience.successfulApproach) {
        write(`\nSuccessful Approach:\n  ${experience.successfulApproach}\n`);
      }

      if (experience.lessons.length > 0) {
        write('\nLessons:\n');
        for (const l of experience.lessons) {
          write(`  \u2022 ${l}\n`);
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

      const SEP = '\u2500'.repeat(50) + '\n';
      write(`History for: ${id} (current: v${experience.revision ?? 1})\n`);
      write(SEP);

      for (const rev of revisions) {
        write(`v${rev.revision} \u2014 ${rev.createdAt}\n`);
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
}
