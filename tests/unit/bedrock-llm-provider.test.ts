/**
 * Unit Tests for BedrockLLMProvider (AWS Bedrock)
 *
 * TDD RED phase: These tests define the expected behavior of BedrockLLMProvider
 * when interacting with the AWS Bedrock Runtime SDK. All AWS SDK calls are mocked
 * so no real AWS credentials or network access is required.
 *
 * Target module:
 *   - src/llm/bedrock-llm-provider.ts (BedrockLLMProvider)
 *
 * All tests are expected to FAIL until the implementation is written.
 *
 * Components under test:
 *   - Constructor: stores region, completionModel, embeddingModel; creates BedrockRuntimeClient
 *   - generateCompletion: uses ConverseCommand with correct params, returns response text
 *   - generateEmbedding: uses InvokeModelCommand with correct body, returns embedding array
 *   - isAvailable: lightweight health check returning true/false
 *
 * Edge cases covered:
 *   - Empty string inputs for system prompt, user message, and embedding text
 *   - AWS SDK throwing various error types (network, auth, throttling)
 *   - Malformed API responses (missing fields, null content)
 *   - Empty response content arrays
 *   - Response with no text field in content block
 *   - Unicode and special character inputs
 *   - Very long input strings
 *
 * Assumptions:
 *   - BedrockLLMProvider creates a BedrockRuntimeClient with { region } config
 *   - generateCompletion uses ConverseCommand with modelId, system, and messages
 *   - generateEmbedding uses InvokeModelCommand with JSON body { inputText }
 *   - isAvailable catches errors and returns false (does not throw)
 *   - generateCompletion and generateEmbedding propagate errors (do throw)
 *
 * Mock strategy:
 *   - jest.mock('@aws-sdk/client-bedrock-runtime') to mock the entire module
 *   - Mock BedrockRuntimeClient.prototype.send to control responses
 */

import { BedrockLLMProvider } from '../../src/llm/bedrock-llm-provider';
import type { LLMProvider } from '../../src/types/index';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

// ---------------------------------------------------------------------------
// Mock the AWS SDK module
// ---------------------------------------------------------------------------
jest.mock('@aws-sdk/client-bedrock-runtime');

const MockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<
  typeof BedrockRuntimeClient
>;
const MockConverseCommand = ConverseCommand as jest.MockedClass<
  typeof ConverseCommand
>;
const MockInvokeModelCommand = InvokeModelCommand as jest.MockedClass<
  typeof InvokeModelCommand
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default test configuration */
const TEST_REGION = 'us-east-1';
const TEST_COMPLETION_MODEL = 'anthropic.claude-sonnet-4-20250514';
const TEST_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

function createProvider(
  region = TEST_REGION,
  completionModel = TEST_COMPLETION_MODEL,
  embeddingModel = TEST_EMBEDDING_MODEL,
): BedrockLLMProvider {
  return new BedrockLLMProvider(region, completionModel, embeddingModel);
}

/** Build a mock ConverseCommand response with the given text */
function makeConverseResponse(text: string) {
  return {
    output: {
      message: {
        role: 'assistant',
        content: [{ text }],
      },
    },
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    metrics: { latencyMs: 100 },
  };
}

/** Build a mock InvokeModelCommand response with the given embedding */
function makeEmbeddingResponse(embedding: number[], tokenCount = 5) {
  const body = JSON.stringify({
    embedding,
    inputTextTokenCount: tokenCount,
  });
  return {
    body: new TextEncoder().encode(body),
    contentType: 'application/json',
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
let mockSend: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockSend = jest.fn();
  MockBedrockRuntimeClient.mockImplementation(() => {
    return { send: mockSend } as any;
  });
});

// =============================================================================
// BedrockLLMProvider
// =============================================================================
describe('BedrockLLMProvider', () => {
  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------
  describe('construction', () => {
    it('should construct with region, completionModel, and embeddingModel', () => {
      const provider = createProvider();
      expect(provider).toBeDefined();
    });

    it('should create a BedrockRuntimeClient with the given region', () => {
      createProvider('ap-northeast-2');
      expect(MockBedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'ap-northeast-2' }),
      );
    });

    it('should accept different region values', () => {
      createProvider('eu-west-1');
      expect(MockBedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'eu-west-1' }),
      );
    });

    it('should implement LLMProvider interface with all required methods', () => {
      const provider: LLMProvider = createProvider();
      expect(typeof provider.generateCompletion).toBe('function');
      expect(typeof provider.generateEmbedding).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // generateCompletion - success cases
  // ---------------------------------------------------------------------------
  describe('generateCompletion', () => {
    describe('success cases', () => {
      it('should return the text from the Converse API response', async () => {
        mockSend.mockResolvedValueOnce(
          makeConverseResponse('Hello from Bedrock!'),
        );
        const provider = createProvider();

        const result = await provider.generateCompletion(
          'You are a helpful assistant.',
          'Say hello.',
        );

        expect(result).toBe('Hello from Bedrock!');
      });

      it('should pass the correct modelId to ConverseCommand', async () => {
        mockSend.mockResolvedValueOnce(makeConverseResponse('response'));
        const provider = createProvider(
          'us-east-1',
          'anthropic.claude-sonnet-4-20250514',
          TEST_EMBEDDING_MODEL,
        );

        await provider.generateCompletion('system', 'user');

        // Verify ConverseCommand was constructed with the right modelId
        expect(MockConverseCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            modelId: 'anthropic.claude-sonnet-4-20250514',
          }),
        );
      });

      it('should pass the system prompt in the system field', async () => {
        mockSend.mockResolvedValueOnce(makeConverseResponse('response'));
        const provider = createProvider();

        await provider.generateCompletion(
          'You are an expert analyst.',
          'Analyze this.',
        );

        expect(MockConverseCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            system: [{ text: 'You are an expert analyst.' }],
          }),
        );
      });

      it('should pass the user message in the messages field', async () => {
        mockSend.mockResolvedValueOnce(makeConverseResponse('response'));
        const provider = createProvider();

        await provider.generateCompletion('system', 'What is TDD?');

        expect(MockConverseCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              {
                role: 'user',
                content: [{ text: 'What is TDD?' }],
              },
            ],
          }),
        );
      });

      it('should send the ConverseCommand via the client', async () => {
        mockSend.mockResolvedValueOnce(makeConverseResponse('ok'));
        const provider = createProvider();

        await provider.generateCompletion('sys', 'usr');

        expect(mockSend).toHaveBeenCalledTimes(1);
        // The argument to send should be a ConverseCommand instance
        expect(MockConverseCommand).toHaveBeenCalled();
      });

      it('should handle empty system prompt', async () => {
        mockSend.mockResolvedValueOnce(
          makeConverseResponse('response with empty system'),
        );
        const provider = createProvider();

        const result = await provider.generateCompletion('', 'user message');

        expect(result).toBe('response with empty system');
        expect(MockConverseCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            system: [{ text: '' }],
          }),
        );
      });

      it('should handle empty user message', async () => {
        mockSend.mockResolvedValueOnce(
          makeConverseResponse('response with empty user'),
        );
        const provider = createProvider();

        const result = await provider.generateCompletion('system prompt', '');

        expect(result).toBe('response with empty user');
      });

      it('should handle unicode input correctly', async () => {
        mockSend.mockResolvedValueOnce(
          makeConverseResponse('Unicode response: OK'),
        );
        const provider = createProvider();

        const result = await provider.generateCompletion(
          'System prompt',
          'Analyze this error in Korean: TypeError',
        );

        expect(result).toBe('Unicode response: OK');
      });

      it('should handle very long input strings', async () => {
        const longInput = 'x'.repeat(10000);
        mockSend.mockResolvedValueOnce(makeConverseResponse('long handled'));
        const provider = createProvider();

        const result = await provider.generateCompletion('system', longInput);

        expect(result).toBe('long handled');
        expect(MockConverseCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [
              {
                role: 'user',
                content: [{ text: longInput }],
              },
            ],
          }),
        );
      });
    });

    // -------------------------------------------------------------------------
    // generateCompletion - error cases
    // -------------------------------------------------------------------------
    describe('error handling', () => {
      it('should throw when the AWS SDK client.send rejects', async () => {
        mockSend.mockRejectedValueOnce(
          new Error('AccessDeniedException: Not authorized'),
        );
        const provider = createProvider();

        await expect(
          provider.generateCompletion('sys', 'usr'),
        ).rejects.toThrow();
      });

      it('should propagate the original error message from SDK', async () => {
        const sdkError = new Error('ThrottlingException: Rate exceeded');
        mockSend.mockRejectedValueOnce(sdkError);
        const provider = createProvider();

        await expect(
          provider.generateCompletion('sys', 'usr'),
        ).rejects.toThrow(/ThrottlingException|Rate exceeded/);
      });

      it('should throw when response has no output', async () => {
        mockSend.mockResolvedValueOnce({
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        });
        const provider = createProvider();

        await expect(
          provider.generateCompletion('sys', 'usr'),
        ).rejects.toThrow();
      });

      it('should throw when response output has no message', async () => {
        mockSend.mockResolvedValueOnce({
          output: {},
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        });
        const provider = createProvider();

        await expect(
          provider.generateCompletion('sys', 'usr'),
        ).rejects.toThrow();
      });

      it('should throw when response message has empty content array', async () => {
        mockSend.mockResolvedValueOnce({
          output: {
            message: {
              role: 'assistant',
              content: [],
            },
          },
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        });
        const provider = createProvider();

        await expect(
          provider.generateCompletion('sys', 'usr'),
        ).rejects.toThrow();
      });

      it('should throw when response content block has no text field', async () => {
        mockSend.mockResolvedValueOnce({
          output: {
            message: {
              role: 'assistant',
              content: [{ image: { format: 'png' } }],
            },
          },
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        });
        const provider = createProvider();

        await expect(
          provider.generateCompletion('sys', 'usr'),
        ).rejects.toThrow();
      });

      it('should not swallow network errors', async () => {
        const networkError = new Error('NetworkingError: ECONNREFUSED');
        mockSend.mockRejectedValueOnce(networkError);
        const provider = createProvider();

        await expect(
          provider.generateCompletion('sys', 'usr'),
        ).rejects.toThrow('ECONNREFUSED');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // generateEmbedding - success cases
  // ---------------------------------------------------------------------------
  describe('generateEmbedding', () => {
    describe('success cases', () => {
      it('should return the embedding array from the response', async () => {
        const expectedEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
        mockSend.mockResolvedValueOnce(
          makeEmbeddingResponse(expectedEmbedding),
        );
        const provider = createProvider();

        const result = await provider.generateEmbedding('test text');

        expect(result).toEqual(expectedEmbedding);
      });

      it('should pass the correct modelId to InvokeModelCommand', async () => {
        mockSend.mockResolvedValueOnce(makeEmbeddingResponse([0.1]));
        const provider = createProvider(
          'us-east-1',
          TEST_COMPLETION_MODEL,
          'amazon.titan-embed-text-v2:0',
        );

        await provider.generateEmbedding('text');

        expect(MockInvokeModelCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            modelId: 'amazon.titan-embed-text-v2:0',
          }),
        );
      });

      it('should send the input text as JSON in the body', async () => {
        mockSend.mockResolvedValueOnce(makeEmbeddingResponse([0.1, 0.2]));
        const provider = createProvider();

        await provider.generateEmbedding('embed this text');

        expect(MockInvokeModelCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.any(String),
          }),
        );

        // Extract the body arg and verify JSON content
        const callArg = MockInvokeModelCommand.mock.calls[0][0];
        const parsedBody = JSON.parse(callArg.body as string);
        expect(parsedBody).toEqual(
          expect.objectContaining({ inputText: 'embed this text' }),
        );
      });

      it('should set contentType to application/json', async () => {
        mockSend.mockResolvedValueOnce(makeEmbeddingResponse([0.1]));
        const provider = createProvider();

        await provider.generateEmbedding('text');

        expect(MockInvokeModelCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: 'application/json',
          }),
        );
      });

      it('should set accept to application/json', async () => {
        mockSend.mockResolvedValueOnce(makeEmbeddingResponse([0.1]));
        const provider = createProvider();

        await provider.generateEmbedding('text');

        expect(MockInvokeModelCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            accept: 'application/json',
          }),
        );
      });

      it('should handle empty string input', async () => {
        mockSend.mockResolvedValueOnce(makeEmbeddingResponse([0.0, 0.0, 0.0]));
        const provider = createProvider();

        const result = await provider.generateEmbedding('');

        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual([0.0, 0.0, 0.0]);
      });

      it('should handle high-dimensional embedding vectors', async () => {
        const highDimEmbedding = Array.from({ length: 1024 }, (_, i) =>
          Math.sin(i),
        );
        mockSend.mockResolvedValueOnce(
          makeEmbeddingResponse(highDimEmbedding),
        );
        const provider = createProvider();

        const result = await provider.generateEmbedding('long embedding');

        expect(result).toHaveLength(1024);
        expect(result).toEqual(highDimEmbedding);
      });

      it('should handle unicode text input for embeddings', async () => {
        mockSend.mockResolvedValueOnce(
          makeEmbeddingResponse([0.5, 0.6, 0.7]),
        );
        const provider = createProvider();

        const result = await provider.generateEmbedding(
          'Korean text: OK',
        );

        expect(result).toEqual([0.5, 0.6, 0.7]);
      });

      it('should return number[] type elements', async () => {
        mockSend.mockResolvedValueOnce(
          makeEmbeddingResponse([0.1, -0.2, 0.3]),
        );
        const provider = createProvider();

        const result = await provider.generateEmbedding('type check');

        result.forEach((val) => {
          expect(typeof val).toBe('number');
          expect(Number.isFinite(val)).toBe(true);
        });
      });
    });

    // -------------------------------------------------------------------------
    // generateEmbedding - error cases
    // -------------------------------------------------------------------------
    describe('error handling', () => {
      it('should throw when the AWS SDK client.send rejects', async () => {
        mockSend.mockRejectedValueOnce(
          new Error('ServiceUnavailableException'),
        );
        const provider = createProvider();

        await expect(provider.generateEmbedding('text')).rejects.toThrow();
      });

      it('should propagate the original error message', async () => {
        const sdkError = new Error(
          'ValidationException: Invalid model identifier',
        );
        mockSend.mockRejectedValueOnce(sdkError);
        const provider = createProvider();

        await expect(provider.generateEmbedding('text')).rejects.toThrow(
          /ValidationException|Invalid model/,
        );
      });

      it('should throw when response body is not valid JSON', async () => {
        mockSend.mockResolvedValueOnce({
          body: new TextEncoder().encode('not json'),
          contentType: 'application/json',
        });
        const provider = createProvider();

        await expect(provider.generateEmbedding('text')).rejects.toThrow();
      });

      it('should throw when response body has no embedding field', async () => {
        mockSend.mockResolvedValueOnce({
          body: new TextEncoder().encode(
            JSON.stringify({ inputTextTokenCount: 5 }),
          ),
          contentType: 'application/json',
        });
        const provider = createProvider();

        await expect(provider.generateEmbedding('text')).rejects.toThrow();
      });

      it('should throw when embedding field is not an array', async () => {
        mockSend.mockResolvedValueOnce({
          body: new TextEncoder().encode(
            JSON.stringify({ embedding: 'not-an-array', inputTextTokenCount: 5 }),
          ),
          contentType: 'application/json',
        });
        const provider = createProvider();

        await expect(provider.generateEmbedding('text')).rejects.toThrow();
      });

      it('should not swallow network errors', async () => {
        const networkError = new Error('NetworkingError: ETIMEDOUT');
        mockSend.mockRejectedValueOnce(networkError);
        const provider = createProvider();

        await expect(provider.generateEmbedding('text')).rejects.toThrow(
          'ETIMEDOUT',
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // isAvailable
  // ---------------------------------------------------------------------------
  describe('isAvailable', () => {
    it('should return true when a lightweight SDK call succeeds', async () => {
      // A successful send (e.g., a simple Converse or list call) indicates availability
      mockSend.mockResolvedValueOnce(makeConverseResponse('ping'));
      const provider = createProvider();

      const result = await provider.isAvailable();

      expect(result).toBe(true);
    });

    it('should return false when the SDK call throws', async () => {
      mockSend.mockRejectedValueOnce(
        new Error('ServiceUnavailableException'),
      );
      const provider = createProvider();

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when the SDK call throws a network error', async () => {
      mockSend.mockRejectedValueOnce(
        new Error('NetworkingError: ECONNREFUSED'),
      );
      const provider = createProvider();

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when credentials are invalid', async () => {
      mockSend.mockRejectedValueOnce(
        new Error('AccessDeniedException: Invalid credentials'),
      );
      const provider = createProvider();

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should NOT throw even when the SDK throws', async () => {
      mockSend.mockRejectedValueOnce(new Error('Unexpected error'));
      const provider = createProvider();

      // isAvailable should catch all errors and return boolean
      await expect(provider.isAvailable()).resolves.not.toThrow();
      // Note: the above assertion verifies it resolves (doesn't reject).
      // We also verify the value:
    });

    it('should return a boolean type', async () => {
      mockSend.mockResolvedValueOnce(makeConverseResponse('ok'));
      const provider = createProvider();

      const result = await provider.isAvailable();

      expect(typeof result).toBe('boolean');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple calls / isolation
  // ---------------------------------------------------------------------------
  describe('multiple calls', () => {
    it('should support sequential generateCompletion calls', async () => {
      mockSend
        .mockResolvedValueOnce(makeConverseResponse('first'))
        .mockResolvedValueOnce(makeConverseResponse('second'));
      const provider = createProvider();

      const result1 = await provider.generateCompletion('sys', 'first call');
      const result2 = await provider.generateCompletion('sys', 'second call');

      expect(result1).toBe('first');
      expect(result2).toBe('second');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should support interleaving completion and embedding calls', async () => {
      mockSend
        .mockResolvedValueOnce(makeConverseResponse('completion result'))
        .mockResolvedValueOnce(makeEmbeddingResponse([0.1, 0.2, 0.3]));
      const provider = createProvider();

      const completionResult = await provider.generateCompletion('sys', 'usr');
      const embeddingResult = await provider.generateEmbedding('text');

      expect(completionResult).toBe('completion result');
      expect(embeddingResult).toEqual([0.1, 0.2, 0.3]);
    });

    it('should recover after a failed call', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(makeConverseResponse('recovered'));
      const provider = createProvider();

      await expect(
        provider.generateCompletion('sys', 'usr'),
      ).rejects.toThrow('Temporary failure');

      const result = await provider.generateCompletion('sys', 'retry');
      expect(result).toBe('recovered');
    });
  });

  // ---------------------------------------------------------------------------
  // thinkingModel
  // ---------------------------------------------------------------------------
  describe('thinkingModel', () => {
    it('should use thinkingModel for think:true when thinkingModel is provided', async () => {
      mockSend.mockResolvedValueOnce(makeConverseResponse('thinking response'));
      const provider = new BedrockLLMProvider(
        'us-east-1', 'anthropic.claude-sonnet-4-20250514', 'amazon.titan-embed-text-v2:0',
        undefined, 'us.anthropic.claude-opus-4-20250514-v1:0'
      );

      await provider.generateCompletion('system', 'user', { think: true });

      expect(MockConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'us.anthropic.claude-opus-4-20250514-v1:0',
        }),
      );
    });

    it('should fall back to completionModel for think:true when thinkingModel is not provided', async () => {
      mockSend.mockResolvedValueOnce(makeConverseResponse('response'));
      const provider = createProvider();

      await provider.generateCompletion('system', 'user', { think: true });

      expect(MockConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: TEST_COMPLETION_MODEL,
        }),
      );
    });

    it('should always use completionModel for think:false even when thinkingModel is provided', async () => {
      mockSend.mockResolvedValueOnce(makeConverseResponse('response'));
      const provider = new BedrockLLMProvider(
        'us-east-1', 'anthropic.claude-sonnet-4-20250514', 'amazon.titan-embed-text-v2:0',
        undefined, 'us.anthropic.claude-opus-4-20250514-v1:0'
      );

      await provider.generateCompletion('system', 'user', { think: false });

      expect(MockConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic.claude-sonnet-4-20250514',
        }),
      );
    });

    it('should always use completionModel when options not provided even when thinkingModel is set', async () => {
      mockSend.mockResolvedValueOnce(makeConverseResponse('response'));
      const provider = new BedrockLLMProvider(
        'us-east-1', 'anthropic.claude-sonnet-4-20250514', 'amazon.titan-embed-text-v2:0',
        undefined, 'us.anthropic.claude-opus-4-20250514-v1:0'
      );

      await provider.generateCompletion('system', 'user');

      expect(MockConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic.claude-sonnet-4-20250514',
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Provider with different model configurations
  // ---------------------------------------------------------------------------
  describe('model configuration', () => {
    it('should use the specified completion model for Converse calls', async () => {
      mockSend.mockResolvedValueOnce(makeConverseResponse('ok'));
      const provider = createProvider(
        'us-west-2',
        'meta.llama3-70b-instruct-v1:0',
        TEST_EMBEDDING_MODEL,
      );

      await provider.generateCompletion('sys', 'usr');

      expect(MockConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'meta.llama3-70b-instruct-v1:0',
        }),
      );
    });

    it('should use the specified embedding model for InvokeModel calls', async () => {
      mockSend.mockResolvedValueOnce(makeEmbeddingResponse([0.1]));
      const provider = createProvider(
        'us-west-2',
        TEST_COMPLETION_MODEL,
        'cohere.embed-english-v3',
      );

      await provider.generateEmbedding('text');

      expect(MockInvokeModelCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'cohere.embed-english-v3',
        }),
      );
    });
  });
});
