import { describe, expect, it } from 'vitest';
import {
  isMarkdownFencedCodeLine,
  markdownFencedCodeLineMask,
  maskMarkdownFencedCode,
} from '../markdownCodeFence';

describe('markdown fenced-code detection', () => {
  it('marks opening, body, and closing lines without masking surrounding prose', () => {
    const source = [
      'Before {[github]}',
      '```md',
      '## Example {[sectionHeader]}',
      '```',
      'After',
    ].join('\n');

    expect(markdownFencedCodeLineMask(source)).toEqual([false, true, true, true, false]);
    expect(isMarkdownFencedCodeLine(source, 3)).toBe(true);
    expect(isMarkdownFencedCodeLine(source, 5)).toBe(false);
  });

  it('supports tilde fences, longer closers, indentation, and unclosed fences', () => {
    const source = [
      '  ~~~~ts',
      '{[audio src=inside.mp3]}',
      '  ~~~~~',
      'text',
      '```',
      '{[quote]}',
    ].join('\r\n');

    expect(markdownFencedCodeLineMask(source)).toEqual([true, true, true, false, true, true]);
  });

  it('masks fenced contents while preserving offsets and line endings', () => {
    const source = 'Outside\r\n```md\r\n{[image src=inside.png]}\r\n```\r\nAfter';
    const masked = maskMarkdownFencedCode(source);

    expect(masked).toHaveLength(source.length);
    expect(masked).toContain('Outside\r\n');
    expect(masked).not.toContain('inside.png');
    expect(masked.endsWith('\r\nAfter')).toBe(true);
  });
});
