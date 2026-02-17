/**
 * Unit Tests for parseLLMJson utility
 *
 * Parses JSON from LLM response text that may be wrapped in markdown code fences.
 * Returns the parsed value, or null if parsing fails.
 */

import { parseLLMJson } from '../../src/utils/parse-llm-json';

describe('parseLLMJson', () => {
  // --- Direct JSON parsing ---

  it('should parse plain JSON object', () => {
    const input = '{"type":"normal","confidence":0.9}';
    expect(parseLLMJson(input)).toEqual({ type: 'normal', confidence: 0.9 });
  });

  it('should parse plain JSON array', () => {
    const input = '["a","b","c"]';
    expect(parseLLMJson(input)).toEqual(['a', 'b', 'c']);
  });

  it('should parse plain JSON string', () => {
    expect(parseLLMJson('"hello"')).toBe('hello');
  });

  it('should parse plain JSON number', () => {
    expect(parseLLMJson('42')).toBe(42);
  });

  it('should parse plain JSON boolean', () => {
    expect(parseLLMJson('true')).toBe(true);
  });

  it('should parse plain JSON null', () => {
    expect(parseLLMJson('null')).toBeNull();
  });

  // --- Markdown fence extraction ---

  it('should parse JSON from ```json fence', () => {
    const input = '```json\n{"type":"frustrated","confidence":0.8}\n```';
    expect(parseLLMJson(input)).toEqual({ type: 'frustrated', confidence: 0.8 });
  });

  it('should parse JSON from bare ``` fence (no language tag)', () => {
    const input = '```\n{"type":"normal"}\n```';
    expect(parseLLMJson(input)).toEqual({ type: 'normal' });
  });

  it('should parse JSON from fence with surrounding text', () => {
    const input = 'Here is the result:\n```json\n{"key":"value"}\n```\nDone.';
    expect(parseLLMJson(input)).toEqual({ key: 'value' });
  });

  it('should parse JSON from fence without newlines around content', () => {
    const input = '```json{"key":"value"}```';
    expect(parseLLMJson(input)).toEqual({ key: 'value' });
  });

  it('should parse JSON from fence with extra whitespace', () => {
    const input = '```json  \n  {"key":"value"}  \n  ```';
    expect(parseLLMJson(input)).toEqual({ key: 'value' });
  });

  // --- Failure cases ---

  it('should return null for empty string', () => {
    expect(parseLLMJson('')).toBeNull();
  });

  it('should return null for plain text', () => {
    expect(parseLLMJson('this is not json')).toBeNull();
  });

  it('should return null for invalid JSON in fence', () => {
    const input = '```json\n{invalid json}\n```';
    expect(parseLLMJson(input)).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    expect(parseLLMJson('{key: value}')).toBeNull();
  });

  it('should return null for incomplete JSON', () => {
    expect(parseLLMJson('{"key":')).toBeNull();
  });

  // --- Edge cases ---

  it('should use the first valid fence if multiple exist', () => {
    const input = '```json\n{"first":true}\n```\nmore text\n```json\n{"second":true}\n```';
    expect(parseLLMJson(input)).toEqual({ first: true });
  });

  it('should handle JSON with nested objects', () => {
    const input = '```json\n{"outer":{"inner":"value"}}\n```';
    expect(parseLLMJson(input)).toEqual({ outer: { inner: 'value' } });
  });

  it('should prefer direct parse over fence extraction', () => {
    // If the entire string is valid JSON, parse it directly
    const input = '{"directParse":true}';
    expect(parseLLMJson(input)).toEqual({ directParse: true });
  });
});
