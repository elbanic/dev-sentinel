import { execSync } from 'child_process';
import type { MatchResult } from '../types/index';

const DEFAULT_BOX_WIDTH = 70;
const MIN_BOX_WIDTH = 40;

function getTerminalWidth(): number {
  try {
    const cols = parseInt(execSync('tput cols', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim(), 10);
    if (cols > 0) return cols;
  } catch { /* fallback */ }
  return DEFAULT_BOX_WIDTH;
}

/**
 * Word-wrap text to fit within a maximum width.
 * Breaks at word boundaries. If a single word exceeds maxWidth, it is truncated.
 */
function wordWrap(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) {
    return [text];
  }

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length === 0) {
      // First word on line
      if (word.length > maxWidth) {
        // Truncate overly long word
        lines.push(word.substring(0, maxWidth));
      } else {
        currentLine = word;
      }
    } else if (currentLine.length + 1 + word.length <= maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      if (word.length > maxWidth) {
        lines.push(word.substring(0, maxWidth));
        currentLine = '';
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Pad a content string to the given width.
 */
function padLine(text: string, boxWidth: number): string {
  const line = ' ' + text;
  if (line.length >= boxWidth) {
    return line.substring(0, boxWidth);
  }
  return line + ' '.repeat(boxWidth - line.length);
}

/**
 * Format a MatchResult into a boxed warning for Active Recall display.
 * Box width adapts to the current terminal width.
 */
export function formatWarning(match: MatchResult): string {
  const termWidth = getTerminalWidth();
  const boxWidth = Math.max(MIN_BOX_WIDTH, termWidth);
  const dashCount = boxWidth - 2;
  const contentWidth = boxWidth - 1;

  const FIRST_PREFIX = '\u25B8 ';
  const CONT_PREFIX = '  ';
  const ACTION_PREFIX = '\u2192 ';
  const prefixedWidth = contentWidth - FIRST_PREFIX.length - 1;
  const actionWidth = contentWidth - ACTION_PREFIX.length - 1;

  const lines: string[] = [];

  // Leading newline so the box starts on its own line
  lines.push('');

  // Top border
  lines.push('\u256D' + '\u2500'.repeat(dashCount) + '\u256E');

  // Header
  const pct = Math.round(match.confidence * 100);
  lines.push(padLine('\uD83D\uDEE1\uFE0F Sentinel (confidence: ' + pct + '%)', boxWidth));

  // Separator
  lines.push('\u251C' + '\u2500'.repeat(dashCount) + '\u2524');

  // Experience summary
  const summaryParts: { label: string; value: string }[] = [];
  summaryParts.push({ label: 'Issue', value: match.experience.frustrationSignature });
  if (match.experience.failedApproaches.length > 0) {
    summaryParts.push({ label: 'Failed', value: match.experience.failedApproaches.join(', ') });
  }
  if (match.experience.lessons.length > 0) {
    summaryParts.push({ label: 'Lesson', value: match.experience.lessons.join(', ') });
  }

  for (const part of summaryParts) {
    const fullText = part.label + ': ' + part.value;
    const wrapped = wordWrap(fullText, prefixedWidth);
    for (let i = 0; i < wrapped.length; i++) {
      const prefix = i === 0 ? FIRST_PREFIX : CONT_PREFIX;
      lines.push(padLine(prefix + wrapped[i], boxWidth));
    }
  }

  // Suggested action
  const actionText = '"' + match.suggestedAction + '"';
  const actionWrapped = wordWrap(actionText, actionWidth);
  for (let i = 0; i < actionWrapped.length; i++) {
    const prefix = i === 0 ? ACTION_PREFIX : '  ';
    lines.push(padLine(prefix + actionWrapped[i], boxWidth));
  }

  // Bottom border
  lines.push('\u2570' + '\u2500'.repeat(dashCount) + '\u256F');

  return lines.join('\n');
}
