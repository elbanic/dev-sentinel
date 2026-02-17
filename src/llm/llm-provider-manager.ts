import type { LLMProvider, SentinelSettings } from '../types/index';
import { LocalLLMProvider } from './local-llm-provider';
import { BedrockLLMProvider } from './bedrock-llm-provider';

/**
 * LLMProviderManager: selects and caches the appropriate LLM provider
 * based on SentinelSettings. Supports a test override for mock injection.
 */
export class LLMProviderManager {
  private settings: SentinelSettings;
  private providerOverride?: LLMProvider;
  private cachedProvider?: LLMProvider;

  constructor(settings: SentinelSettings, providerOverride?: LLMProvider) {
    this.settings = settings;
    this.providerOverride = providerOverride;
  }

  getProvider(): LLMProvider {
    // Return cached instance if already created
    if (this.cachedProvider) {
      return this.cachedProvider;
    }

    // Override takes full precedence
    if (this.providerOverride) {
      this.cachedProvider = this.providerOverride;
      return this.cachedProvider;
    }

    // Create provider based on settings
    if (this.settings.llm.provider === 'bedrock' && this.settings.llm.bedrock) {
      const { region, completionModel, embeddingModel, profile } = this.settings.llm.bedrock;
      this.cachedProvider = new BedrockLLMProvider(region, completionModel, embeddingModel, profile);
    } else {
      const { baseUrl, completionModel, embeddingModel } = this.settings.llm.ollama;
      this.cachedProvider = new LocalLLMProvider(baseUrl, completionModel, embeddingModel);
    }

    return this.cachedProvider;
  }

  async isAvailable(): Promise<boolean> {
    return this.getProvider().isAvailable();
  }
}
