/**
 * Unit Tests for Settings Loader
 *
 * TDD RED phase: These tests define the expected behavior of loadSettings()
 * from src/config/settings-loader.ts.
 *
 * The target module does NOT exist yet. All tests are expected to FAIL.
 *
 * Function under test:
 *   loadSettings(configPath?: string): SentinelSettings
 *
 * Behavior:
 *   1. If configPath is provided, read from that path; otherwise read from ~/.sentinel/settings.json
 *   2. Read file -> JSON.parse -> Zod validate with SentinelSettingsSchema
 *   3. On success: return validated settings
 *   4. On file not found: return default settings
 *   5. On invalid JSON: return default settings
 *   6. On Zod validation failure: return default settings
 *   7. Partial settings -> merge with defaults (Zod .default() handles sub-fields)
 *
 * Testing strategy:
 *   Uses real temp files (fs.writeFileSync to os.tmpdir()) rather than mocking fs.
 *   Each test gets a unique temp directory, cleaned up in afterEach.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { loadSettings } from '../../src/config/settings-loader';
import type { SentinelSettings } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Expected default settings that loadSettings() should return on any failure.
 *  NOTE: `enabled: true` is the new field being tested in the RED phase.
 *  This will cause comparison failures until `enabled` is added to the schema
 *  and DEFAULT_SETTINGS in settings-loader.ts.
 */
const DEFAULT_SETTINGS: SentinelSettings = {
  enabled: true,
  llm: {
    provider: 'ollama',
    ollama: {
      baseUrl: 'http://localhost:11434',
      completionModel: 'qwen3:4b',
      embeddingModel: 'qwen3-embedding:0.6b',
    },
  },
  storage: {
    dbPath: '~/.sentinel/sentinel.db',
  },
  recall: {
    maxAdvicesPerSession: 5,
  },
  analysis: {},
  debug: false,
};

let tempDir: string;

/**
 * Creates a unique temp directory for each test.
 * This avoids cross-test contamination and provides real filesystem interaction.
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));
}

/**
 * Writes a settings file to the temp directory and returns its path.
 */
function writeTempSettings(content: string, filename = 'settings.json'): string {
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('loadSettings', () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    // Clean up temp directory and all files within
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Normal operation
  // -------------------------------------------------------------------------
  describe('normal operation - valid settings files', () => {
    it('should load and return a valid complete settings file', () => {
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {
            baseUrl: 'http://localhost:11434',
            completionModel: 'qwen3:4b',
            embeddingModel: 'qwen3-embedding:0.6b',
          },
        },
        storage: {
          dbPath: '~/.sentinel/sentinel.db',
        },
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      // enabled, recall and debug are added by Zod default when omitted from config
      expect(result).toEqual({
        ...settings,
        enabled: true,
        recall: { maxAdvicesPerSession: 5 },
        analysis: {},
        debug: false,
      });
    });

    it('should return correct custom values from a settings file', () => {
      const settings = {
        llm: {
          provider: 'bedrock',
          ollama: {
            baseUrl: 'http://custom-host:9999',
            completionModel: 'custom-model',
            embeddingModel: 'custom-embedding',
          },
          bedrock: {
            region: 'ap-northeast-2',
            completionModel: 'anthropic.claude-sonnet-4-20250514',
            embeddingModel: 'amazon.titan-embed-text-v2:0',
          },
        },
        storage: {
          dbPath: '/custom/path/my.db',
        },
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.llm.provider).toBe('bedrock');
      expect(result.llm.ollama.baseUrl).toBe('http://custom-host:9999');
      expect(result.llm.ollama.completionModel).toBe('custom-model');
      expect(result.llm.ollama.embeddingModel).toBe('custom-embedding');
      expect(result.llm.bedrock?.region).toBe('ap-northeast-2');
      expect(result.storage.dbPath).toBe('/custom/path/my.db');
    });
  });

  // -------------------------------------------------------------------------
  // File not found
  // -------------------------------------------------------------------------
  describe('file not found - returns default settings', () => {
    it('should return default settings when configPath points to a non-existent file', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.json');

      const result = loadSettings(nonExistentPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('should return default settings when no configPath is provided and default path does not exist', () => {
      // When no configPath is given, loadSettings reads from ~/.sentinel/settings.json.
      // If that file does not exist, it should return defaults.
      // Note: This test assumes ~/.sentinel/settings.json does NOT exist on the test machine,
      // OR the implementation gracefully handles it. We test with a known-absent directory.
      //
      // To make this test deterministic, we can rely on the implementation using a default
      // path. If ~/.sentinel/settings.json happens to exist, this test verifies the function
      // still works (returns valid settings). The key contract: loadSettings() never throws.
      const result = loadSettings();

      // At minimum, the result must be a valid SentinelSettings
      expect(result).toBeDefined();
      expect(result.llm).toBeDefined();
      expect(result.llm.provider).toBeDefined();
      expect(result.storage).toBeDefined();
      expect(result.storage.dbPath).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Invalid JSON
  // -------------------------------------------------------------------------
  describe('invalid JSON - returns default settings', () => {
    it('should return default settings when file contains invalid JSON', () => {
      const configPath = writeTempSettings('not valid json {{{');

      const result = loadSettings(configPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('should return default settings when file is empty', () => {
      const configPath = writeTempSettings('');

      const result = loadSettings(configPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });
  });

  // -------------------------------------------------------------------------
  // Zod validation failure
  // -------------------------------------------------------------------------
  describe('Zod validation failure - returns default settings', () => {
    it('should return default settings when provider has an invalid value', () => {
      const settings = {
        llm: {
          provider: 'openai', // Not in enum ['ollama', 'bedrock']
          ollama: {
            baseUrl: 'http://localhost:11434',
            completionModel: 'qwen3:4b',
            embeddingModel: 'qwen3-embedding:0.6b',
          },
        },
        storage: {
          dbPath: '~/.sentinel/sentinel.db',
        },
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('should handle extra unknown fields gracefully (strip or pass through)', () => {
      // Zod by default strips unknown fields. The result should still be valid.
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {
            baseUrl: 'http://localhost:11434',
            completionModel: 'qwen3:4b',
            embeddingModel: 'qwen3-embedding:0.6b',
          },
          unknownField: 'should be stripped or ignored',
        },
        storage: {
          dbPath: '~/.sentinel/sentinel.db',
        },
        extraTopLevel: { foo: 'bar' },
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      // Must return a valid SentinelSettings object
      expect(result.llm.provider).toBe('ollama');
      expect(result.storage.dbPath).toBe('~/.sentinel/sentinel.db');
      // Unknown fields should not be present on the result
      expect((result as Record<string, unknown>)['extraTopLevel']).toBeUndefined();
      expect((result.llm as Record<string, unknown>)['unknownField']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Partial settings / defaults merge
  // -------------------------------------------------------------------------
  describe('partial settings - merged with defaults', () => {
    it('should apply default ollama fields when only provider is set', () => {
      // The file has llm.provider and ollama:{} but no sub-fields.
      // Zod .default() on OllamaSettingsSchema fields should fill them in.
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.llm.provider).toBe('ollama');
      expect(result.llm.ollama.baseUrl).toBe('http://localhost:11434');
      expect(result.llm.ollama.completionModel).toBe('qwen3:4b');
      expect(result.llm.ollama.embeddingModel).toBe('qwen3-embedding:0.6b');
    });

    it('should keep custom baseUrl but apply defaults for completionModel and embeddingModel', () => {
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {
            baseUrl: 'http://my-server:7777',
            // completionModel and embeddingModel omitted -> should get defaults
          },
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.llm.ollama.baseUrl).toBe('http://my-server:7777');
      expect(result.llm.ollama.completionModel).toBe('qwen3:4b');
      expect(result.llm.ollama.embeddingModel).toBe('qwen3-embedding:0.6b');
    });

    it('should apply default dbPath when storage section is empty', () => {
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.storage.dbPath).toBe('~/.sentinel/sentinel.db');
    });
  });

  // -------------------------------------------------------------------------
  // Default values verification
  // -------------------------------------------------------------------------
  describe('default values verification', () => {
    // Use a non-existent file to get pure defaults
    it('should have default provider as "ollama"', () => {
      const result = loadSettings(path.join(tempDir, 'nonexistent.json'));

      expect(result.llm.provider).toBe('ollama');
    });

    it('should have default ollama baseUrl as "http://localhost:11434"', () => {
      const result = loadSettings(path.join(tempDir, 'nonexistent.json'));

      expect(result.llm.ollama.baseUrl).toBe('http://localhost:11434');
    });

    it('should have default ollama completionModel as "qwen3"', () => {
      const result = loadSettings(path.join(tempDir, 'nonexistent.json'));

      expect(result.llm.ollama.completionModel).toBe('qwen3:4b');
    });

    it('should have default ollama embeddingModel as "qwen3-embedding"', () => {
      const result = loadSettings(path.join(tempDir, 'nonexistent.json'));

      expect(result.llm.ollama.embeddingModel).toBe('qwen3-embedding:0.6b');
    });

    it('should have default storage dbPath as "~/.sentinel/sentinel.db"', () => {
      const result = loadSettings(path.join(tempDir, 'nonexistent.json'));

      expect(result.storage.dbPath).toBe('~/.sentinel/sentinel.db');
    });
  });

  // -------------------------------------------------------------------------
  // Recall settings
  // -------------------------------------------------------------------------
  describe('recall settings', () => {
    it('should apply default recall settings when recall is omitted from config', () => {
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.recall).toBeDefined();
      expect(result.recall.maxAdvicesPerSession).toBe(5);
    });

    it('should use custom maxAdvicesPerSession from config file', () => {
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        recall: { maxAdvicesPerSession: 10 },
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.recall.maxAdvicesPerSession).toBe(10);
    });

    it('should include recall in default settings on failure', () => {
      const result = loadSettings(path.join(tempDir, 'nonexistent.json'));

      expect(result.recall).toBeDefined();
      expect(result.recall.maxAdvicesPerSession).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // debug setting
  // -------------------------------------------------------------------------
  describe('debug setting', () => {
    it('should default debug to false when not in config', () => {
      // Config file omits `debug` entirely. The schema default should apply.
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.debug).toBe(false);
    });

    it('should load debug: true from config file', () => {
      // Config file explicitly sets debug to true.
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        debug: true,
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.debug).toBe(true);
    });

    it('should include debug: false in default settings on failure', () => {
      // When the config file does not exist, DEFAULT_SETTINGS should include debug: false
      const result = loadSettings(path.join(tempDir, 'nonexistent.json'));

      expect(result.debug).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // NEW: enabled setting (RED phase - these WILL FAIL until implemented)
  //
  // Requirements:
  //   - DEFAULT_SETTINGS should have `enabled: true`
  //   - loadSettings() with a config file containing `enabled: false` should
  //     return `enabled: false`
  //   - loadSettings() with a config file missing `enabled` should return
  //     `enabled: true` (the default)
  //   - loadSettings() on failure (file not found, bad JSON, etc.) should
  //     return DEFAULT_SETTINGS which includes `enabled: true`
  //
  // Edge cases:
  //   - enabled: false combined with other settings should preserve false
  //   - enabled should not interfere with other default fields
  // -------------------------------------------------------------------------
  describe('enabled setting', () => {
    it('should have enabled: true in DEFAULT_SETTINGS', () => {
      // When the config file does not exist, the returned defaults must
      // include `enabled: true` so Sentinel is active out of the box.
      const result = loadSettings(path.join(tempDir, 'nonexistent.json'));

      expect(result.enabled).toBe(true);
    });

    it('should default enabled to true when config file omits it', () => {
      // Config file has valid settings but no `enabled` field.
      // The Zod schema default (true) should be applied.
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.enabled).toBe(true);
    });

    it('should load enabled: false from config file', () => {
      // Config file explicitly sets enabled to false.
      // This allows users to disable Sentinel without removing hooks.
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        enabled: false,
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.enabled).toBe(false);
    });

    it('should load enabled: true from config file', () => {
      // Config file explicitly sets enabled to true.
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {},
        },
        storage: {},
        enabled: true,
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.enabled).toBe(true);
    });

    it('should preserve enabled: false alongside other custom settings', () => {
      // Verify that enabled: false coexists with other custom settings
      // without being overwritten by defaults.
      const settings = {
        llm: {
          provider: 'bedrock',
          ollama: {
            baseUrl: 'http://custom:9999',
          },
          bedrock: {},
        },
        storage: {
          dbPath: '/custom/sentinel.db',
        },
        enabled: false,
        debug: true,
        recall: { maxAdvicesPerSession: 3 },
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.enabled).toBe(false);
      expect(result.llm.provider).toBe('bedrock');
      expect(result.debug).toBe(true);
      expect(result.recall.maxAdvicesPerSession).toBe(3);
    });

    it('should return enabled: true in DEFAULT_SETTINGS on invalid JSON', () => {
      // Even when the config file is corrupt, the fallback defaults
      // must include enabled: true.
      const configPath = writeTempSettings('not valid json {{{');

      const result = loadSettings(configPath);

      expect(result.enabled).toBe(true);
    });

    it('should return enabled: true in DEFAULT_SETTINGS on Zod validation failure', () => {
      // When the config file fails Zod validation, the fallback
      // defaults must include enabled: true.
      const settings = {
        llm: {
          provider: 'openai', // invalid provider
          ollama: {},
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should populate bedrock fields when bedrock config is provided', () => {
      const settings = {
        llm: {
          provider: 'bedrock',
          ollama: {},
          bedrock: {
            region: 'eu-west-1',
            completionModel: 'anthropic.claude-sonnet-4-20250514',
            embeddingModel: 'amazon.titan-embed-text-v2:0',
          },
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.llm.provider).toBe('bedrock');
      expect(result.llm.bedrock).toBeDefined();
      expect(result.llm.bedrock?.region).toBe('eu-west-1');
      expect(result.llm.bedrock?.completionModel).toBe('anthropic.claude-sonnet-4-20250514');
      expect(result.llm.bedrock?.embeddingModel).toBe('amazon.titan-embed-text-v2:0');
    });

    it('should apply bedrock defaults when bedrock config is an empty object', () => {
      const settings = {
        llm: {
          provider: 'bedrock',
          ollama: {},
          bedrock: {},
        },
        storage: {},
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      expect(result.llm.bedrock?.region).toBe('us-east-1');
      expect(result.llm.bedrock?.completionModel).toBe('us.anthropic.claude-sonnet-4-20250514-v1:0');
      expect(result.llm.bedrock?.embeddingModel).toBe('amazon.titan-embed-text-v2:0');
    });

    it('should handle null values for optional fields gracefully', () => {
      // JSON files can have explicit null values. The loader should handle these
      // without throwing, either by replacing with defaults or returning defaults.
      const settings = {
        llm: {
          provider: 'ollama',
          ollama: {
            baseUrl: null,
            completionModel: null,
            embeddingModel: null,
          },
          bedrock: null,
        },
        storage: {
          dbPath: null,
        },
      };
      const configPath = writeTempSettings(JSON.stringify(settings));

      const result = loadSettings(configPath);

      // The loader should never throw. It either:
      // a) Falls back to full defaults (if Zod rejects nulls), or
      // b) Applies defaults for null fields
      // Either way, the result must be a valid SentinelSettings.
      expect(result).toBeDefined();
      expect(result.llm).toBeDefined();
      expect(result.llm.provider).toBeDefined();
      expect(typeof result.llm.provider).toBe('string');
      expect(result.storage).toBeDefined();
      expect(typeof result.storage.dbPath).toBe('string');
    });

    it('should never throw an exception regardless of input', () => {
      // loadSettings must ALWAYS return a valid SentinelSettings.
      // Test with various bad paths and content.
      expect(() => loadSettings(path.join(tempDir, 'nope.json'))).not.toThrow();
      expect(() => loadSettings('/completely/invalid/path/that/does/not/exist.json')).not.toThrow();

      const badJsonPath = writeTempSettings('{{{{');
      expect(() => loadSettings(badJsonPath)).not.toThrow();

      const arrayPath = writeTempSettings('[1,2,3]');
      expect(() => loadSettings(arrayPath)).not.toThrow();

      const numberPath = writeTempSettings('42');
      expect(() => loadSettings(numberPath)).not.toThrow();

      const nullPath = writeTempSettings('null');
      expect(() => loadSettings(nullPath)).not.toThrow();
    });

    it('should return default settings when file contains a JSON array instead of object', () => {
      const configPath = writeTempSettings('[1, 2, 3]');

      const result = loadSettings(configPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('should return default settings when file contains a JSON number', () => {
      const configPath = writeTempSettings('42');

      const result = loadSettings(configPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('should return default settings when file contains JSON null', () => {
      const configPath = writeTempSettings('null');

      const result = loadSettings(configPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('should return default settings when file contains a JSON string', () => {
      const configPath = writeTempSettings('"just a string"');

      const result = loadSettings(configPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    it('should return default settings when file contains JSON boolean true', () => {
      const configPath = writeTempSettings('true');

      const result = loadSettings(configPath);

      expect(result).toEqual(DEFAULT_SETTINGS);
    });
  });

  // -------------------------------------------------------------------------
  // Return type validation
  // -------------------------------------------------------------------------
  describe('return type is always a valid SentinelSettings', () => {
    it('should always return an object matching SentinelSettings shape', () => {
      // Test with non-existent file
      const result = loadSettings(path.join(tempDir, 'nope.json'));

      // Structural checks
      expect(result).toHaveProperty('llm');
      expect(result).toHaveProperty('llm.provider');
      expect(result).toHaveProperty('llm.ollama');
      expect(result).toHaveProperty('llm.ollama.baseUrl');
      expect(result).toHaveProperty('llm.ollama.completionModel');
      expect(result).toHaveProperty('llm.ollama.embeddingModel');
      expect(result).toHaveProperty('storage');
      expect(result).toHaveProperty('storage.dbPath');
      expect(result).toHaveProperty('enabled');

      // Type checks
      expect(['ollama', 'bedrock']).toContain(result.llm.provider);
      expect(typeof result.llm.ollama.baseUrl).toBe('string');
      expect(typeof result.llm.ollama.completionModel).toBe('string');
      expect(typeof result.llm.ollama.embeddingModel).toBe('string');
      expect(typeof result.storage.dbPath).toBe('string');
      expect(typeof result.enabled).toBe('boolean');
    });
  });
});
