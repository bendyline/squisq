import { describe, expect, it } from 'vitest';
import { buildReviewRequest, changedBlockKeys } from '../buildRequest.js';

const DOC = [
  '# Title',
  '',
  'First paragraph.',
  '',
  '## Section',
  '',
  'Second paragraph with `code` in it.',
  '',
  '```js',
  'const secret = 1;',
  '```',
  '',
  'Third paragraph.',
  '',
].join('\n');

const REF = { articleId: 'a' };

describe('buildReviewRequest', () => {
  it('keeps every block offset indexing the real source', () => {
    // Masking is equal-length, so a finding reported against masked text still
    // points at the right characters of the document.
    const request = buildReviewRequest({ source: DOC, documentRef: REF });
    for (const block of request.blocks) {
      expect(block.text.length).toBe(
        DOC.slice(block.offset, block.offset + block.text.length).length,
      );
      expect(request.source.slice(block.offset, block.offset + block.text.length)).toHaveLength(
        block.text.length,
      );
    }
  });

  it('masks code so a reviewer never rewrites it', () => {
    const request = buildReviewRequest({ source: DOC, documentRef: REF });
    const everything = request.blocks.map((block) => block.text).join('\n');
    expect(everything).not.toContain('const secret');
    expect(everything).not.toContain('`code`');
    // Prose around the masked span survives.
    expect(everything).toContain('Second paragraph with');
  });

  it('splits on headings, which is the unit the editor already navigates', () => {
    // A block here is a heading-delimited section rather than a paragraph.
    // That is also the better review unit: "does this section make its case?"
    const request = buildReviewRequest({ source: DOC, documentRef: REF });
    expect(request.blocks).toHaveLength(2);
    expect(request.blocks[0]?.text).toContain('First paragraph');
    expect(request.blocks[1]?.text).toContain('Third paragraph');
  });

  it('labels each section with its own heading', () => {
    const request = buildReviewRequest({ source: DOC, documentRef: REF });
    expect(request.blocks[0]?.heading).toBe('Title');
    expect(request.blocks[1]?.heading).toBe('Section');
  });

  it('reports a start line that matches the source', () => {
    const request = buildReviewRequest({ source: DOC, documentRef: REF });
    for (const block of request.blocks) {
      const line = DOC.split('\n')[block.startLine - 1] ?? '';
      expect(block.text.startsWith(line.slice(0, 5))).toBe(true);
    }
  });

  it('sends no block for an empty document', () => {
    // The slicer yields one empty slice; a provider gains nothing from it.
    expect(buildReviewRequest({ source: '', documentRef: REF }).blocks).toEqual([]);
  });

  it('drops a section that is nothing but masked code', () => {
    const codeOnly = ['```js', 'const secret = 1;', '```', ''].join('\n');
    expect(buildReviewRequest({ source: codeOnly, documentRef: REF }).blocks).toEqual([]);
  });
});

describe('changedBlockKeys', () => {
  it('names only the blocks whose text moved', () => {
    const before = buildReviewRequest({ source: DOC, documentRef: REF }).blocks;
    const after = buildReviewRequest({
      source: DOC.replace('Third paragraph.', 'Third paragraph, revised.'),
      documentRef: REF,
    }).blocks;
    const changed = changedBlockKeys(before, after);
    expect(changed.length).toBeGreaterThan(0);
    for (const key of changed) {
      expect(after[key]?.text).not.toBe(before[key]?.text);
    }
  });

  it('reports nothing for an untouched document', () => {
    const blocks = buildReviewRequest({ source: DOC, documentRef: REF }).blocks;
    expect(changedBlockKeys(blocks, blocks)).toEqual([]);
  });
});
