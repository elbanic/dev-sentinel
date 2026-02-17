/**
 * Unit Tests for LLMProviderManager
 *
 * TDD RED phase: These tests define the expected behavior of the
 * LLMProviderManager, which selects and manages LLM provider instances
 * based on SentinelSettings.
 *
 * Target module (does NOT exist yet):
 *   - src/llm/llm-provider-manager.ts
 *
 * All tests are expected to FAIL until the implementation is written.
 *
 * Behaviors under test:
 *   - Provider selection based on settings.llm.provider
 *   - Mock provider override for testing
 *   - Availability delegation to underlying provider
 *
 * Edge cases covered:
 *   - Provider caching: same instance returned on repeated getProvider() calls
 *   - Override takes full precedence regardless of settings.llm.provider value
 *   - Unavailable provider correctly propagates false through manager
 *   - No silent fallback: failed primary stays as the active provider
 *
 * Assumptions:
 *   - LLMProviderManager constructor signature: (settings, providerOverride?)
 *   - The optional second argument (LLMProvider) is used for testing injection
 *   - Provider instances are created lazily or eagerly, but cached after first access
 */

import { LLMProviderManager } from '../../src/llm/llm-provider-manager';
import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import { LocalLLMProvider } from '../../src/llm/local-llm-provider';
import { BedrockLLMProvider } from '../../src/llm/bedrock-llm-provider';
import type { LLMProvider, SentinelSettings } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Helpers: Default settings factories
// ---------------------------------------------------------------------------

/**
 * Creates a SentinelSettings object configured for Ollama (local).
 */
function createOllamaSettings(
  overrides?: Partial<SentinelSettings>
): SentinelSettings {
  return {
    enabled: true,
    debug: false,
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
    ...overrides,
  };
}

/**
 * Creates a SentinelSettings object configured for Bedrock (cloud).
 */
function createBedrockSettings(
  overrides?: Partial<SentinelSettings>
): SentinelSettings {
  return {
    enabled: true,
    debug: false,
    llm: {
      provider: 'bedrock',
      ollama: {
        baseUrl: 'http://localhost:11434',
        completionModel: 'qwen3:4b',
        embeddingModel: 'qwen3-embedding:0.6b',
      },
      bedrock: {
        region: 'us-east-1',
        completionModel: 'anthropic.claude-sonnet-4-20250514',
        embeddingModel: 'amazon.titan-embed-text-v2:0',
      },
    },
    storage: {
      dbPath: '~/.sentinel/sentinel.db',
    },
    recall: {
      maxAdvicesPerSession: 5,
    },
    analysis: {},
    ...overrides,
  };
}

// =============================================================================
// LLMProviderManager
// =============================================================================
describe('LLMProviderManager', () => {
  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------
  describe('construction', () => {
    it('should construct with ollama settings', () => {
      const manager = new LLMProviderManager(createOllamaSettings());
      expect(manager).toBeDefined();
    });

    it('should construct with bedrock settings', () => {
      const manager = new LLMProviderManager(createBedrockSettings());
      expect(manager).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Provider selection
  // ---------------------------------------------------------------------------
  describe('getProvider()', () => {
    it('should return a LocalLLMProvider when provider is ollama', () => {
      const manager = new LLMProviderManager(createOllamaSettings());
      const provider = manager.getProvider();

      expect(provider).toBeInstanceOf(LocalLLMProvider);
    });

    it('should return a BedrockLLMProvider when provider is bedrock', () => {
      const manager = new LLMProviderManager(createBedrockSettings());
      const provider = manager.getProvider();

      expect(provider).toBeInstanceOf(BedrockLLMProvider);
    });

    it('should return the same provider instance on repeated calls', () => {
      const manager = new LLMProviderManager(createOllamaSettings());
      const provider1 = manager.getProvider();
      const provider2 = manager.getProvider();

      expect(provider1).toBe(provider2);
    });

    it('should return an object that conforms to the LLMProvider interface', () => {
      const manager = new LLMProviderManager(createOllamaSettings());
      const provider: LLMProvider = manager.getProvider();

      expect(typeof provider.generateCompletion).toBe('function');
      expect(typeof provider.generateEmbedding).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // Mock provider override (for testing)
  // ---------------------------------------------------------------------------
  describe('mock provider override', () => {
    it('should accept a mock provider override in constructor', () => {
      const mock = new MockLLMProvider();
      const manager = new LLMProviderManager(
        createOllamaSettings(),
        mock
      );
      expect(manager).toBeDefined();
    });

    it('should return the mock provider when override is set', () => {
      const mock = new MockLLMProvider();
      const manager = new LLMProviderManager(
        createOllamaSettings(),
        mock
      );
      const provider = manager.getProvider();

      expect(provider).toBe(mock);
    });

    it('should use the mock provider for isAvailable checks', async () => {
      const mock = new MockLLMProvider();
      const manager = new LLMProviderManager(
        createOllamaSettings(),
        mock
      );

      const available = await manager.isAvailable();
      expect(available).toBe(true);

      // Verify the mock was actually called
      expect(
        mock.calls.some(
          (c: { method: string; args: unknown[] }) => c.method === 'isAvailable'
        )
      ).toBe(true);
    });

    it('should allow functional testing via mock without real providers', async () => {
      const mock = new MockLLMProvider();
      const manager = new LLMProviderManager(
        createOllamaSettings(),
        mock
      );

      const provider = manager.getProvider();
      const result = await provider.generateCompletion('system', 'test prompt');

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].method).toBe('generateCompletion');
    });
  });

  // ---------------------------------------------------------------------------
  // isAvailable()
  // ---------------------------------------------------------------------------
  describe('isAvailable()', () => {
    it('should delegate to the current provider isAvailable()', async () => {
      const mock = new MockLLMProvider();
      const manager = new LLMProviderManager(
        createOllamaSettings(),
        mock
      );

      await manager.isAvailable();

      // The mock should record the isAvailable call
      expect(mock.calls).toContainEqual({
        method: 'isAvailable',
        args: [],
      });
    });

    it('should return true when the provider is available', async () => {
      const mock = new MockLLMProvider(); // normal mode = available
      const manager = new LLMProviderManager(
        createOllamaSettings(),
        mock
      );

      const available = await manager.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when the provider is unavailable', async () => {
      const mock = new MockLLMProvider({ shouldFail: true }); // shouldFail = unavailable
      const manager = new LLMProviderManager(
        createOllamaSettings(),
        mock
      );

      const available = await manager.isAvailable();
      expect(available).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // No automatic fallback (design decision)
  // ---------------------------------------------------------------------------
  describe('fallback behavior', () => {
    it('should not automatically switch providers when primary is unavailable', async () => {
      // Even when ollama is selected but fails, the manager should NOT
      // silently switch to bedrock. It should just report unavailable.
      const mock = new MockLLMProvider({ shouldFail: true });
      const manager = new LLMProviderManager(
        createOllamaSettings(),
        mock
      );

      const available = await manager.isAvailable();
      expect(available).toBe(false);

      // getProvider() should still return the same (failed) provider
      const provider = manager.getProvider();
      expect(provider).toBe(mock);
    });
  });
});
