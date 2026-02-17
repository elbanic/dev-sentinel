export interface NoteFields {
  frustrationSignature: string;
  failedApproaches: string[];
  successfulApproach: string | undefined;
  lessons: string[];
}

/**
 * Extract structured note fields from a parsed LLM response object.
 * Each field is only overwritten if the LLM provided a valid value;
 * otherwise the corresponding fallback value is preserved.
 */
export function extractNoteFields(
  obj: Record<string, unknown>,
  fallback: NoteFields,
): NoteFields {
  const result = { ...fallback };

  if (typeof obj.frustrationSignature === 'string' && obj.frustrationSignature.length > 0) {
    result.frustrationSignature = obj.frustrationSignature;
  }
  if (Array.isArray(obj.failedApproaches)) {
    result.failedApproaches = obj.failedApproaches.filter(
      (a): a is string => typeof a === 'string',
    );
  }
  if (typeof obj.successfulApproach === 'string' && obj.successfulApproach.length > 0) {
    result.successfulApproach = obj.successfulApproach;
  } else if (obj.successfulApproach === null) {
    result.successfulApproach = undefined;
  }
  if (Array.isArray(obj.lessons) && obj.lessons.length > 0) {
    result.lessons = obj.lessons.filter((l): l is string => typeof l === 'string');
  }

  return result;
}
