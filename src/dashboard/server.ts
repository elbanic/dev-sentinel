import * as path from 'path';
import express from 'express';
import type { CreateProgramDeps } from '../cli/types';
import { registerRoutes } from './routes';

/**
 * Creates and configures the Express app for the Sentinel dashboard.
 * Serves static files from the public/ directory and registers API routes.
 */
export function createDashboardApp(deps: CreateProgramDeps): express.Express {
  const app = express();

  // JSON body parsing
  app.use(express.json());

  // API routes (registered before static to take priority)
  registerRoutes(app, deps);

  // Static file serving from public/
  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));

  return app;
}
