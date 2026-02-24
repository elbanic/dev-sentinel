import type { TranscriptData } from '../types/index';

/**
 * Build a context message from TranscriptData for LLM consumption.
 * Used by both note generation (Stop hook) and review confirm (CLI).
 */
export function buildContextMessage(
  transcriptData: TranscriptData,
  frustrationContext?: { prompt: string; intent: string },
): string {
  const parts: string[] = [];

  if (frustrationContext) {
    parts.push(
      '── Frustration Context ──\n' +
      `Intent: ${frustrationContext.intent}\n` +
      `Frustrated at: "${frustrationContext.prompt}"\n` +
      'Focus your analysis on the conversation related to this frustration.',
    );
  }

  if (transcriptData.messages.length > 0) {
    const messageSummaries = transcriptData.messages.map(
      (m) => `[${m.role}]: ${m.content}`,
    );
    parts.push('── Conversation ──\n' + messageSummaries.join('\n\n'));
  }

  const namedToolCalls = transcriptData.toolCalls.filter((tc) => tc.name);
  if (namedToolCalls.length > 0) {
    const toolCallSummaries = namedToolCalls.map((tc) => {
      const inputStr = tc.input === null || tc.input === undefined
        ? ''
        : JSON.stringify(tc.input);
      const truncatedInput = inputStr.length > 100
        ? inputStr.substring(0, 100) + '...'
        : inputStr;
      let summary = `${tc.name}(${truncatedInput})`;
      if (tc.output) {
        const truncatedOutput = tc.output.length > 200
          ? tc.output.substring(0, 200) + '...'
          : tc.output;
        summary += ` → ${truncatedOutput}`;
      }
      if (tc.error) summary += ` [ERROR: ${tc.error}]`;
      return summary;
    });
    parts.push('── Tool Calls ──\n' + toolCallSummaries.join('\n'));
  }

  if (transcriptData.errors.length > 0) {
    parts.push('── Errors ──\n' + transcriptData.errors.map((e) => `• ${e}`).join('\n'));
  }

  return parts.join('\n\n');
}
