import type { LLMProvider, CompletionOptions } from '../types/index';

// Embedding dimension for mock vectors
const EMBEDDING_DIM = 128;

interface MockLLMProviderOptions {
  shouldFail?: boolean;
}

/**
 * MockLLMProvider: deterministic LLM provider for testing.
 * Records all calls for spy-style assertions.
 */
export class MockLLMProvider implements LLMProvider {
  public calls: Array<{ method: string; args: unknown[] }> = [];
  public shouldFail: boolean;

  getModelName(): string {
    return 'mock';
  }

  constructor(options?: MockLLMProviderOptions) {
    this.shouldFail = options?.shouldFail ?? false;
  }

  async generateCompletion(system: string, user: string, _options?: CompletionOptions): Promise<string> {
    this.calls.push({ method: 'generateCompletion', args: [system, user] });
    if (this.shouldFail) {
      throw new Error('MockLLMProvider: forced failure');
    }
    return `mock-completion: ${user.substring(0, 50)}`;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    this.calls.push({ method: 'generateEmbedding', args: [text] });
    if (this.shouldFail) {
      throw new Error('MockLLMProvider: forced failure');
    }
    // Deterministic hash-based embedding: same text always produces same vector
    return hashToVector(text);
  }

  async isAvailable(): Promise<boolean> {
    this.calls.push({ method: 'isAvailable', args: [] });
    return !this.shouldFail;
  }

  reset(): void {
    this.calls = [];
  }
}

/**
 * Simple deterministic hash function that maps a string to a fixed-length
 * number array. Same input always produces the same output.
 */
function hashToVector(text: string): number[] {
  const vector: number[] = new Array(EMBEDDING_DIM);
  // Seed from text using a simple hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // force 32-bit integer
  }
  // Generate deterministic vector values from the hash seed
  let state = hash;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    // LCG-style pseudo-random from seed
    state = (state * 1664525 + 1013904223) | 0;
    // Normalize to [-1, 1] range
    vector[i] = (state & 0xffff) / 0xffff * 2 - 1;
  }
  return vector;
}
