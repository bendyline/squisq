import { describe, expect, it } from 'vitest';

import type { ContentContainer } from '@bendyline/squisq/storage';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildNarrationScript } from '@bendyline/squisq/narration';
import { computeAudioTimeline } from '@bendyline/squisq-video';
import {
  createEntryAwareDocumentReader,
  prepareExportDoc,
  prepareExportMarkdown,
  prepareVideoExportDoc,
} from '../exportPreparation.js';

describe('export preparation', () => {
  const source = '# Current draft\n\nUnsaved text.\n';

  it('applies the selected theme to the video/render Doc', () => {
    expect(prepareExportDoc(source, { themeId: 'cinematic' }).themeId).toBe('cinematic');
  });

  it('resolves a saved narration take before preparing the video Doc', async () => {
    const narrationSource = `{[audio src=audio/take.webm anchor=document]}

# Intro

Alpha beta gamma delta epsilon words for the intro block.

# Ending

Lambda mu nu xi omicron words for the ending block.
`;
    const authoredDoc = prepareExportDoc(narrationSource);
    const script = buildNarrationScript(authoredDoc);
    const container = new MemoryContentContainer();
    await container.writeFile('audio/take.webm', new Uint8Array([1, 2, 3]), 'audio/webm');
    await container.writeFile(
      'audio/take.webm.timing.json',
      new TextEncoder().encode(
        JSON.stringify({
          version: 3,
          sourceText: script.sourceText,
          duration: 42,
          bookmarks: [],
          blocks: [],
        }),
      ),
      'application/json',
    );

    const prepared = await prepareVideoExportDoc(
      narrationSource,
      { themeId: 'cinematic' },
      container,
    );

    expect(prepared.duration).toBe(42);
    expect(prepared.themeId).toBe('cinematic');
    expect(prepared.documentMedia?.[0]?.src).toBe('audio/take.webm');
    expect(computeAudioTimeline(prepared)).toEqual([
      {
        src: 'audio/take.webm',
        startSec: 0,
        sourceInSec: 0,
        durationSec: 42,
      },
    ]);
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
