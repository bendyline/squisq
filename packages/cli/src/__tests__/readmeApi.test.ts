import { describe, it } from 'mocha';
import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { FormatId } from '@bendyline/squisq-formats';
import type { ReadInputResult } from '../util/readInput.js';

// This function is compiled with the test suite. If the declaration shape
// drifts, the README contract below stops typechecking before publication.
function assertDocumentedReadInputShape(result: ReadInputResult): void {
  const doc: Doc = result.doc;
  const container: ContentContainer = result.container;
  const markdownDoc: MarkdownDocument | undefined = result.markdownDoc;
  const sourceFormat: FormatId = result.sourceFormat;
  void [doc, container, markdownDoc, sourceFormat];
}

describe('CLI README API declarations', () => {
  it('keeps the documented readInput return shape aligned with its TypeScript declaration', async () => {
    void assertDocumentedReadInputShape;
    const readme = await readFile(join(import.meta.dirname, '..', '..', 'README.md'), 'utf8');
    expect(readme).to.include(
      '`readInput(inputPath)` → `{ doc: Doc, container: ContentContainer, markdownDoc?: MarkdownDocument, sourceFormat: FormatId }`',
    );
    expect(readme).to.not.include('doc?: Doc');
    expect(readme).to.not.include('markdownDoc: MarkdownDocument | null');
    expect(readme).to.not.include('input.doc ?? markdownToDoc');
  });
});
