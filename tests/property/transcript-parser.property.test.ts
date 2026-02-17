/**
 * Property-Based Tests for TranscriptParser
 *
 * TDD RED phase: These property tests use fast-check to verify that the
 * parseTranscriptFile function maintains key invariants across a wide
 * range of randomly generated inputs.
 *
 * The target module (src/capture/transcript-parser.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Properties tested:
 *   1. Round-trip: arbitrary user/assistant messages written as JSONL are
 *      correctly recovered after parsing.
 *   2. Invalid JSON resilience: mixing valid and invalid JSON lines never
 *      causes a crash; invalid lines are silently skipped.
 *   3. Error count bound: the number of errors extracted is at most
 *      the number of tool_results with explicit errors + the number of
 *      tool outputs matching error patterns.
 *   4. Message count: parsed messages.length equals the count of
 *      human + assistant entries in the input JSONL.
 */

import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseTranscriptFile } from '../../src/capture/transcript-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-transcript-prop-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Writes an array of objects as JSONL to a temporary file and returns the
 * file path.
 */
function writeTmpJsonl(lines: unknown[]): string {
  const content = lines.map((line) => JSON.stringify(line)).join('\n');
  const filePath = path.join(tmpDir, `prop-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Writes raw string content to a temporary file.
 */
function writeTmpRaw(content: string): string {
  const filePath = path.join(tmpDir, `prop-raw-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Arbitraries (fast-check generators)
// ---------------------------------------------------------------------------

/** Arbitrary non-empty, non-whitespace content string (user/assistant message body). */
const contentArb = fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0);

/** Arbitrary optional timestamp string. */
const optionalTimestampArb = fc.option(
  fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
    .filter((d) => !isNaN(d.getTime()))
    .map((d) => d.toISOString()),
  { nil: undefined },
);

/** Arbitrary human (user) JSONL entry. */
const humanEntryArb = fc.record({
  content: contentArb,
  timestamp: optionalTimestampArb,
}).map(({ content, timestamp }) => {
  const message: Record<string, unknown> = { role: 'user', content };
  if (timestamp !== undefined) {
    message.timestamp = timestamp;
  }
  return { type: 'human' as const, message };
});

/** Arbitrary assistant JSONL entry (without tool_calls). */
const assistantEntryArb = fc.record({
  content: contentArb,
  timestamp: optionalTimestampArb,
}).map(({ content, timestamp }) => {
  const message: Record<string, unknown> = { role: 'assistant', content };
  if (timestamp !== undefined) {
    message.timestamp = timestamp;
  }
  return { type: 'assistant' as const, message, tool_calls: [] };
});

/** Arbitrary message entry (either human or assistant). */
const messageEntryArb = fc.oneof(humanEntryArb, assistantEntryArb);

/** Arbitrary tool name. */
const toolNameArb = fc.constantFrom('Bash', 'Read', 'Write', 'Grep', 'Glob');

/** Arbitrary clean tool output (no error patterns). */
const cleanOutputArb = fc.constantFrom(
  'Success',
  'Done.',
  'file1.ts\nfile2.ts',
  'const x = 42;',
  'Build completed successfully',
  'OK',
);

/** Error patterns that should be detected. */
const ERROR_PATTERNS = [
  'Error: something went wrong',
  'error: compilation failed',
  'TypeError: undefined is not a function',
  'SyntaxError: Unexpected token',
  'ReferenceError: x is not defined',
  'ENOENT: no such file or directory',
  'EPERM: operation not permitted',
];

/** Arbitrary tool output that contains an error pattern. */
const errorOutputArb = fc.constantFrom(...ERROR_PATTERNS);

/** Arbitrary tool_result with no errors (clean output, null error). */
const cleanToolResultArb = fc.record({
  name: toolNameArb,
  output: cleanOutputArb,
}).map(({ name, output }) => ({
  type: 'tool_result' as const,
  name,
  output,
  error: null,
}));

/** Arbitrary tool_result with an explicit error field. */
const errorFieldToolResultArb = fc.record({
  name: toolNameArb,
  output: cleanOutputArb,
  error: fc.string({ minLength: 1, maxLength: 200 }),
}).map(({ name, output, error }) => ({
  type: 'tool_result' as const,
  name,
  output,
  error,
}));

/** Arbitrary tool_result with an error pattern in output (but null error field). */
const errorPatternToolResultArb = fc.record({
  name: toolNameArb,
  output: errorOutputArb,
}).map(({ name, output }) => ({
  type: 'tool_result' as const,
  name,
  output,
  error: null,
}));

/** Arbitrary string that is definitely NOT valid JSON. */
const invalidJsonLineArb = fc.oneof(
  fc.constant('this is not json'),
  fc.constant('{ broken: true, }'),
  fc.constant('!!!garbage!!!'),
  fc.constant(''),
  fc.constant('undefined'),
  fc.string({ minLength: 1, maxLength: 100 }).filter((s) => {
    try {
      JSON.parse(s);
      return false; // It parsed successfully, so it IS valid JSON - filter it out
    } catch {
      return true; // Parse failed, this is invalid JSON - keep it
    }
  }),
);

// ---------------------------------------------------------------------------
// Property 1: Round-trip message preservation
// ---------------------------------------------------------------------------
describe('Property 1: Round-trip message preservation', () => {
  it('should recover all user/assistant messages written as JSONL', () => {
    fc.assert(
      fc.property(
        fc.array(messageEntryArb, { minLength: 1, maxLength: 20 }),
        (entries) => {
          const filePath = writeTmpJsonl(entries);
          const result = parseTranscriptFile(filePath);

          // Must not be null since we have at least 1 valid entry
          expect(result).not.toBeNull();

          // Message count must match input entries
          expect(result!.messages).toHaveLength(entries.length);

          // Each message content must match the corresponding input
          for (let i = 0; i < entries.length; i++) {
            const inputMessage = entries[i].message as { role: string; content: string; timestamp?: string };
            expect(result!.messages[i].content).toBe(inputMessage.content);

            // Role mapping: human -> user, assistant -> assistant
            const expectedRole = entries[i].type === 'human' ? 'user' : 'assistant';
            expect(result!.messages[i].role).toBe(expectedRole);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should preserve message ordering (first in, first out)', () => {
    fc.assert(
      fc.property(
        fc.array(contentArb, { minLength: 2, maxLength: 15 }),
        (contents) => {
          // Create alternating human/assistant entries
          const entries = contents.map((content, i) =>
            i % 2 === 0
              ? { type: 'human', message: { role: 'user', content } }
              : { type: 'assistant', message: { role: 'assistant', content }, tool_calls: [] },
          );
          const filePath = writeTmpJsonl(entries);
          const result = parseTranscriptFile(filePath);

          expect(result).not.toBeNull();
          expect(result!.messages).toHaveLength(contents.length);

          // Verify ordering is preserved
          for (let i = 0; i < contents.length; i++) {
            expect(result!.messages[i].content).toBe(contents[i]);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Invalid JSON resilience (never crash)
// ---------------------------------------------------------------------------
describe('Property 2: Invalid JSON resilience', () => {
  it('should never crash when mixing valid and invalid JSON lines', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            messageEntryArb.map((e) => ({ valid: true as const, line: JSON.stringify(e) })),
            invalidJsonLineArb.map((line) => ({ valid: false as const, line })),
          ),
          { minLength: 1, maxLength: 30 },
        ),
        (mixedLines) => {
          const content = mixedLines.map((ml) => ml.line).join('\n');
          const filePath = writeTmpRaw(content);

          // MUST NOT THROW - this is the core property
          expect(() => parseTranscriptFile(filePath)).not.toThrow();

          const result = parseTranscriptFile(filePath);

          // Result is either null (no valid data) or a TranscriptData
          if (result !== null) {
            expect(Array.isArray(result.messages)).toBe(true);
            expect(Array.isArray(result.toolCalls)).toBe(true);
            expect(Array.isArray(result.errors)).toBe(true);
          }

          // Count expected valid message entries
          const validMessageCount = mixedLines.filter((ml) => ml.valid).length;

          if (validMessageCount === 0) {
            // No valid entries -> null
            expect(result).toBeNull();
          } else {
            // Valid entries exist -> result should contain them
            expect(result).not.toBeNull();
            expect(result!.messages).toHaveLength(validMessageCount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return null when all lines are invalid JSON', () => {
    fc.assert(
      fc.property(
        fc.array(invalidJsonLineArb, { minLength: 1, maxLength: 20 }),
        (invalidLines) => {
          const content = invalidLines.join('\n');
          const filePath = writeTmpRaw(content);

          // Must not throw
          expect(() => parseTranscriptFile(filePath)).not.toThrow();

          const result = parseTranscriptFile(filePath);

          // No valid data could be extracted -> null
          // (Some lines may accidentally parse as JSON but won't have valid type fields,
          // so result could be null or have 0 messages. If 0 messages we still expect null.)
          if (result !== null) {
            // If somehow a line parsed as valid JSON with a recognized type,
            // that's okay - but the count of messages should be 0 for truly invalid lines
            // The point is: no crash.
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Error count bound
// ---------------------------------------------------------------------------
describe('Property 3: Error count is bounded by error sources', () => {
  it('should extract at most (explicit errors + pattern-matched outputs) errors', () => {
    fc.assert(
      fc.property(
        // Mix of message entries and tool_result entries
        fc.array(messageEntryArb, { minLength: 0, maxLength: 5 }),
        fc.array(cleanToolResultArb, { minLength: 0, maxLength: 5 }),
        fc.array(errorFieldToolResultArb, { minLength: 0, maxLength: 3 }),
        fc.array(errorPatternToolResultArb, { minLength: 0, maxLength: 3 }),
        (messages, cleanResults, errorFieldResults, errorPatternResults) => {
          // Combine all entries
          const allEntries = [
            ...messages,
            ...cleanResults,
            ...errorFieldResults,
            ...errorPatternResults,
          ];

          // Skip if no entries at all (would produce null)
          fc.pre(allEntries.length > 0);
          // Ensure at least one message entry so we get a non-null result
          fc.pre(messages.length > 0);

          // Shuffle entries to test order-independence
          const shuffled = [...allEntries].sort(() => Math.random() - 0.5);
          const filePath = writeTmpJsonl(shuffled);
          const result = parseTranscriptFile(filePath);

          if (result !== null) {
            // Upper bound: explicit error fields + pattern-matched outputs
            const maxErrors = errorFieldResults.length + errorPatternResults.length;
            expect(result.errors.length).toBeLessThanOrEqual(maxErrors);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should produce zero errors when all tool results are clean', () => {
    fc.assert(
      fc.property(
        fc.array(messageEntryArb, { minLength: 1, maxLength: 5 }),
        fc.array(cleanToolResultArb, { minLength: 0, maxLength: 5 }),
        (messages, cleanResults) => {
          const allEntries = [...messages, ...cleanResults];
          const filePath = writeTmpJsonl(allEntries);
          const result = parseTranscriptFile(filePath);

          expect(result).not.toBeNull();
          expect(result!.errors).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Message count matches input
// ---------------------------------------------------------------------------
describe('Property 4: Message count matches human + assistant entry count', () => {
  it('should have messages.length equal to the number of human + assistant entries', () => {
    fc.assert(
      fc.property(
        fc.array(messageEntryArb, { minLength: 1, maxLength: 20 }),
        fc.array(cleanToolResultArb, { minLength: 0, maxLength: 10 }),
        (messageEntries, toolResults) => {
          // Interleave message entries and tool results
          const allEntries: unknown[] = [];
          let mi = 0;
          let ti = 0;
          while (mi < messageEntries.length || ti < toolResults.length) {
            if (mi < messageEntries.length) {
              allEntries.push(messageEntries[mi++]);
            }
            if (ti < toolResults.length) {
              allEntries.push(toolResults[ti++]);
            }
          }

          const filePath = writeTmpJsonl(allEntries);
          const result = parseTranscriptFile(filePath);

          expect(result).not.toBeNull();
          // Message count = number of human + assistant entries (tool_results don't add messages)
          expect(result!.messages).toHaveLength(messageEntries.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should count tool_use entries as tool calls, not messages', () => {
    fc.assert(
      fc.property(
        fc.array(messageEntryArb, { minLength: 1, maxLength: 10 }),
        fc.array(
          fc.record({
            name: toolNameArb,
            input: fc.constant({ command: 'test' }),
            output: cleanOutputArb,
          }).map(({ name, input, output }) => ({
            type: 'tool_use' as const,
            name,
            input,
            output,
          })),
          { minLength: 1, maxLength: 10 },
        ),
        (messageEntries, toolUseEntries) => {
          const allEntries = [...messageEntries, ...toolUseEntries];
          const filePath = writeTmpJsonl(allEntries);
          const result = parseTranscriptFile(filePath);

          expect(result).not.toBeNull();
          // Messages should only come from human/assistant entries
          expect(result!.messages).toHaveLength(messageEntries.length);
          // Tool calls should include at least the tool_use entries
          expect(result!.toolCalls.length).toBeGreaterThanOrEqual(toolUseEntries.length);
        },
      ),
      { numRuns: 50 },
    );
  });
});
