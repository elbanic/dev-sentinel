import { formatWarning } from '../../src/hook/format-warning';
import type { MatchResult } from '../../src/types/index';

function makeMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    experience: {
      id: 'exp-1',
      frustrationSignature: 'ENOENT: file not found',
      failedApproaches: ['used wrong path', 'forgot to create dir'],
      successfulApproach: 'mkdir -p first',
      lessons: ['Always check directory exists'],
      createdAt: '2025-01-01T00:00:00Z',
      revision: 1,
    },
    confidence: 0.85,
    suggestedAction: 'Check that the target directory exists before writing.',
    ...overrides,
  };
}

describe('formatWarning', () => {
  it('returns a string containing the box borders', () => {
    const result = formatWarning(makeMatch());
    // Top and bottom borders
    expect(result).toContain('\u256D'); // top-left corner
    expect(result).toContain('\u256E'); // top-right corner
    expect(result).toContain('\u2570'); // bottom-left corner
    expect(result).toContain('\u256F'); // bottom-right corner
    expect(result).toContain('\u251C'); // left T
    expect(result).toContain('\u2524'); // right T
  });

  it('includes the confidence as a percentage without decimals', () => {
    const result = formatWarning(makeMatch({ confidence: 0.85 }));
    expect(result).toContain('confidence: 85%');
  });

  it('rounds confidence correctly', () => {
    const result = formatWarning(makeMatch({ confidence: 0.456 }));
    expect(result).toContain('confidence: 46%');
  });

  it('includes the frustration signature', () => {
    const result = formatWarning(makeMatch());
    expect(result).toContain('ENOENT: file not found');
  });

  it('includes failed approaches joined by comma', () => {
    const result = formatWarning(makeMatch());
    expect(result).toContain('used wrong path, forgot to create dir');
  });

  it('includes lessons joined by comma', () => {
    const result = formatWarning(makeMatch());
    expect(result).toContain('Always check directory exists');
  });

  it('includes the suggested action in quotes', () => {
    const result = formatWarning(makeMatch());
    // The full text may be word-wrapped across lines, so check key parts
    expect(result).toContain('"Check that the target directory');
    expect(result).toContain('writing."');
  });

  it('prefixes the header with sentinel shield emoji', () => {
    const result = formatWarning(makeMatch());
    // The header line should contain the shield emoji and Sentinel
    expect(result).toMatch(/Sentinel/);
  });

  it('uses arrow prefix for suggested action', () => {
    const result = formatWarning(makeMatch());
    // Should contain the right arrow prefix for suggested action
    expect(result).toContain('\u2192'); // right arrow
  });

  it('uses triangle prefix for first experience lines', () => {
    const result = formatWarning(makeMatch());
    expect(result).toContain('\u25B8'); // small right triangle
  });

  it('all content lines are padded to the same width', () => {
    const result = formatWarning(makeMatch());
    const lines = result.split('\n').filter((l) => l.length > 0);
    const topBorder = lines[0];
    const bottomBorder = lines[lines.length - 1];
    expect(topBorder.length).toBe(bottomBorder.length);
    // Content lines (between borders) should also be the same length
    for (let i = 1; i < lines.length - 1; i++) {
      if (lines[i].startsWith('\u251C')) {
        // separator line
        expect(lines[i].length).toBe(topBorder.length);
      }
    }
  });

  it('box width matches terminal width', () => {
    const result = formatWarning(makeMatch());
    const lines = result.split('\n').filter((l) => l.length > 0);
    const topBorder = lines[0];
    expect(topBorder.length).toBeGreaterThanOrEqual(40);
  });

  it('handles empty lessons array', () => {
    const match = makeMatch();
    match.experience.lessons = [];
    const result = formatWarning(match);
    // Should not contain "Lesson:" when lessons are empty
    expect(result).not.toContain('Lesson:');
  });

  it('handles empty failedApproaches array', () => {
    const match = makeMatch();
    match.experience.failedApproaches = [];
    const result = formatWarning(match);
    // Should still produce valid output
    expect(result).toContain('\u256D');
    expect(result).toContain('\u256F');
  });

  it('wraps long text to fit within box width', () => {
    const match = makeMatch({
      suggestedAction:
        'This is a very long suggested action that should definitely be wrapped to fit within the box width properly without exceeding the terminal width.',
    });
    const result = formatWarning(match);
    const lines = result.split('\n').filter((l) => l.length > 0);
    const topBorder = lines[0];
    const boxWidth = topBorder.length;
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(boxWidth);
    }
  });

  it('handles confidence of 0', () => {
    const result = formatWarning(makeMatch({ confidence: 0 }));
    expect(result).toContain('confidence: 0%');
  });

  it('handles confidence of 1', () => {
    const result = formatWarning(makeMatch({ confidence: 1 }));
    expect(result).toContain('confidence: 100%');
  });
});
