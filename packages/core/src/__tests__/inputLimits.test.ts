import { describe, expect, it } from 'vitest';
import type { MarkdownBlockNode, MarkdownDocument } from '../markdown/types';
import { parseMarkdown } from '../markdown/parse';
import { stringifyMarkdown } from '../markdown/stringify';
import { alignNarration } from '../narration/align';

describe('untrusted input limits', () => {
  it('rejects oversized Markdown before parsing', () => {
    expect(() => parseMarkdown('abcd', { limits: { maxSourceBytes: 3 } })).toThrow(
      '3-byte safety limit',
    );
  });

  it('rejects a deeply nested tree before recursive serialization', () => {
    let node: MarkdownBlockNode = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'safe' }],
    };
    for (let index = 0; index < 20; index++) {
      node = { type: 'blockquote', children: [node] };
    }
    const doc: MarkdownDocument = { type: 'document', children: [node] };
    expect(() => stringifyMarkdown(doc, { limits: { maxDepth: 10 } })).toThrow(
      'nesting safety limit',
    );
  });

  it('honors an already-aborted parse signal', () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    expect(() => parseMarkdown('# title', { signal: controller.signal })).toThrow('stop');
  });

  it('bounds batch narration alignment before feature allocation', () => {
    expect(() =>
      alignNarration(
        {
          pcm: new Float32Array(4),
          sampleRate: 1,
          script: {
            sourceText: '',
            tokens: [],
            blocks: [],
            cumulativeSyllables: [0],
            totalSyllables: 0,
          },
        },
        { maxPcmSamples: 3 },
      ),
    ).toThrow('sample safety limit');
  });
});
