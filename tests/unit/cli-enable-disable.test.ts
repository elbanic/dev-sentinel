/**
 * Unit Tests for toggleSentinelEnabled() utility function
 *
 * Tests the core read-modify-write logic independent of the CLI layer.
 * CLI integration tests for enable/disable/status/debug have been moved to:
 *   cli-settings-commands.test.ts
 *
 * Test categories (3 groups):
 *   1. toggleSentinelEnabled() utility — core logic
 *   2. Edge cases — rapid toggling, minimal files, encoding
 *   3. Property tests — round-trip settings preservation via fast-check
 */

import * as fs from 'fs';
import * as path from 'path';
import * as fc from 'fast-check';
import {
  createTempDir,
} from '../helpers/cli-test-helpers';

import { toggleSentinelEnabled } from '../../src/config/toggle-enabled';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

function writeSettings(content: Record<string, unknown>): string {
  const filePath = path.join(tempDir, 'settings.json');
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  return filePath;
}

function readSettings(): Record<string, unknown> {
  const filePath = path.join(tempDir, 'settings.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function settingsFileExists(): boolean {
  return fs.existsSync(path.join(tempDir, 'settings.json'));
}

// ===========================================================================
// 1. toggleSentinelEnabled() utility — core logic
// ===========================================================================
describe('toggleSentinelEnabled utility', () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Basic enable/disable operations
  // -------------------------------------------------------------------------
  describe('basic operations', () => {
    it('should set enabled to false when disabling', () => {
      writeSettings({
        enabled: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      toggleSentinelEnabled(tempDir, false);

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should set enabled to true when enabling', () => {
      writeSettings({
        enabled: false,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      toggleSentinelEnabled(tempDir, true);

      const settings = readSettings();
      expect(settings.enabled).toBe(true);
    });

    it('should be idempotent when disabling an already disabled sentinel', () => {
      writeSettings({
        enabled: false,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      toggleSentinelEnabled(tempDir, false);

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should be idempotent when enabling an already enabled sentinel', () => {
      writeSettings({
        enabled: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      toggleSentinelEnabled(tempDir, true);

      const settings = readSettings();
      expect(settings.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Settings file creation when missing
  // -------------------------------------------------------------------------
  describe('file creation when missing', () => {
    it('should create settings.json with enabled: false when disabling and file does not exist', () => {
      expect(settingsFileExists()).toBe(false);

      toggleSentinelEnabled(tempDir, false);

      expect(settingsFileExists()).toBe(true);
      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should create settings.json with enabled: true when enabling and file does not exist', () => {
      expect(settingsFileExists()).toBe(false);

      toggleSentinelEnabled(tempDir, true);

      expect(settingsFileExists()).toBe(true);
      const settings = readSettings();
      expect(settings.enabled).toBe(true);
    });

    it('should create the config directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', '.sentinel');
      expect(fs.existsSync(nestedDir)).toBe(false);

      toggleSentinelEnabled(nestedDir, false);

      expect(fs.existsSync(nestedDir)).toBe(true);
      const filePath = path.join(nestedDir, 'settings.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const settings = JSON.parse(raw);
      expect(settings.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Preserving existing settings (critical requirement)
  // -------------------------------------------------------------------------
  describe('preserving existing settings', () => {
    it('should preserve llm configuration when toggling enabled', () => {
      writeSettings({
        enabled: true,
        llm: {
          provider: 'bedrock',
          ollama: {
            baseUrl: 'http://custom:9999',
            completionModel: 'custom-model',
            embeddingModel: 'custom-embedding',
          },
          bedrock: {
            region: 'ap-northeast-2',
            completionModel: 'anthropic.claude-sonnet-4-20250514',
            embeddingModel: 'amazon.titan-embed-text-v2:0',
          },
        },
        storage: { dbPath: '/custom/path/my.db' },
      });

      toggleSentinelEnabled(tempDir, false);

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
      expect((settings.llm as any).provider).toBe('bedrock');
      expect((settings.llm as any).ollama.baseUrl).toBe('http://custom:9999');
      expect((settings.llm as any).ollama.completionModel).toBe('custom-model');
      expect((settings.llm as any).bedrock.region).toBe('ap-northeast-2');
      expect((settings.storage as any).dbPath).toBe('/custom/path/my.db');
    });

    it('should preserve debug flag when toggling enabled', () => {
      writeSettings({
        enabled: true,
        debug: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
      });

      toggleSentinelEnabled(tempDir, false);

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.debug).toBe(true);
    });

    it('should preserve recall settings when toggling enabled', () => {
      writeSettings({
        enabled: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
        recall: { maxAdvicesPerSession: 10 },
      });

      toggleSentinelEnabled(tempDir, false);

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
      expect((settings.recall as any).maxAdvicesPerSession).toBe(10);
    });

    it('should preserve unknown/extra fields when toggling enabled', () => {
      writeSettings({
        enabled: true,
        llm: { provider: 'ollama', ollama: {} },
        storage: {},
        customField: 'should survive',
        experimental: { feature: true },
      });

      toggleSentinelEnabled(tempDir, false);

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.customField).toBe('should survive');
      expect((settings.experimental as any).feature).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Handling malformed settings files
  // -------------------------------------------------------------------------
  describe('handling malformed settings files', () => {
    it('should overwrite with valid JSON when settings.json contains invalid JSON', () => {
      const filePath = path.join(tempDir, 'settings.json');
      fs.writeFileSync(filePath, 'this is not json {{{', 'utf-8');

      expect(() => toggleSentinelEnabled(tempDir, false)).not.toThrow();

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should handle empty settings file gracefully', () => {
      const filePath = path.join(tempDir, 'settings.json');
      fs.writeFileSync(filePath, '', 'utf-8');

      expect(() => toggleSentinelEnabled(tempDir, false)).not.toThrow();

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should handle settings file that is a JSON array', () => {
      const filePath = path.join(tempDir, 'settings.json');
      fs.writeFileSync(filePath, '[1, 2, 3]', 'utf-8');

      expect(() => toggleSentinelEnabled(tempDir, false)).not.toThrow();

      const settings = readSettings();
      expect(settings.enabled).toBe(false);
    });

    it('should handle settings file that is a JSON primitive', () => {
      const filePath = path.join(tempDir, 'settings.json');
      fs.writeFileSync(filePath, '"just a string"', 'utf-8');

      expect(() => toggleSentinelEnabled(tempDir, true)).not.toThrow();

      const settings = readSettings();
      expect(settings.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // JSON formatting
  // -------------------------------------------------------------------------
  describe('output formatting', () => {
    it('should write pretty-printed JSON (not minified)', () => {
      writeSettings({ enabled: true, llm: { provider: 'ollama', ollama: {} }, storage: {} });

      toggleSentinelEnabled(tempDir, false);

      const filePath = path.join(tempDir, 'settings.json');
      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).toContain('\n');
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });
});

// ===========================================================================
// 2. Edge cases
// ===========================================================================
describe('enable/disable edge cases', () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle rapid enable/disable toggling without corruption', () => {
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: {},
    });

    toggleSentinelEnabled(tempDir, false);
    toggleSentinelEnabled(tempDir, true);
    toggleSentinelEnabled(tempDir, false);
    toggleSentinelEnabled(tempDir, true);
    toggleSentinelEnabled(tempDir, false);

    const settings = readSettings();
    expect(settings.enabled).toBe(false);
    const filePath = path.join(tempDir, 'settings.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('should handle settings file with only enabled field', () => {
    writeSettings({ enabled: true });

    toggleSentinelEnabled(tempDir, false);

    const settings = readSettings();
    expect(settings.enabled).toBe(false);
  });

  it('should handle settings file that is an empty object', () => {
    writeSettings({});

    toggleSentinelEnabled(tempDir, false);

    const settings = readSettings();
    expect(settings.enabled).toBe(false);
  });

  it('should never throw regardless of file system state', () => {
    expect(() => toggleSentinelEnabled(tempDir, false)).not.toThrow();
    expect(() => toggleSentinelEnabled(tempDir, true)).not.toThrow();

    const deepPath = path.join(tempDir, 'a', 'b', 'c', '.sentinel');
    expect(() => toggleSentinelEnabled(deepPath, false)).not.toThrow();
  });

  it('should preserve file encoding as UTF-8', () => {
    writeSettings({
      enabled: true,
      llm: { provider: 'ollama', ollama: {} },
      storage: { dbPath: '/home/user/sentinel-data' },
    });

    toggleSentinelEnabled(tempDir, false);

    const filePath = path.join(tempDir, 'settings.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw);
    expect(parsed.storage.dbPath).toBe('/home/user/sentinel-data');
  });
});

// ===========================================================================
// 3. Property tests — round-trip settings preservation via fast-check
// ===========================================================================
describe('Property: toggleSentinelEnabled preserves all non-enabled fields', () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should preserve arbitrary string fields in the settings object', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1 }).filter((k) => k !== 'enabled'),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
        ),
        fc.boolean(),
        (extraFields, targetEnabled) => {
          const original = { enabled: !targetEnabled, ...extraFields };
          writeSettings(original);

          toggleSentinelEnabled(tempDir, targetEnabled);

          const result = readSettings();
          expect(result.enabled).toBe(targetEnabled);
          for (const [key, value] of Object.entries(extraFields)) {
            expect(result[key]).toEqual(value);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('should always produce valid JSON after any toggle operation', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (enabled) => {
          const localDir = createTempDir();
          try {
            toggleSentinelEnabled(localDir, enabled);

            const filePath = path.join(localDir, 'settings.json');
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            expect(parsed.enabled).toBe(enabled);
          } finally {
            fs.rmSync(localDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  it('should satisfy: disable then enable is equivalent to just setting enabled: true', () => {
    fc.assert(
      fc.property(
        fc.record({
          debug: fc.boolean(),
          provider: fc.constantFrom('ollama', 'bedrock'),
        }),
        ({ debug, provider }) => {
          const original = {
            enabled: true,
            debug,
            llm: { provider, ollama: {} },
            storage: {},
          };
          writeSettings(original);

          toggleSentinelEnabled(tempDir, false);
          toggleSentinelEnabled(tempDir, true);

          const result = readSettings();
          expect(result.enabled).toBe(true);
          expect(result.debug).toBe(debug);
          expect((result.llm as any).provider).toBe(provider);
        },
      ),
      { numRuns: 10 },
    );
  });
});
