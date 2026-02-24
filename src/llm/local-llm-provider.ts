import { z } from 'zod';
import type { LLMProvider, CompletionOptions } from '../types/index';

const REQUEST_TIMEOUT_MS = 30_000;
const THINK_REQUEST_TIMEOUT_MS = 120_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

const ChatResponseSchema = z.object({
  message: z.object({
    content: z.string(),
  }),
});

const GenerateResponseSchema = z.object({
  response: z.string(),
});

const EmbeddingResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())).min(1),
});

/**
 * LocalLLMProvider: Ollama-backed LLM provider.
 * Makes HTTP calls to a locally running Ollama instance.
 */
export class LocalLLMProvider implements LLMProvider {
  private baseUrl: string;
  private completionModel: string;
  private embeddingModel: string;
  private thinkingModel?: string;

  getModelName(): string {
    return this.completionModel;
  }

  constructor(baseUrl: string, completionModel: string, embeddingModel: string, thinkingModel?: string) {
    this.baseUrl = baseUrl;
    this.completionModel = completionModel;
    this.embeddingModel = embeddingModel;
    this.thinkingModel = thinkingModel;
  }

  async generateCompletion(system: string, user: string, options?: CompletionOptions): Promise<string> {
    const useThink = options?.think ?? false;

    if (useThink) {
      // /api/generate: qwen3 thinks automatically, format:"json" constrains final output
      // Use thinkingModel (larger/more capable) if provided, otherwise fall back to completionModel
      const json = await this.postJSON(`${this.baseUrl}/api/generate`, {
        model: this.thinkingModel ?? this.completionModel,
        system,
        prompt: user,
        stream: false,
        format: 'json',
      }, THINK_REQUEST_TIMEOUT_MS);
      const data = GenerateResponseSchema.parse(json);
      return data.response;
    }

    // /api/chat: fast path with think:false
    const json = await this.postJSON(`${this.baseUrl}/api/chat`, {
      model: this.completionModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      think: false,
      format: 'json',
    });
    const data = ChatResponseSchema.parse(json);
    return data.message.content;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const json = await this.postJSON(`${this.baseUrl}/api/embed`, {
      model: this.embeddingModel,
      input: text,
    });
    const data = EmbeddingResponseSchema.parse(json);
    return data.embeddings[0];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async postJSON(url: string, body: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
}
