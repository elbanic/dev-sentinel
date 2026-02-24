/**
 * Unit Tests for buildContextMessage
 *
 * Tests for the buildContextMessage function which formats TranscriptData
 * into a structured text message for LLM consumption.
 */

import { buildContextMessage } from '../../src/capture/note-generator';
import type { TranscriptData } from '../../src/types/index';

// ---------------------------------------------------------------------------
// buildContextMessage - frustrationContext parameter
// ---------------------------------------------------------------------------

describe('buildContextMessage - frustrationContext parameter', () => {
  it('should include Frustration Context section when frustrationContext is provided', () => {
    // Arrange
    const transcript: TranscriptData = {
      messages: [
        { role: 'user', content: 'The tests keep failing' },
        { role: 'assistant', content: 'Let me look into that.' },
      ],
      toolCalls: [],
      errors: [],
    };
    const frustrationContext = {
      prompt: 'Why do my tests keep failing after the refactor?',
      intent: 'debug test failures after code refactoring',
    };

    // Act
    const result = buildContextMessage(transcript, frustrationContext);

    // Assert
    // The output should contain the Frustration Context section header
    expect(result).toContain('\u2500\u2500 Frustration Context \u2500\u2500');
    // The output should contain the intent value
    expect(result).toContain('debug test failures after code refactoring');
    // The output should contain the prompt value
    expect(result).toContain('Why do my tests keep failing after the refactor?');
  });

  it('should NOT include Frustration Context section when frustrationContext is omitted', () => {
    // Arrange
    const transcript: TranscriptData = {
      messages: [
        { role: 'user', content: 'The tests keep failing' },
        { role: 'assistant', content: 'Let me look into that.' },
      ],
      toolCalls: [],
      errors: [],
    };

    // Act - call without the optional frustrationContext parameter
    const result = buildContextMessage(transcript);

    // Assert
    // The output should NOT contain the Frustration Context section header
    expect(result).not.toContain('\u2500\u2500 Frustration Context \u2500\u2500');
  });
});
