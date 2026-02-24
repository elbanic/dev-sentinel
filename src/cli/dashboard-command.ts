import type { Command } from 'commander';
import type { CreateProgramDeps, WriteFns } from './types';
import { createDashboardApp } from '../dashboard/server';

/**
 * Registers the `sentinel dashboard` CLI command.
 * Starts the Express server for the local web dashboard.
 */
export function registerDashboardCommand(
  program: Command,
  deps: CreateProgramDeps,
  io: WriteFns,
): void {
  program
    .command('dashboard')
    .description('Start the local web dashboard')
    .option('--port <port>', 'Port to listen on', '3456')
    .action((opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      const app = createDashboardApp(deps);

      const server = app.listen(port, () => {
        io.write(`Sentinel dashboard running at http://localhost:${port}\n`);
        io.write('Press Ctrl+C to stop.\n');
      });

      const shutdown = () => {
        io.write('\nShutting down dashboard...\n');
        server.closeAllConnections();
        server.close(() => {
          process.exit(0);
        });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
