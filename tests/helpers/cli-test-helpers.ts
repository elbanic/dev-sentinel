/**
 * Shared test helpers for CLI test files.
 *
 * Provides common utilities to reduce duplication across:
 *   - cli.test.ts
 *   - cli-enabled-flag.test.ts
 *   - cli-enable-disable.test.ts
 *   - cli-hook-command.test.ts
 *   - cli-review-commands.test.ts
 *   - cli-experience-commands.test.ts
 *   - cli-settings-commands.test.ts
 *
 * NOTE: jest.mock() calls CANNOT be extracted here due to Jest hoisting.
 * Each test file must declare its own jest.mock() calls at the top level.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProgram } from '../../src/cli';
import { SqliteStore } from '../../src/storage/sqlite-store';
import { VectorStore } from '../../src/storage/vector-store';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import type { AutoMemoryCandidate } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestDeps {
  sqliteStore: SqliteStore;
  vectorStore: VectorStore;
  llmProvider: MockLLMProvider;
}

export interface RunCommandDeps extends TestDeps {
  stdinData?: string;
  enabled?: boolean;
  configDir?: string;
}

export interface RunCommandResult {
  output: string;
  errorOutput: string;
  exitCode?: number;
}

// ---------------------------------------------------------------------------
// runCommand — unified CLI execution helper
// ---------------------------------------------------------------------------

/**
 * Parse a Commander program for the given command args.
 * Returns captured output and any thrown CommanderError.
 */
export async function runCommand(
  args: string[],
  deps: RunCommandDeps,
): Promise<RunCommandResult> {
  let output = '';
  let errorOutput = '';
  let exitCode: number | undefined;

  const program = createProgram({
    sqliteStore: deps.sqliteStore,
    vectorStore: deps.vectorStore,
    llmProvider: deps.llmProvider,
    stdin: deps.stdinData,
    enabled: deps.enabled,
    configDir: deps.configDir,
  });

  program.exitOverride();
  program.configureOutput({
    writeOut: (str: string) => {
      output += str;
    },
    writeErr: (str: string) => {
      errorOutput += str;
    },
  });

  try {
    await program.parseAsync(['node', 'sentinel', ...args]);
  } catch (err: unknown) {
    // Commander throws CommanderError on exitOverride
    if (err && typeof err === 'object' && 'exitCode' in err) {
      exitCode = (err as { exitCode: number }).exitCode;
    }
  }

  return { output, errorOutput, exitCode };
}

// ---------------------------------------------------------------------------
// createTestDeps — create in-memory stores + mock LLM
// ---------------------------------------------------------------------------

export function createTestDeps(): TestDeps {
  const sqliteStore = new SqliteStore(':memory:');
  sqliteStore.initialize();

  const vectorStore = new VectorStore(':memory:');
  vectorStore.initialize();

  const llmProvider = new MockLLMProvider();

  return { sqliteStore, vectorStore, llmProvider };
}

// ---------------------------------------------------------------------------
// cleanupDeps — close stores safely
// ---------------------------------------------------------------------------

export function cleanupDeps(deps: TestDeps): void {
  try {
    deps.sqliteStore.close();
  } catch {
    // Already closed
  }
  try {
    deps.vectorStore.close();
  } catch {
    // Already closed
  }
}

// ---------------------------------------------------------------------------
// makeCandidate — AutoMemoryCandidate factory
// ---------------------------------------------------------------------------

export function makeCandidate(overrides: Partial<AutoMemoryCandidate> = {}): AutoMemoryCandidate {
  return {
    id: 'draft-001',
    sessionId: 'session-abc',
    frustrationSignature: 'TypeError: Cannot read properties of undefined',
    failedApproaches: ['Tried clearing cache', 'Tried reinstalling'],
    successfulApproach: 'Updated dependency version',
    lessons: ['Always check dependency compatibility'],
    status: 'pending',
    createdAt: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildEmbeddingText — match the embedding text template from confirmExperience
// ---------------------------------------------------------------------------

export function buildEmbeddingText(candidate: AutoMemoryCandidate): string {
  const failed = candidate.failedApproaches.join('; ');
  const fixed = candidate.successfulApproach ?? '';
  const lessons = candidate.lessons.join('; ');
  return `${candidate.frustrationSignature}. Failed: ${failed}. Fixed: ${fixed}. Lessons: ${lessons}`;
}

// ---------------------------------------------------------------------------
// createTempDir — create a temporary directory for testing
// ---------------------------------------------------------------------------

export function createTempDir(prefix: string = 'sentinel-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
