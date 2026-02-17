/**
 * Unit Tests for stripThinkBlock utility
 *
 * The qwen3:4b model outputs `<think>...</think>` blocks before JSON responses.
 * stripThinkBlock removes these blocks so downstream JSON parsers can work.
 */

import { stripThinkBlock } from '../../src/llm/strip-think-block';

describe('stripThinkBlock', () => {
  it('should return empty string for empty string input', () => {
    expect(stripThinkBlock('')).toBe('');
  });

  it('should return string unchanged when no think block is present', () => {
    const input = '{"type":"normal","confidence":0.9,"reasoning":"test"}';
    expect(stripThinkBlock(input)).toBe(input);
  });

  it('should strip think block before JSON', () => {
    const json = '{"type":"normal","confidence":0.8,"reasoning":"ok"}';
    const input = '<think>The user seems frustrated because they mentioned the error again.</think>' + json;
    expect(stripThinkBlock(input)).toBe(json);
  });

  it('should strip multiple think blocks', () => {
    const input =
      '<think>First reasoning block.</think>some text<think>Second reasoning block.</think>final text';
    expect(stripThinkBlock(input)).toBe('some textfinal text');
  });

  it('should strip think block but preserve markdown fence', () => {
    const fence = '```json\n{"type":"normal"}\n```';
    const input = '<think>Let me analyze this.</think>\n' + fence;
    expect(stripThinkBlock(input)).toBe(fence);
  });

  it('should leave unclosed <think> tag unchanged (no </think> to match)', () => {
    const input = '<think>This tag is never closed {"type":"normal"}';
    expect(stripThinkBlock(input)).toBe(input);
  });

  it('should strip orphan </think> without opening <think> tag', () => {
    const json = '{"type":"frustrated","confidence":0.8,"reasoning":"test"}';
    const input = 'Okay let me analyze this prompt...\nThe user seems frustrated.\n</think>\n\n' + json;
    expect(stripThinkBlock(input)).toBe(json);
  });

  it('should handle long thinking text before orphan </think>', () => {
    const thinking = 'First, I need to check...\nThen consider...\nFinally decide.\n';
    const json = '{"type":"normal"}';
    const input = thinking.repeat(10) + '</think>\n' + json;
    expect(stripThinkBlock(input)).toBe(json);
  });

  it('should handle orphan </think> with multi-line thinking text', () => {
    const json = '{"type":"frustrated"}';
    const input = 'The user is showing frustration.\nErrors keep repeating.\n</think>\n\n' + json;
    expect(stripThinkBlock(input)).toBe(json);
  });

  it('should strip empty think block', () => {
    const input = '<think></think>{"type":"normal"}';
    expect(stripThinkBlock(input)).toBe('{"type":"normal"}');
  });

  it('should strip think block containing plain text content', () => {
    const json = '{"type":"frustrated"}';
    const input = '<think>The user is showing frustration. Errors keep repeating.</think>' + json;
    expect(stripThinkBlock(input)).toBe(json);
  });

  it('should strip think block with newlines inside', () => {
    const json = '{"type":"normal","confidence":0.5,"reasoning":"test"}';
    const input =
      '<think>\nLine 1 of reasoning.\nLine 2 of reasoning.\nLine 3.\n</think>\n' + json;
    expect(stripThinkBlock(input)).toBe(json);
  });

  it('should return empty string when input is only a think block', () => {
    const input = '<think>Only reasoning, no content after.</think>';
    expect(stripThinkBlock(input)).toBe('');
  });
});
