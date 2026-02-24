/**
 * Unit Tests for TranscriptParser
 *
 * TDD RED phase: These tests define the expected behavior of the
 * parseTranscriptFile function which parses Claude Code JSONL transcript
 * files into structured TranscriptData.
 *
 * The target module (src/capture/transcript-parser.ts) does NOT exist yet.
 * All tests are expected to FAIL until the implementation is written.
 *
 * Claude Code JSONL format:
 *   - type: "human"        -> user message
 *   - type: "assistant"    -> assistant message + optional tool_calls
 *   - type: "tool_use"     -> tool call entry (name, input, output)
 *   - type: "tool_result"  -> tool result with output/error
 *
 * Parsing rules:
 *   - File not found -> return null
 *   - Empty file -> return null
 *   - Invalid JSON lines -> skip, continue parsing
 *   - File with only invalid lines -> return null (no valid data extracted)
 *   - Never throws exceptions
 *
 * Error detection:
 *   - tool_result with non-null error -> added to errors array
 *   - Only explicit error fields are captured (no keyword matching on output text)
 *
 * Test points: 16 unit tests covering all parsing rules, edge cases,
 * and error handling.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseTranscriptFile } from '../../src/capture/transcript-parser';
import type { TranscriptMessage } from '../../src/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

/**
 * Writes an array of objects as JSONL to a temporary file and returns the
 * file path. Each object is serialized as a single JSON line.
 */
function writeTmpJsonl(lines: unknown[]): string {
  const content = lines.map((line) => JSON.stringify(line)).join('\n');
  const filePath = path.join(tmpDir, `transcript-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Writes raw string content to a temporary file. Useful for testing
 * malformed JSONL (invalid JSON lines).
 */
function writeTmpRaw(content: string): string {
  const filePath = path.join(tmpDir, `transcript-raw-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-transcript-test-'));
});

afterEach(() => {
  // Clean up all temp files
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TranscriptParser - parseTranscriptFile', () => {
  // =========================================================================
  // Basic parsing
  // =========================================================================
  describe('Basic message parsing', () => {
    // Test 1: Parse valid JSONL with user and assistant messages
    it('should parse valid JSONL into a correct TranscriptData structure', () => {
      // Arrange
      const lines = [
        { type: 'human', message: { role: 'user', content: 'Why is my build failing?' } },
        { type: 'assistant', message: { role: 'assistant', content: 'Let me check the build logs.' }, tool_calls: [] },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.messages).toBeDefined();
      expect(result!.toolCalls).toBeDefined();
      expect(result!.errors).toBeDefined();
      expect(Array.isArray(result!.messages)).toBe(true);
      expect(Array.isArray(result!.toolCalls)).toBe(true);
      expect(Array.isArray(result!.errors)).toBe(true);
      expect(result!.messages).toHaveLength(2);
    });

    // Test 2: User messages extracted with role='user' and correct content
    it('should extract user messages with role="user" and correct content', () => {
      // Arrange
      const lines = [
        { type: 'human', message: { role: 'user', content: 'Fix the failing test' } },
        { type: 'human', message: { role: 'user', content: 'Still broken, try again' } },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0].role).toBe('user');
      expect(result!.messages[0].content).toBe('Fix the failing test');
      expect(result!.messages[1].role).toBe('user');
      expect(result!.messages[1].content).toBe('Still broken, try again');
    });

    // Test 3: Assistant messages extracted with role='assistant' and correct content
    it('should extract assistant messages with role="assistant" and correct content', () => {
      // Arrange
      const lines = [
        { type: 'assistant', message: { role: 'assistant', content: 'I will investigate the issue.' }, tool_calls: [] },
        { type: 'assistant', message: { role: 'assistant', content: 'The problem is in the config.' }, tool_calls: [] },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0].role).toBe('assistant');
      expect(result!.messages[0].content).toBe('I will investigate the issue.');
      expect(result!.messages[1].role).toBe('assistant');
      expect(result!.messages[1].content).toBe('The problem is in the config.');
    });
  });

  // =========================================================================
  // Tool call extraction
  // =========================================================================
  describe('Tool call extraction', () => {
    // Test 4: Tool call extraction from tool_use entries (name, input, output)
    it('should extract tool calls from tool_use entries with name, input, and output', () => {
      // Arrange
      const lines = [
        { type: 'tool_use', name: 'Bash', input: { command: 'npm run build' }, output: 'Build succeeded' },
        { type: 'tool_use', name: 'Read', input: { path: 'src/index.ts' }, output: 'file contents...' },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.toolCalls).toHaveLength(2);
      expect(result!.toolCalls[0].name).toBe('Bash');
      expect(result!.toolCalls[0].input).toEqual({ command: 'npm run build' });
      expect(result!.toolCalls[0].output).toBe('Build succeeded');
      expect(result!.toolCalls[1].name).toBe('Read');
      expect(result!.toolCalls[1].input).toEqual({ path: 'src/index.ts' });
    });

    // Test 13: Tool calls from assistant message's tool_calls array
    it('should extract tool calls from assistant message tool_calls array', () => {
      // Arrange
      const lines = [
        {
          type: 'assistant',
          message: { role: 'assistant', content: 'Let me read the file.' },
          tool_calls: [
            { name: 'Read', input: { path: 'src/main.ts' } },
          ],
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      // The assistant message itself should be in messages
      expect(result!.messages).toHaveLength(1);
      expect(result!.messages[0].role).toBe('assistant');
      // The tool_calls from the assistant entry should be extracted
      expect(result!.toolCalls).toHaveLength(1);
      expect(result!.toolCalls[0].name).toBe('Read');
      expect(result!.toolCalls[0].input).toEqual({ path: 'src/main.ts' });
    });

    // Test 14: Multiple tool calls in a single assistant message
    it('should extract multiple tool calls from a single assistant message', () => {
      // Arrange
      const lines = [
        {
          type: 'assistant',
          message: { role: 'assistant', content: 'Let me check both files.' },
          tool_calls: [
            { name: 'Read', input: { path: 'package.json' } },
            { name: 'Read', input: { path: 'tsconfig.json' } },
            { name: 'Bash', input: { command: 'ls -la' } },
          ],
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.toolCalls).toHaveLength(3);
      expect(result!.toolCalls[0].name).toBe('Read');
      expect(result!.toolCalls[1].name).toBe('Read');
      expect(result!.toolCalls[2].name).toBe('Bash');
    });
  });

  // =========================================================================
  // Error detection
  // =========================================================================
  describe('Error detection', () => {
    // Test 5: Tool result with error field -> added to errors array
    it('should add tool_result errors to the errors array when error field is non-null', () => {
      // Arrange
      const lines = [
        { type: 'tool_result', name: 'Bash', output: '', error: 'Permission denied: /etc/shadow' },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.errors).toHaveLength(1);
      expect(result!.errors[0]).toContain('Permission denied');
    });

    // Test 6: No keyword matching on tool output text
    it('should NOT detect errors from output text alone (no keyword matching)', () => {
      // Arrange: tool outputs containing text that looks like errors, but no explicit error field
      const lines = [
        { type: 'human', message: { role: 'user', content: 'Run the build' } },
        { type: 'tool_result', name: 'Bash', output: 'Error: Module not found', error: null },
        { type: 'tool_result', name: 'Bash', output: 'TypeError: Cannot read properties of undefined', error: null },
        { type: 'tool_result', name: 'Bash', output: 'ENOENT: no such file or directory', error: null },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert: no errors detected since there's no explicit error field
      // (LLM handles error detection at review time, not regex)
      expect(result).not.toBeNull();
      expect(result!.errors).toHaveLength(0);
    });

    // Additional: orphan tool_result with null error and clean output -> no errors, no toolCalls
    it('should not add errors when orphan tool_result has null error and clean output', () => {
      // Arrange: orphan tool_results (no matching tool_use) are not added to toolCalls
      // Need at least one message for non-null result
      const lines = [
        { type: 'human', message: { role: 'user', content: 'check build' } },
        { type: 'tool_result', name: 'Bash', output: 'Success! Build completed.', error: null },
        { type: 'tool_result', name: 'Read', output: 'const x = 42;', error: null },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.errors).toHaveLength(0);
    });

    // Additional: tool_result with both error field and error-like output text
    it('should only capture explicit error field, not patterns in output text', () => {
      // Arrange: error field is set AND output also contains error-like text
      const lines = [
        {
          type: 'tool_result',
          name: 'Bash',
          output: 'Error: command failed with exit code 1',
          error: 'Process exited with code 1',
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert: only the explicit error field is captured, not the output text
      expect(result).not.toBeNull();
      expect(result!.errors).toHaveLength(1);
      expect(result!.errors[0]).toBe('Process exited with code 1');
    });
  });

  // =========================================================================
  // File handling edge cases
  // =========================================================================
  describe('File handling edge cases', () => {
    // Test 7: Empty file -> null
    it('should return null for an empty file', () => {
      // Arrange
      const filePath = writeTmpRaw('');

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).toBeNull();
    });

    // Test 8: Non-existent file -> null
    it('should return null for a non-existent file', () => {
      // Arrange
      const nonExistentPath = path.join(tmpDir, 'does-not-exist.jsonl');

      // Act
      const result = parseTranscriptFile(nonExistentPath);

      // Assert
      expect(result).toBeNull();
    });

    // Test 8 (additional): parseTranscriptFile never throws
    it('should never throw an exception for a non-existent file', () => {
      // Arrange
      const nonExistentPath = '/tmp/sentinel-absolutely-does-not-exist-12345.jsonl';

      // Act & Assert: must not throw, must return null
      expect(() => parseTranscriptFile(nonExistentPath)).not.toThrow();
      const result = parseTranscriptFile(nonExistentPath);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Invalid JSON handling
  // =========================================================================
  describe('Invalid JSON handling', () => {
    // Test 9: Invalid JSON lines -> skip bad lines, parse rest
    it('should skip invalid JSON lines and parse the remaining valid lines', () => {
      // Arrange: mix of valid and invalid JSON
      const raw = [
        JSON.stringify({ type: 'human', message: { role: 'user', content: 'Hello' } }),
        'this is not valid JSON at all!!!',
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi there!' }, tool_calls: [] }),
        '{ broken json',
      ].join('\n');
      const filePath = writeTmpRaw(raw);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert: the 2 valid lines should be parsed, invalid lines skipped
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0].role).toBe('user');
      expect(result!.messages[0].content).toBe('Hello');
      expect(result!.messages[1].role).toBe('assistant');
      expect(result!.messages[1].content).toBe('Hi there!');
    });

    // Test 10: Mixed valid/invalid JSON lines - more complex
    it('should handle multiple interleaved invalid lines without crashing', () => {
      // Arrange
      const raw = [
        '!!!GARBAGE!!!',
        JSON.stringify({ type: 'human', message: { role: 'user', content: 'First question' } }),
        '',  // empty line
        'undefined',
        JSON.stringify({ type: 'tool_use', name: 'Bash', input: { command: 'ls' }, output: 'file1.ts' }),
        '{"incomplete": ',
        JSON.stringify({ type: 'human', message: { role: 'user', content: 'Second question' } }),
      ].join('\n');
      const filePath = writeTmpRaw(raw);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0].content).toBe('First question');
      expect(result!.messages[1].content).toBe('Second question');
      expect(result!.toolCalls).toHaveLength(1);
      expect(result!.toolCalls[0].name).toBe('Bash');
    });

    // Test 12: File with only invalid JSON -> null (no valid data)
    it('should return null when file contains only invalid JSON lines', () => {
      // Arrange
      const raw = [
        'this is not json',
        '{ broken: true, }',
        '!!!',
        '',
        'null but as string',
      ].join('\n');
      const filePath = writeTmpRaw(raw);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert: no valid data could be extracted
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Content preservation
  // =========================================================================
  describe('Content preservation', () => {
    // Test 11: Content preserved correctly
    it('should preserve message content correctly', () => {
      // Arrange
      const lines = [
        { type: 'human', message: { role: 'user', content: 'The build is failing, why is that happening?' } },
        { type: 'assistant', message: { role: 'assistant', content: 'I will check the logs. Let me check the logs.' }, tool_calls: [] },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0].content).toBe('The build is failing, why is that happening?');
      expect(result!.messages[1].content).toBe('I will check the logs. Let me check the logs.');
    });

    // Test 15: Timestamp extraction if present in messages
    it('should extract timestamps from messages when present', () => {
      // Arrange
      const lines = [
        {
          type: 'human',
          message: { role: 'user', content: 'Hello', timestamp: '2026-02-16T12:00:00Z' },
        },
        {
          type: 'assistant',
          message: { role: 'assistant', content: 'Hi', timestamp: '2026-02-16T12:00:01Z' },
          tool_calls: [],
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0].timestamp).toBe('2026-02-16T12:00:00Z');
      expect(result!.messages[1].timestamp).toBe('2026-02-16T12:00:01Z');
    });

    // Additional: Messages without timestamps should have undefined timestamp
    it('should leave timestamp undefined when not present in messages', () => {
      // Arrange
      const lines = [
        { type: 'human', message: { role: 'user', content: 'Hello' } },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.messages[0].timestamp).toBeUndefined();
    });
  });

  // =========================================================================
  // Large transcript
  // =========================================================================
  describe('Large transcript handling', () => {
    // Test 16: Large transcript (many lines) parsed correctly
    it('should parse a large transcript with many lines correctly', () => {
      // Arrange: generate 500 lines of alternating user/assistant messages
      const lines: object[] = [];
      for (let i = 0; i < 250; i++) {
        lines.push({ type: 'human', message: { role: 'user', content: `User message ${i}` } });
        lines.push({
          type: 'assistant',
          message: { role: 'assistant', content: `Assistant response ${i}` },
          tool_calls: [],
        });
      }
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(500);
      // Verify first and last messages
      expect(result!.messages[0].role).toBe('user');
      expect(result!.messages[0].content).toBe('User message 0');
      expect(result!.messages[499].role).toBe('assistant');
      expect(result!.messages[499].content).toBe('Assistant response 249');
    });
  });

  // =========================================================================
  // Full integration scenario
  // =========================================================================
  describe('Full transcript integration', () => {
    it('should correctly parse a realistic Claude Code transcript with all entry types', () => {
      // Arrange: simulate a realistic multi-turn session
      const lines = [
        { type: 'human', message: { role: 'user', content: 'Why is my build failing?' } },
        {
          type: 'assistant',
          message: { role: 'assistant', content: 'Let me check the build logs.' },
          tool_calls: [{ name: 'Bash', input: { command: 'npm run build' } }],
        },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm run build' }, output: 'Error: Module not found: ./missing-module' },
        { type: 'tool_result', name: 'Bash', output: 'Error: Module not found: ./missing-module', error: null },
        {
          type: 'assistant',
          message: { role: 'assistant', content: 'The build is failing because a module is missing. Let me check the import.' },
          tool_calls: [{ name: 'Read', input: { path: 'src/index.ts' } }],
        },
        { type: 'tool_use', name: 'Read', input: { path: 'src/index.ts' }, output: 'import { foo } from "./missing-module";' },
        { type: 'tool_result', name: 'Read', output: 'import { foo } from "./missing-module";', error: null },
        { type: 'human', message: { role: 'user', content: 'Can you fix it?' } },
        {
          type: 'assistant',
          message: { role: 'assistant', content: 'The import references a file that does not exist. I will create it.' },
          tool_calls: [],
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert: structure
      expect(result).not.toBeNull();

      // Messages: 2 human + 3 assistant = 5
      expect(result!.messages).toHaveLength(5);
      const userMessages: TranscriptMessage[] = result!.messages.filter(
        (m: TranscriptMessage) => m.role === 'user',
      );
      const assistantMessages: TranscriptMessage[] = result!.messages.filter(
        (m: TranscriptMessage) => m.role === 'assistant',
      );
      expect(userMessages).toHaveLength(2);
      expect(assistantMessages).toHaveLength(3);

      // Tool calls: 2 from tool_use + tool_calls from assistant entries
      // At minimum we expect the tool_use entries
      expect(result!.toolCalls.length).toBeGreaterThanOrEqual(2);

      // Errors: only explicit error fields are captured (no regex on output text)
      // The tool_result entries in this test have error: null, so no errors captured
      expect(result!.errors).toHaveLength(0);
    });
  });

  // =========================================================================
  // Never-throw guarantee
  // =========================================================================
  describe('Never-throw guarantee', () => {
    it('should return null instead of throwing for any corrupted input scenario', () => {
      // Arrange: various pathological inputs
      const scenarios = [
        '',                            // empty
        '\n\n\n',                      // only newlines
        'null',                        // JSON null
        '[]',                          // JSON array
        '"just a string"',             // JSON string
        '42',                          // JSON number
        'true',                        // JSON boolean
      ];

      for (const content of scenarios) {
        const filePath = writeTmpRaw(content);

        // Act & Assert: must not throw
        expect(() => parseTranscriptFile(filePath)).not.toThrow();
      }
    });

    it('should handle a file containing valid JSON objects but with unknown type fields', () => {
      // Arrange: valid JSON but unrecognized type values
      const lines = [
        { type: 'unknown_type', data: 'something' },
        { type: 'system_event', payload: { event: 'started' } },
        { type: 'human', message: { role: 'user', content: 'Valid message' } },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert: unknown types should be skipped, valid ones parsed
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(1);
      expect(result!.messages[0].content).toBe('Valid message');
    });
  });

  // =========================================================================
  // Tool use/result pairing
  // =========================================================================
  describe('Tool use/result pairing', () => {
    // Test: Paired tool_use and tool_result merge correctly
    // When an assistant message contains a tool_use block with an id, and a
    // subsequent user message contains a tool_result with matching tool_use_id,
    // the output should be merged into the single toolCall entry.
    it('should merge paired tool_use and tool_result into a single toolCall entry', () => {
      // Arrange: assistant message with tool_use (id: "toolu_abc") in content array,
      // followed by user message with tool_result (tool_use_id: "toolu_abc")
      const lines = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check the directory.' },
              { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'ls' } },
            ],
          },
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_abc', content: 'file1.ts\nfile2.ts' },
            ],
          },
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      // Only 1 toolCall entry (the tool_use), with the tool_result output merged in
      expect(result!.toolCalls).toHaveLength(1);
      expect(result!.toolCalls[0].name).toBe('Bash');
      expect(result!.toolCalls[0].input).toEqual({ command: 'ls' });
      expect(result!.toolCalls[0].output).toBe('file1.ts\nfile2.ts');
    });

    // Test: Multiple tool_use/tool_result pairs
    // Two tool_use blocks with different ids, followed by two matching tool_results.
    // Each tool_result merges into its corresponding tool_use entry.
    it('should merge multiple tool_use/tool_result pairs correctly by id', () => {
      // Arrange: assistant message with 2 tool_use blocks, user message with 2 tool_results
      const lines = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check both.' },
              { type: 'tool_use', id: 'toolu_001', name: 'Bash', input: { command: 'pwd' } },
              { type: 'tool_use', id: 'toolu_002', name: 'Read', input: { path: 'package.json' } },
            ],
          },
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_001', content: '/home/user/project' },
              { type: 'tool_result', tool_use_id: 'toolu_002', content: '{"name":"my-app"}' },
            ],
          },
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.toolCalls).toHaveLength(2);
      // First tool_use paired with first tool_result
      expect(result!.toolCalls[0].name).toBe('Bash');
      expect(result!.toolCalls[0].input).toEqual({ command: 'pwd' });
      expect(result!.toolCalls[0].output).toBe('/home/user/project');
      // Second tool_use paired with second tool_result
      expect(result!.toolCalls[1].name).toBe('Read');
      expect(result!.toolCalls[1].input).toEqual({ path: 'package.json' });
      expect(result!.toolCalls[1].output).toBe('{"name":"my-app"}');
    });

    // Test: Orphan tool_result (no matching tool_use) is NOT added to toolCalls
    // A tool_result whose tool_use_id doesn't match any registered tool_use
    // should not create a new entry in toolCalls.
    it('should not add orphan tool_result to toolCalls when no matching tool_use exists', () => {
      // Arrange: a user message for non-null result, then a user message with
      // a tool_result referencing a tool_use_id that was never registered
      const lines = [
        {
          type: 'human',
          message: { role: 'user', content: 'Check the build' },
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_nonexistent', content: 'some output' },
            ],
          },
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      // The orphan tool_result should NOT create a toolCall entry
      expect(result!.toolCalls).toHaveLength(0);
    });

    // Test: Orphan tool_result content text is NOT scanned for keywords
    it('should NOT detect errors from orphan tool_result content text (no keyword matching)', () => {
      // Arrange: orphan tool_result with error-like text in content but no explicit error field
      const lines = [
        {
          type: 'human',
          message: { role: 'user', content: 'Run the tests' },
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_orphan', content: 'Error: ENOENT: no such file or directory' },
            ],
          },
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.toolCalls).toHaveLength(0);
      // No errors: content text is not scanned for keywords
      expect(result!.errors).toHaveLength(0);
    });

    // Test: Standalone tool_result entry pairs with tool_use in content
    // A top-level {"type": "tool_result", "tool_use_id": "toolu_xyz", "output": "..."}
    // entry should merge into a tool_use that was previously registered via content array.
    it('should merge standalone tool_result entry into matching tool_use from content array', () => {
      // Arrange: assistant message with tool_use in content (id: "toolu_xyz"),
      // followed by a standalone tool_result entry at the top level
      const lines = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me run that command.' },
              { type: 'tool_use', id: 'toolu_xyz', name: 'Bash', input: { command: 'npm test' } },
            ],
          },
        },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_xyz',
          output: 'All 42 tests passed',
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      // Only 1 toolCall (from the tool_use), with output merged from standalone tool_result
      expect(result!.toolCalls).toHaveLength(1);
      expect(result!.toolCalls[0].name).toBe('Bash');
      expect(result!.toolCalls[0].input).toEqual({ command: 'npm test' });
      expect(result!.toolCalls[0].output).toBe('All 42 tests passed');
    });

    // Test: tool_result in content array without tool_use_id is treated as orphan
    // A tool_result block in a user message content array that has no tool_use_id
    // field should not create a new toolCall entry.
    it('should treat tool_result without tool_use_id as orphan and not add to toolCalls', () => {
      // Arrange: a human message for non-null result, then a user message with
      // a tool_result that has no tool_use_id field at all
      const lines = [
        {
          type: 'human',
          message: { role: 'user', content: 'Check status' },
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', content: 'some output without tool_use_id' },
            ],
          },
        },
      ];
      const filePath = writeTmpJsonl(lines);

      // Act
      const result = parseTranscriptFile(filePath);

      // Assert
      expect(result).not.toBeNull();
      // No tool_use_id means no pairing possible -> no toolCall entry created
      expect(result!.toolCalls).toHaveLength(0);
    });
  });
});
