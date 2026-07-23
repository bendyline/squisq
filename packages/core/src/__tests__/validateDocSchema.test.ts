import { describe, expect, it } from 'vitest';
import { validateDocSchema } from '../schemas/validateDoc.js';

describe('validateDocSchema', () => {
  it('accepts the canonical minimal Doc shape', () => {
    expect(
      validateDocSchema({
        articleId: 'doc',
        duration: 1,
        blocks: [{ id: 'block', startTime: 0, duration: 1, audioSegment: 0 }],
        audio: { segments: [] },
      }),
    ).toEqual([]);
  });

  it('reports malformed block fields recursively with stable paths', () => {
    const issues = validateDocSchema({
      articleId: 'doc',
      duration: 1,
      blocks: [
        {
          id: 'parent',
          startTime: 0,
          duration: 1,
          audioSegment: 0,
          children: [{ id: 42, startTime: 0, duration: 'forever', audioSegment: -1 }],
        },
      ],
      audio: { segments: [] },
    });

    expect(issues.map((issue) => issue.path)).toEqual([
      'blocks[0].children[0].id',
      'blocks[0].children[0].duration',
      'blocks[0].children[0].audioSegment',
    ]);
  });
});
