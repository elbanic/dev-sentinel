/**
 * Orchestrator integration tests for CLI (`src/cli.ts`)
 *
 * Tests that createProgram is exported and the program object is properly
 * configured. All command-specific tests have been moved to:
 *   - cli-hook-command.test.ts
 *   - cli-review-commands.test.ts
 *   - cli-experience-commands.test.ts
 *   - cli-settings-commands.test.ts
 */

import { createProgram } from '../../src/cli';
import {
  createTestDeps,
  cleanupDeps,
} from '../helpers/cli-test-helpers';

// ---------------------------------------------------------------------------
// Module mocks for hook handlers (required by createProgram)
// ---------------------------------------------------------------------------

jest.mock('../../src/hook/user-prompt-submit-handler', () => ({
  handleUserPromptSubmit: jest.fn(),
}));

jest.mock('../../src/hook/stop-hook-handler', () => ({
  handleStop: jest.fn(),
}));

jest.mock('../../src/hook/session-end-handler', () => ({
  handleSessionEnd: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CLI - createProgram', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should export createProgram as a function', () => {
    expect(typeof createProgram).toBe('function');
  });

  it('should return a Commander program instance', () => {
    const deps = createTestDeps();
    try {
      const program = createProgram(deps);
      expect(program).toBeDefined();
      expect(typeof program.parseAsync).toBe('function');
      expect(typeof program.name).toBe('function');
    } finally {
      cleanupDeps(deps);
    }
  });

  it('should register expected subcommands', () => {
    const deps = createTestDeps();
    try {
      const program = createProgram(deps);
      const commandNames = program.commands.map((c) => c.name());
      // Core subcommands should be registered
      expect(commandNames).toContain('review');
      expect(commandNames).toContain('add');
      expect(commandNames).toContain('list');
      expect(commandNames).toContain('status');
      expect(commandNames).toContain('enable');
      expect(commandNames).toContain('disable');
      expect(commandNames).toContain('detail');
      expect(commandNames).toContain('delete');
      expect(commandNames).toContain('reset');
      expect(commandNames).toContain('history');
      expect(commandNames).toContain('debug');
    } finally {
      cleanupDeps(deps);
    }
  });
});
