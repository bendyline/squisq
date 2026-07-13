import { describe, expect, it } from 'vitest';

import type { ContentContainer } from '@bendyline/squisq/storage';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  createEntryAwareDocumentReader,
  prepareExportDoc,
  prepareExportMarkdown,
} from '../exportPreparation.js';

describe('export preparation', () => {
  const source = '# Current draft\n\nUnsaved text.\n';

  it('applies the selected theme to the video/render Doc', () => {
    expect(prepareExportDoc(source, { themeId: 'cinematic' }).themeId).toBe('cinematic');
  });

  it('does not apply a hidden transform to plain semantic HTML', () => {
    const prepared = prepareExportMarkdown(source, {
      transformStyle: 'documentary',
      themeId: 'cinematic',
      applyTransform: false,
    });
    expect(prepared.children).toEqual(parseMarkdown(source).children);
    expect(prepared.frontmatter).toEqual({ 'squisq-theme': 'cinematic' });
  });

  it('uses the live entry buffer while loading linked siblings from storage', async () => {
    const stored = new TextEncoder().encode('# Stale entry').buffer;
    const sibling = new TextEncoder().encode('# Sibling').buffer;
    const container = {
      readFile: async (path: string) => (path === 'index.md' ? stored : sibling),
    } as unknown as ContentContainer;
    const read = createEntryAwareDocumentReader(container, './index.md', source);

    await expect(read('index.md')).resolves.toBe(source);
    await expect(read('chapters/one.md')).resolves.toBe('# Sibling');
  });
});
