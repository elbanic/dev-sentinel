import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import type { LLMProvider, CompletionOptions } from '../types/index';

const REQUEST_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * BedrockLLMProvider: AWS Bedrock-backed LLM provider.
 * Uses ConverseCommand for text completion (Claude) and
 * InvokeModelCommand for embeddings (Titan Embedding V2).
 */
export class BedrockLLMProvider implements LLMProvider {
  private region: string;
  private completionModel: string;
  private embeddingModel: string;
  private client: BedrockRuntimeClient;

  getModelName(): string {
    return this.completionModel;
  }

  constructor(region: string, completionModel: string, embeddingModel: string, profile?: string) {
    this.region = region;
    this.completionModel = completionModel;
    this.embeddingModel = embeddingModel;
    this.client = new BedrockRuntimeClient({
      region,
      ...(profile ? { credentials: fromIni({ profile }) } : {}),
    });
  }

  async generateCompletion(system: string, user: string, _options?: CompletionOptions): Promise<string> {
    const command = new ConverseCommand({
      modelId: this.completionModel,
      system: [{ text: system }],
      messages: [
        {
          role: 'user',
          content: [{ text: user }],
        },
      ],
      inferenceConfig: { maxTokens: 4096, temperature: 0.3 },
    });

    const response = await this.client.send(command, {
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = response.output?.message?.content?.[0]?.text;
    if (text === undefined || text === null) {
      throw new Error('Bedrock: no text content in Converse response');
    }
    return text;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: this.embeddingModel,
      body: JSON.stringify({ inputText: text }),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await this.client.send(command, {
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const responseBody = JSON.parse(
      new TextDecoder().decode(response.body),
    );

    const embedding = responseBody.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error('Bedrock: invalid embedding response — expected array');
    }
    return embedding;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const command = new ConverseCommand({
        modelId: this.completionModel,
        messages: [
          {
            role: 'user',
            content: [{ text: 'ping' }],
          },
        ],
        inferenceConfig: { maxTokens: 1 },
      });
      await this.client.send(command, {
        abortSignal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      return true;
    } catch {
      return false;
    }
  }
}
