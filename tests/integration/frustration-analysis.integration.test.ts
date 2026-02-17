/**
 * Integration Tests for Frustration Analysis Prompt Quality
 *
 * These tests call a REAL LLM to validate that the frustration analysis prompt
 * produces correct classifications. They require a configured LLM provider
 * (Ollama or Bedrock) and are NOT part of the regular build test suite.
 *
 * Run manually:
 *   npm run test:llm
 *
 * Skip conditions:
 *   - Automatically skipped if no LLM provider is available
 */

import { analyzeFrustration } from '../../src/analysis/frustration-analyzer';
import { LLMProviderManager } from '../../src/llm/llm-provider-manager';
import { loadSettings } from '../../src/config/settings-loader';
import type { LLMProvider, FrustrationAnalysis } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Setup: resolve real LLM provider from user settings
// ---------------------------------------------------------------------------

let llmProvider: LLMProvider;
let providerAvailable = false;

beforeAll(async () => {
  const settings = loadSettings();
  const manager = new LLMProviderManager(settings);
  llmProvider = manager.getProvider();
  try {
    providerAvailable = await llmProvider.isAvailable();
  } catch {
    providerAvailable = false;
  }
}, 15_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function analyze(prompt: string): Promise<FrustrationAnalysis> {
  return analyzeFrustration(prompt, llmProvider);
}

function skipIfUnavailable() {
  if (!providerAvailable) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test cases: "normal" prompts (should NOT trigger frustrated)
// ---------------------------------------------------------------------------

describe('Frustration Analysis — "normal" prompts', () => {
  it('routine: "빌드해봐"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('빌드해봐');
    expect(result.type).toBe('normal');
  }, 30_000);

  it('routine: "테스트 돌려줘"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('테스트 돌려줘');
    expect(result.type).toBe('normal');
  }, 30_000);

  it('routine: "git status 확인해봐"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('git status 확인해봐');
    expect(result.type).toBe('normal');
  }, 30_000);

  it('first error: "이 에러 뭐야? TypeError: Cannot read property of undefined"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('이 에러 뭐야? TypeError: Cannot read property of undefined');
    expect(result.type).toBe('normal');
  }, 30_000);

  it('first error: pasting error output without emotion', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze(`ENOENT: no such file or directory, open '/tmp/config.json'`);
    expect(result.type).toBe('normal');
  }, 30_000);

  it('question: "이거 다른 방법으로 해볼까?"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('이거 다른 방법으로 해볼까?');
    expect(result.type).toBe('normal');
  }, 30_000);

  it('question: "how do I configure ESLint for TypeScript?"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('how do I configure ESLint for TypeScript?');
    expect(result.type).toBe('normal');
  }, 30_000);

  it('direction change: "bedrock llm 사용하려면 설정에서 뭐 해야 하는거야?"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('bedrock llm 사용하려면 설정에서 뭐 해야 하는거야?');
    expect(result.type).toBe('normal');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Test cases: "frustrated" prompts (should trigger frustrated)
// ---------------------------------------------------------------------------

describe('Frustration Analysis — "frustrated" prompts', () => {
  it('explicit loop: "아 또 같은 에러야. 세 번째 시도인데 계속 실패해"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('아 또 같은 에러야. 세 번째 시도인데 계속 실패해');
    expect(result.type).toBe('frustrated');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  }, 30_000);

  it('explicit loop: "I tried fixing the import, changing the config, and updating the package, nothing works"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('I tried fixing the import, changing the config, and updating the package, nothing works');
    expect(result.type).toBe('frustrated');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  }, 30_000);

  it('still broken: "여전히 안 돼. 아까랑 똑같은 에러"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('여전히 안 돼. 아까랑 똑같은 에러');
    expect(result.type).toBe('frustrated');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  }, 30_000);

  it('keeps failing: "빌드가 자꾸 깨져. 뭐가 문제야?"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('빌드가 자꾸 깨져. 뭐가 문제야?');
    expect(result.type).toBe('frustrated');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  }, 30_000);

  it('annoyance: "이거 왜 안 되는 거야 대체"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('이거 왜 안 되는 거야 대체');
    expect(result.type).toBe('frustrated');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  }, 30_000);

  it('revert after failure: "원래대로 돌려. 이 방법은 안 먹힌다"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('원래대로 돌려. 이 방법은 안 먹힌다');
    expect(['frustrated', 'abandonment']).toContain(result.type);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Test cases: "resolution" prompts
// ---------------------------------------------------------------------------

describe('Frustration Analysis — "resolution" prompts', () => {
  it('success: "됐다! 드디어 해결했어"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('됐다! 드디어 해결했어');
    expect(result.type).toBe('resolution');
  }, 30_000);

  it('root cause found: "아 알겠다. 환경변수 설정이 빠져있었네"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('아 알겠다. 환경변수 설정이 빠져있었네');
    expect(result.type).toBe('resolution');
  }, 30_000);

  it('fix confirmed: "이제 테스트 다 통과해. 문제는 import 경로였어"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('이제 테스트 다 통과해. 문제는 import 경로였어');
    expect(result.type).toBe('resolution');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Test cases: "abandonment" prompts
// ---------------------------------------------------------------------------

describe('Frustration Analysis — "abandonment" prompts', () => {
  it('giving up: "이 방법은 안 되겠다. 완전히 다른 접근법으로 가자"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('이 방법은 안 되겠다. 완전히 다른 접근법으로 가자');
    expect(result.type).toBe('abandonment');
  }, 30_000);

  it('switching: "이거 포기하고 다른 라이브러리 쓰자"', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('이거 포기하고 다른 라이브러리 쓰자');
    expect(result.type).toBe('abandonment');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Confidence calibration
// ---------------------------------------------------------------------------

describe('Frustration Analysis — confidence calibration', () => {
  it('explicit frustration should have confidence >= 0.9', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('세 번째 시도인데 아직도 같은 에러야. 뭘 해도 안 고쳐져');
    expect(result.type).toBe('frustrated');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  }, 30_000);

  it('normal command should not be classified as high-confidence frustrated', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('package.json에 script 추가해줘');
    if (result.type === 'frustrated') {
      expect(result.confidence).toBeLessThan(0.7);
    } else {
      expect(result.type).toBe('normal');
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Response format validation
// ---------------------------------------------------------------------------

describe('Frustration Analysis — response format', () => {
  it('should return all required fields', async () => {
    if (skipIfUnavailable()) return;
    const result = await analyze('빌드 실패하는데 확인해줘');
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reasoning');
    expect(['normal', 'frustrated', 'resolution', 'abandonment']).toContain(result.type);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(typeof result.reasoning).toBe('string');
  }, 30_000);
});
