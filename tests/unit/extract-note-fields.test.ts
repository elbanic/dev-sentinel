/**
 * Unit Tests for extractNoteFields utility
 *
 * Extracts structured note fields from a parsed LLM response object.
 * Each field is only overwritten if the LLM provided a valid value;
 * otherwise the corresponding fallback value is preserved.
 */

import { extractNoteFields, type NoteFields } from '../../src/utils/extract-note-fields';

describe('extractNoteFields', () => {
  const defaultFallback: NoteFields = {
    frustrationSignature: 'fallback error',
    failedApproaches: ['fallback approach'],
    successfulApproach: 'fallback success',
    lessons: ['fallback lesson'],
  };

  // --- Full override ---

  it('should override all fields when LLM provides valid values', () => {
    const obj = {
      frustrationSignature: 'new error',
      failedApproaches: ['approach1', 'approach2'],
      successfulApproach: 'new success',
      lessons: ['lesson1', 'lesson2'],
    };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result).toEqual({
      frustrationSignature: 'new error',
      failedApproaches: ['approach1', 'approach2'],
      successfulApproach: 'new success',
      lessons: ['lesson1', 'lesson2'],
    });
  });

  // --- Partial overrides ---

  it('should only override frustrationSignature when only it is provided', () => {
    const obj = { frustrationSignature: 'new error' };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.frustrationSignature).toBe('new error');
    expect(result.failedApproaches).toEqual(['fallback approach']);
    expect(result.successfulApproach).toBe('fallback success');
    expect(result.lessons).toEqual(['fallback lesson']);
  });

  it('should only override failedApproaches when only it is provided', () => {
    const obj = { failedApproaches: ['new approach'] };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.frustrationSignature).toBe('fallback error');
    expect(result.failedApproaches).toEqual(['new approach']);
  });

  it('should only override lessons when only they are provided', () => {
    const obj = { lessons: ['new lesson'] };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.lessons).toEqual(['new lesson']);
    expect(result.frustrationSignature).toBe('fallback error');
  });

  // --- Fallback preservation ---

  it('should preserve fallback when frustrationSignature is empty string', () => {
    const obj = { frustrationSignature: '' };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.frustrationSignature).toBe('fallback error');
  });

  it('should preserve fallback when frustrationSignature is not a string', () => {
    const obj = { frustrationSignature: 123 };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.frustrationSignature).toBe('fallback error');
  });

  it('should preserve fallback when failedApproaches is not an array', () => {
    const obj = { failedApproaches: 'not an array' };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.failedApproaches).toEqual(['fallback approach']);
  });

  it('should preserve fallback when lessons is empty array', () => {
    const obj = { lessons: [] };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.lessons).toEqual(['fallback lesson']);
  });

  it('should preserve fallback when lessons is not an array', () => {
    const obj = { lessons: 'not an array' };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.lessons).toEqual(['fallback lesson']);
  });

  // --- successfulApproach special cases ---

  it('should set successfulApproach to undefined when LLM returns null', () => {
    const obj = { successfulApproach: null };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.successfulApproach).toBeUndefined();
  });

  it('should preserve fallback when successfulApproach is empty string', () => {
    const obj = { successfulApproach: '' };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.successfulApproach).toBe('fallback success');
  });

  it('should preserve fallback when successfulApproach is not a string', () => {
    const obj = { successfulApproach: 42 };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.successfulApproach).toBe('fallback success');
  });

  // --- Filtering non-string items ---

  it('should filter out non-string items from failedApproaches', () => {
    const obj = { failedApproaches: ['valid', 42, null, 'also valid'] };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.failedApproaches).toEqual(['valid', 'also valid']);
  });

  it('should filter out non-string items from lessons', () => {
    const obj = { lessons: ['valid lesson', 123, true, 'another lesson'] };
    const result = extractNoteFields(obj, defaultFallback);
    expect(result.lessons).toEqual(['valid lesson', 'another lesson']);
  });

  // --- Empty object ---

  it('should return all fallback values when object is empty', () => {
    const result = extractNoteFields({}, defaultFallback);
    expect(result).toEqual(defaultFallback);
  });

  // --- Immutability ---

  it('should not mutate the fallback object', () => {
    const fallback: NoteFields = {
      frustrationSignature: 'original',
      failedApproaches: ['original'],
      successfulApproach: 'original',
      lessons: ['original'],
    };
    const obj = { frustrationSignature: 'modified' };
    extractNoteFields(obj, fallback);
    expect(fallback.frustrationSignature).toBe('original');
  });

  // --- undefined fallback for successfulApproach ---

  it('should work when fallback successfulApproach is undefined', () => {
    const fallback: NoteFields = {
      frustrationSignature: '',
      failedApproaches: [],
      successfulApproach: undefined,
      lessons: [],
    };
    const obj = { successfulApproach: 'new approach' };
    const result = extractNoteFields(obj, fallback);
    expect(result.successfulApproach).toBe('new approach');
  });
});
