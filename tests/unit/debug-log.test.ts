import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock settings-loader BEFORE importing debugLog
jest.mock('../../src/config/settings-loader', () => ({
  loadSettings: jest.fn(() => ({ debug: false })),
}));

import { debugLog } from '../../src/utils/debug-log';
import { loadSettings } from '../../src/config/settings-loader';

const mockLoadSettings = loadSettings as jest.MockedFunction<typeof loadSettings>;

describe('debugLog', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-debug-test-'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should write a timestamped message to hook-debug.log when debug is true', () => {
    mockLoadSettings.mockReturnValue({ debug: true } as any);

    // Reset the cached setting by re-importing (we use resetDebugSetting if exported)
    // For now, we need to clear the module cache
    jest.resetModules();
    jest.mock('../../src/config/settings-loader', () => ({
      loadSettings: jest.fn(() => ({ debug: true })),
    }));
    const { debugLog: freshDebugLog } = require('../../src/utils/debug-log');

    freshDebugLog('test message', tempDir);

    const logPath = path.join(tempDir, 'hook-debug.log');
    expect(fs.existsSync(logPath)).toBe(true);

    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('test message');
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
  });

  it('should append multiple messages when debug is true', () => {
    jest.resetModules();
    jest.mock('../../src/config/settings-loader', () => ({
      loadSettings: jest.fn(() => ({ debug: true })),
    }));
    const { debugLog: freshDebugLog } = require('../../src/utils/debug-log');

    freshDebugLog('first', tempDir);
    freshDebugLog('second', tempDir);

    const logPath = path.join(tempDir, 'hook-debug.log');
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('first');
    expect(content).toContain('second');
  });

  it('should not throw when directory does not exist', () => {
    jest.resetModules();
    jest.mock('../../src/config/settings-loader', () => ({
      loadSettings: jest.fn(() => ({ debug: true })),
    }));
    const { debugLog: freshDebugLog } = require('../../src/utils/debug-log');

    expect(() => freshDebugLog('test', '/nonexistent/path/that/does/not/exist')).not.toThrow();
  });

  it('should NOT write to log file when debug is false', () => {
    jest.resetModules();
    jest.mock('../../src/config/settings-loader', () => ({
      loadSettings: jest.fn(() => ({ debug: false })),
    }));
    const { debugLog: freshDebugLog } = require('../../src/utils/debug-log');

    freshDebugLog('this should not appear', tempDir);

    const logPath = path.join(tempDir, 'hook-debug.log');
    expect(fs.existsSync(logPath)).toBe(false);
  });
});
