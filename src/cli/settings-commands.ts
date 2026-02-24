import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { Command } from 'commander';
import type { CreateProgramDeps, WriteFns } from './types';
import { loadSettings } from '../config/settings-loader';
import { toggleSentinelEnabled, setSentinelSetting } from '../config/toggle-enabled';

export function registerSettingsCommands(program: Command, deps: CreateProgramDeps, io: WriteFns): void {
  const { sqliteStore, configDir } = deps;
  const { write } = io;

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
}
