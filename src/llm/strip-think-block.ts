/**
 * Strip thinking blocks from LLM output.
 *
 * qwen3:4b's /api/generate has no no_think option, so thinking text
 * always appears before the actual JSON response. Two patterns observed:
 *
 * 1. `<think>reasoning</think>JSON`  — both tags present
 * 2. `reasoning text</think>JSON`    — opening tag missing (common with qwen3)
 */
export function stripThinkBlock(raw: string): string {
  // Case 1: Matched pair — strip <think>...</think>
  let result = raw.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Case 2: Orphan </think> (opening tag missing) — strip everything before it
  const closeIdx = result.indexOf('</think>');
  if (closeIdx !== -1) {
    result = result.slice(closeIdx + '</think>'.length);
  }

  return result.trim();
}
