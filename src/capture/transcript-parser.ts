import * as fs from 'fs';
import type { TranscriptData, TranscriptMessage, ToolCallEntry } from '../types/index';

/**
 * Parse a Claude Code JSONL transcript file into structured TranscriptData.
 *
 * Returns null if the file cannot be read, is empty, or contains no
 * extractable data. Never throws.
 */
export function parseTranscriptFile(filePath: string): TranscriptData | null {
  try {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // File not found or unreadable
      return null;
    }

    if (raw.trim().length === 0) {
      return null;
    }

    const messages: TranscriptMessage[] = [];
    const toolCalls: ToolCallEntry[] = [];
    const errors: string[] = [];
    // Map tool_use id -> index in toolCalls for pairing with tool_result
    const toolUseMap = new Map<string, number>();

    const lines = raw.split('\n');

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      let parsed: Record<string, unknown>;
      try {
        const value = JSON.parse(line);
        // Must be a non-null object with a 'type' field
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          continue;
        }
        parsed = value as Record<string, unknown>;
      } catch {
        // Invalid JSON line, skip
        continue;
      }

      const type = parsed.type;
      if (typeof type !== 'string') {
        continue;
      }

      switch (type) {
        case 'human':
        case 'user': {
          const msg = extractMessage(parsed);
          if (msg) {
            messages.push(msg);
          }
          // Extract tool_result blocks from content array (Claude Code format)
          extractToolResultsFromContent(parsed, toolCalls, errors, toolUseMap);
          break;
        }

        case 'assistant': {
          const msg = extractMessage(parsed);
          if (msg) {
            messages.push(msg);
          }
          // Extract tool_use blocks from content array (Claude Code format)
          extractToolUsesFromContent(parsed, toolCalls, toolUseMap);
          // Extract tool_calls array if present (legacy format)
          const tc = parsed.tool_calls;
          if (Array.isArray(tc)) {
            for (const call of tc) {
              if (call && typeof call === 'object' && 'name' in call) {
                const entry: ToolCallEntry = {
                  name: String((call as Record<string, unknown>).name ?? ''),
                  input: (call as Record<string, unknown>).input,
                };
                const output = (call as Record<string, unknown>).output;
                if (typeof output === 'string') {
                  entry.output = output;
                }
                toolCalls.push(entry);
              }
            }
          }
          break;
        }

        case 'tool_use': {
          const entry: ToolCallEntry = {
            name: String(parsed.name ?? ''),
            input: parsed.input,
          };
          if (typeof parsed.output === 'string') {
            entry.output = parsed.output;
          }
          toolCalls.push(entry);
          break;
        }

        case 'tool_result': {
          const toolUseId = typeof parsed.tool_use_id === 'string' ? parsed.tool_use_id : undefined;
          const matchIdx = toolUseId !== undefined ? toolUseMap.get(toolUseId) : undefined;

          if (matchIdx !== undefined) {
            // Merge output/error into the existing paired tool_use entry
            const existing = toolCalls[matchIdx];
            if (typeof parsed.output === 'string') {
              existing.output = parsed.output;
            }
            if (typeof parsed.error === 'string' && parsed.error.length > 0) {
              existing.error = parsed.error;
            }
          }
          // Orphan tool_result (no matching tool_use): don't add to toolCalls

          // Add explicit error field to errors array if non-null and non-empty
          if (typeof parsed.error === 'string' && parsed.error.length > 0) {
            errors.push(parsed.error);
          }

          break;
        }

        default:
          // Unknown type, skip
          break;
      }
    }

    // Return null if no valid data was extracted
    if (messages.length === 0 && toolCalls.length === 0 && errors.length === 0) {
      return null;
    }

    return { messages, toolCalls, errors };
  } catch {
    // Catch-all: never throw
    return null;
  }
}

/**
 * Extract a TranscriptMessage from a parsed JSONL entry's message field.
 * Handles both plain string content and Claude Code's array content format.
 */
function extractMessage(parsed: Record<string, unknown>): TranscriptMessage | null {
  const msg = parsed.message;
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return null;
  }

  const msgObj = msg as Record<string, unknown>;
  const role = msgObj.role;
  const rawContent = msgObj.content;

  if (typeof role !== 'string') {
    return null;
  }

  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return null;
  }

  let content: string;
  if (typeof rawContent === 'string') {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    // Claude Code format: content is an array of blocks
    // Extract text from {type:"text", text:"..."} blocks
    const textParts: string[] = [];
    for (const block of rawContent) {
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          textParts.push(b.text);
        }
      }
    }
    if (textParts.length === 0) {
      return null;
    }
    content = textParts.join('\n');
  } else {
    return null;
  }

  // Skip empty/whitespace-only content
  if (content.trim().length === 0) {
    return null;
  }

  const result: TranscriptMessage = { role, content };
  if (typeof parsed.timestamp === 'string') {
    result.timestamp = parsed.timestamp;
  } else if (typeof msgObj.timestamp === 'string') {
    result.timestamp = msgObj.timestamp;
  }

  return result;
}

/**
 * Extract tool_use entries from assistant message content array (Claude Code format).
 * Claude Code embeds tool_use as {type:"tool_use", name:"...", input:{...}} in the content array.
 */
function extractToolUsesFromContent(
  parsed: Record<string, unknown>,
  toolCalls: ToolCallEntry[],
  toolUseMap: Map<string, number>,
): void {
  const msg = parsed.message;
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return;
  }
  const content = (msg as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    if (block && typeof block === 'object' && !Array.isArray(block)) {
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_use' && typeof b.name === 'string') {
        const entry: ToolCallEntry = {
          name: b.name,
          input: b.input,
        };
        const idx = toolCalls.length;
        toolCalls.push(entry);
        // Store id -> index mapping for pairing with tool_result
        if (typeof b.id === 'string') {
          toolUseMap.set(b.id, idx);
        }
      }
    }
  }
}

/**
 * Extract tool_result entries from user message content array (Claude Code format).
 * Claude Code embeds tool_result as {type:"tool_result", content:"..."} in the content array.
 */
function extractToolResultsFromContent(
  parsed: Record<string, unknown>,
  toolCalls: ToolCallEntry[],
  errors: string[],
  toolUseMap: Map<string, number>,
): void {
  const msg = parsed.message;
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return;
  }
  const content = (msg as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    if (block && typeof block === 'object' && !Array.isArray(block)) {
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_result') {
        const output = typeof b.content === 'string' ? b.content : undefined;
        const toolUseId = typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined;
        const matchIdx = toolUseId !== undefined ? toolUseMap.get(toolUseId) : undefined;

        if (matchIdx !== undefined) {
          // Merge into existing paired tool_use entry
          const existing = toolCalls[matchIdx];
          if (output !== undefined) {
            existing.output = output;
          }
        }
        // Orphan tool_result: don't add to toolCalls
      }
    }
  }
}
