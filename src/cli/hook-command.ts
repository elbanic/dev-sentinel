import { Command } from 'commander';
import type { CreateProgramDeps, WriteFns } from './types';
import { handleUserPromptSubmit } from '../hook/user-prompt-submit-handler';
import { handleStop } from '../hook/stop-hook-handler';
import { handleSessionEnd } from '../hook/session-end-handler';

export function registerHookCommand(program: Command, deps: CreateProgramDeps, io: WriteFns): void {
  const { sqliteStore, vectorStore, llmProvider, stdin, maxAdvicesPerSession, frustrationThreshold, enabled } = deps;
  const { write, writeErr } = io;

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
}
