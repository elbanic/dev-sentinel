#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { Command } from 'commander';
import { SqliteStore } from './storage/sqlite-store';
import { VectorStore } from './storage/vector-store';
import { LLMProviderManager } from './llm/llm-provider-manager';
import { loadSettings, resolveFrustrationThreshold } from './config/settings-loader';
import { initCommand } from './cli/init-command';
import { resolveHome } from './utils/resolve-home';
import { debugLog } from './utils/debug-log';
import type { CreateProgramDeps, WriteFns } from './cli/types';
import { registerHookCommand } from './cli/hook-command';
import { registerReviewCommands } from './cli/review-commands';
import { registerExperienceCommands } from './cli/experience-commands';
import { registerSettingsCommands } from './cli/settings-commands';
import { registerDashboardCommand } from './cli/dashboard-command';

export function createProgram(deps: CreateProgramDeps): Command {
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

  const io: WriteFns = { write, writeErr };

  registerHookCommand(program, deps, io);
  registerReviewCommands(program, deps, io);
  registerExperienceCommands(program, deps, io);
  registerSettingsCommands(program, deps, io);
  registerDashboardCommand(program, deps, io);

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
    console.log('  1) Global \u2014 all projects (~/.claude/settings.json)');
    console.log('  2) Local  \u2014 this project only (.claude/settings.local.json)');
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
