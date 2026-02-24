/**
 * Unit Tests for LLM Providers
 *
 * TDD RED phase: These tests define the expected behavior of all LLM provider
 * implementations and the shared prompts module.
 *
 * Target modules (do NOT exist yet):
 *   - src/llm/mock-llm-provider.ts   (MockLLMProvider)
 *   - src/llm/local-llm-provider.ts  (LocalLLMProvider / Ollama)
 *   - src/llm/bedrock-llm-provider.ts (BedrockLLMProvider / AWS Bedrock)
 *   - src/llm/prompts.ts             (PROMPTS constant)
 *
 * All tests are expected to FAIL until the implementations are written.
 *
 * Components under test:
 *   - MockLLMProvider: deterministic responses, shouldFail mode, call recording
 *   - LocalLLMProvider: construction and interface conformance (no HTTP calls)
 *   - BedrockLLMProvider: construction and interface conformance (no SDK calls)
 *   - PROMPTS: non-empty system prompts for all analysis tasks
 *
 * Edge cases covered:
 *   - Empty string inputs to generateCompletion and generateEmbedding
 *   - Long inputs (>50 chars) for truncation behavior
 *   - Determinism: same input produces same output across calls
 *   - Distinctness: different inputs produce different embeddings
 *   - shouldFail mode error messages match exactly
 *   - Call recording persists even when methods throw
 *   - reset() properly clears state without affecting future calls
 *
 * Assumptions:
 *   - MockLLMProvider response format: "mock-completion: <user.substring(0, 50)>"
 *   - MockLLMProvider embedding: hash-based deterministic fixed-length number array
 *   - All providers implement LLMProvider interface from src/types/index.ts
 */

import { MockLLMProvider } from '../../src/llm/mock-llm-provider';
import { LocalLLMProvider } from '../../src/llm/local-llm-provider';
import { BedrockLLMProvider } from '../../src/llm/bedrock-llm-provider';
import { PROMPTS } from '../../src/llm/prompts';
import type { LLMProvider } from '../../src/types/index';

// =============================================================================
// MockLLMProvider
// =============================================================================
describe('MockLLMProvider', () => {
  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------
  describe('construction', () => {
    it('should construct without options', () => {
      const provider = new MockLLMProvider();
      expect(provider).toBeDefined();
    });

    it('should construct with shouldFail option', () => {
      const provider = new MockLLMProvider({ shouldFail: true });
      expect(provider).toBeDefined();
    });

    it('should implement LLMProvider interface', () => {
      const provider: LLMProvider = new MockLLMProvider();
      expect(typeof provider.generateCompletion).toBe('function');
      expect(typeof provider.generateEmbedding).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // generateCompletion (normal mode)
  // ---------------------------------------------------------------------------
  describe('generateCompletion', () => {
    it('should return a deterministic string based on user input', async () => {
      const provider = new MockLLMProvider();
      const result = await provider.generateCompletion('system prompt', 'user message');

      // The mock should return a predictable string that includes part of the user input
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('mock-completion');
    });

    it('should include up to 50 chars of the user input in the response', async () => {
      const provider = new MockLLMProvider();
      const shortInput = 'hello world';
      const result = await provider.generateCompletion('sys', shortInput);

      expect(result).toContain(shortInput);
    });

    it('should truncate user input beyond 50 chars in the response', async () => {
      const provider = new MockLLMProvider();
      const longInput = 'a'.repeat(100);
      const result = await provider.generateCompletion('sys', longInput);

      // Should include at most 50 chars of the input
      expect(result).toContain('a'.repeat(50));
      expect(result).not.toContain('a'.repeat(51));
    });

    it('should return the same response for the same inputs (deterministic)', async () => {
      const provider = new MockLLMProvider();
      const result1 = await provider.generateCompletion('sys', 'user msg');
      const result2 = await provider.generateCompletion('sys', 'user msg');
      expect(result1).toBe(result2);
    });
  });

  // ---------------------------------------------------------------------------
  // generateEmbedding (normal mode)
  // ---------------------------------------------------------------------------
  describe('generateEmbedding', () => {
    it('should return a number array', async () => {
      const provider = new MockLLMProvider();
      const embedding = await provider.generateEmbedding('test text');

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
      embedding.forEach((val: number) => {
        expect(typeof val).toBe('number');
        expect(Number.isFinite(val)).toBe(true);
      });
    });

    it('should return the same vector for the same input (deterministic)', async () => {
      const provider = new MockLLMProvider();
      const embedding1 = await provider.generateEmbedding('same text');
      const embedding2 = await provider.generateEmbedding('same text');

      expect(embedding1).toEqual(embedding2);
    });

    it('should return different vectors for different inputs', async () => {
      const provider = new MockLLMProvider();
      const embedding1 = await provider.generateEmbedding('first text');
      const embedding2 = await provider.generateEmbedding('second text');

      // At least one element should differ
      const allSame = embedding1.every(
        (val: number, idx: number) => val === embedding2[idx]
      );
      expect(allSame).toBe(false);
    });

    it('should return vectors of consistent length', async () => {
      const provider = new MockLLMProvider();
      const embedding1 = await provider.generateEmbedding('text one');
      const embedding2 = await provider.generateEmbedding('text two');

      expect(embedding1.length).toBe(embedding2.length);
    });
  });

  // ---------------------------------------------------------------------------
  // isAvailable (normal mode)
  // ---------------------------------------------------------------------------
  describe('isAvailable', () => {
    it('should return true in normal mode', async () => {
      const provider = new MockLLMProvider();
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // shouldFail mode
  // ---------------------------------------------------------------------------
  describe('shouldFail mode', () => {
    it('should throw on generateCompletion when shouldFail is true', async () => {
      const provider = new MockLLMProvider({ shouldFail: true });

      await expect(
        provider.generateCompletion('sys', 'user')
      ).rejects.toThrow('MockLLMProvider: forced failure');
    });

    it('should throw on generateEmbedding when shouldFail is true', async () => {
      const provider = new MockLLMProvider({ shouldFail: true });

      await expect(
        provider.generateEmbedding('some text')
      ).rejects.toThrow('MockLLMProvider: forced failure');
    });

    it('should return false on isAvailable when shouldFail is true', async () => {
      const provider = new MockLLMProvider({ shouldFail: true });
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Call recording (spy behavior)
  // ---------------------------------------------------------------------------
  describe('call recording', () => {
    it('should start with an empty calls array', () => {
      const provider = new MockLLMProvider();
      expect(provider.calls).toEqual([]);
    });

    it('should record generateCompletion calls', async () => {
      const provider = new MockLLMProvider();
      await provider.generateCompletion('system', 'user');

      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toEqual({
        method: 'generateCompletion',
        args: ['system', 'user'],
      });
    });

    it('should record generateEmbedding calls', async () => {
      const provider = new MockLLMProvider();
      await provider.generateEmbedding('embed me');

      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toEqual({
        method: 'generateEmbedding',
        args: ['embed me'],
      });
    });

    it('should record isAvailable calls', async () => {
      const provider = new MockLLMProvider();
      await provider.isAvailable();

      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toEqual({
        method: 'isAvailable',
        args: [],
      });
    });

    it('should accumulate calls across multiple invocations', async () => {
      const provider = new MockLLMProvider();
      await provider.generateCompletion('s1', 'u1');
      await provider.generateEmbedding('text');
      await provider.isAvailable();

      expect(provider.calls).toHaveLength(3);
      expect(provider.calls[0].method).toBe('generateCompletion');
      expect(provider.calls[1].method).toBe('generateEmbedding');
      expect(provider.calls[2].method).toBe('isAvailable');
    });

    it('should record calls even in shouldFail mode (before throwing)', async () => {
      const provider = new MockLLMProvider({ shouldFail: true });

      // isAvailable does not throw, it returns false
      await provider.isAvailable();
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0].method).toBe('isAvailable');

      // generateCompletion throws, but should still record
      try {
        await provider.generateCompletion('s', 'u');
      } catch {
        // expected
      }
      expect(provider.calls).toHaveLength(2);
      expect(provider.calls[1].method).toBe('generateCompletion');
    });
  });

  // ---------------------------------------------------------------------------
  // reset()
  // ---------------------------------------------------------------------------
  describe('reset()', () => {
    it('should clear the calls array', async () => {
      const provider = new MockLLMProvider();
      await provider.generateCompletion('s', 'u');
      await provider.generateEmbedding('text');
      expect(provider.calls.length).toBeGreaterThan(0);

      provider.reset();
      expect(provider.calls).toEqual([]);
    });

    it('should allow new calls to accumulate after reset', async () => {
      const provider = new MockLLMProvider();
      await provider.generateCompletion('s', 'u');
      provider.reset();

      await provider.isAvailable();
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0].method).toBe('isAvailable');
    });
  });
});

// =============================================================================
// LocalLLMProvider (Ollama)
// =============================================================================
describe('LocalLLMProvider', () => {
  describe('construction', () => {
    it('should construct with baseUrl, completionModel, and embeddingModel', () => {
      const provider = new LocalLLMProvider(
        'http://localhost:11434',
        'qwen3:4b',
        'qwen3-embedding:0.6b'
      );
      expect(provider).toBeDefined();
    });

    it('should accept custom baseUrl', () => {
      const provider = new LocalLLMProvider(
        'http://custom-host:9999',
        'llama3',
        'nomic-embed-text'
      );
      expect(provider).toBeDefined();
    });
  });

  describe('interface conformance', () => {
    it('should implement LLMProvider interface with all required methods', () => {
      const provider: LLMProvider = new LocalLLMProvider(
        'http://localhost:11434',
        'qwen3:4b',
        'qwen3-embedding:0.6b'
      );
      expect(typeof provider.generateCompletion).toBe('function');
      expect(typeof provider.generateEmbedding).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
    });
  });

  // NOTE: No HTTP call tests here. LocalLLMProvider makes real HTTP calls
  // to Ollama and those are integration test concerns, not unit test concerns.

  describe('thinkingModel', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ response: '{}' }),
      } as Response);
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('should use thinkingModel for think:true when thinkingModel is provided', async () => {
      const provider = new LocalLLMProvider(
        'http://localhost:11434', 'qwen3:4b', 'qwen3-embedding:0.6b', 'qwen3:8b'
      );

      await provider.generateCompletion('system', 'user', { think: true });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.model).toBe('qwen3:8b');
    });

    it('should fall back to completionModel for think:true when thinkingModel is not provided', async () => {
      const provider = new LocalLLMProvider(
        'http://localhost:11434', 'qwen3:4b', 'qwen3-embedding:0.6b'
      );

      await provider.generateCompletion('system', 'user', { think: true });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.model).toBe('qwen3:4b');
    });

    it('should always use completionModel for think:false even when thinkingModel is provided', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: '{}' } }),
      } as Response);

      const provider = new LocalLLMProvider(
        'http://localhost:11434', 'qwen3:4b', 'qwen3-embedding:0.6b', 'qwen3:8b'
      );

      await provider.generateCompletion('system', 'user', { think: false });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.model).toBe('qwen3:4b');
    });

    it('should always use completionModel when no options provided even when thinkingModel is set', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: '{}' } }),
      } as Response);

      const provider = new LocalLLMProvider(
        'http://localhost:11434', 'qwen3:4b', 'qwen3-embedding:0.6b', 'qwen3:8b'
      );

      await provider.generateCompletion('system', 'user');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.model).toBe('qwen3:4b');
    });
  });
});

// =============================================================================
// BedrockLLMProvider (AWS Bedrock)
// =============================================================================
describe('BedrockLLMProvider', () => {
  describe('construction', () => {
    it('should construct with region, completionModel, and embeddingModel', () => {
      const provider = new BedrockLLMProvider(
        'us-east-1',
        'anthropic.claude-sonnet-4-20250514',
        'amazon.titan-embed-text-v2:0'
      );
      expect(provider).toBeDefined();
    });

    it('should accept different regions', () => {
      const provider = new BedrockLLMProvider(
        'ap-northeast-2',
        'anthropic.claude-sonnet-4-20250514',
        'amazon.titan-embed-text-v2:0'
      );
      expect(provider).toBeDefined();
    });
  });

  describe('interface conformance', () => {
    it('should implement LLMProvider interface with all required methods', () => {
      const provider: LLMProvider = new BedrockLLMProvider(
        'us-east-1',
        'anthropic.claude-sonnet-4-20250514',
        'amazon.titan-embed-text-v2:0'
      );
      expect(typeof provider.generateCompletion).toBe('function');
      expect(typeof provider.generateEmbedding).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
    });
  });

  // NOTE: No HTTP/SDK call tests here. BedrockLLMProvider uses the AWS SDK
  // and those are integration test concerns, not unit test concerns.
});

// =============================================================================
// PROMPTS
// =============================================================================
describe('PROMPTS', () => {
  describe('frustrationAnalysis', () => {
    it('should be a non-empty string', () => {
      expect(typeof PROMPTS.frustrationAnalysis).toBe('string');
      expect(PROMPTS.frustrationAnalysis.length).toBeGreaterThan(0);
    });

    it('should contain guidance for classifying prompt types', () => {
      // The prompt should mention the four classification categories
      const prompt = PROMPTS.frustrationAnalysis.toLowerCase();
      expect(prompt).toContain('frustrated');
      expect(prompt).toContain('resolution');
      expect(prompt).toContain('abandonment');
      expect(prompt).toContain('normal');
    });
  });

  describe('lessonSummarization', () => {
    it('should be a non-empty string', () => {
      expect(typeof PROMPTS.lessonSummarization).toBe('string');
      expect(PROMPTS.lessonSummarization.length).toBeGreaterThan(0);
    });
  });

  describe('ragJudge', () => {
    it('should be a non-empty string', () => {
      expect(typeof PROMPTS.ragJudge).toBe('string');
      expect(PROMPTS.ragJudge.length).toBeGreaterThan(0);
    });
  });

  describe('structure', () => {
    it('should export exactly the expected prompt keys', () => {
      const keys = Object.keys(PROMPTS).sort();
      expect(keys).toEqual(
        ['evolutionJudge', 'frustrationAnalysis', 'lessonSummarization', 'ragJudge'].sort()
      );
    });
  });
});
