/** @vitest-environment jsdom */

/**
 * The "always grid, card as fallback" contract: when the grid module fails
 * to load, the DataCardWidget degrades to the compact preview card instead
 * of an error or a blank rectangle. The grid import is mocked to fail for
 * this whole file — the widget's `import('@bendyline/squisq-grid-react')`
 * rejects, `loadGridModule` resolves null, and the preview path runs.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { markdownToTiptap } from '../tiptapBridge';
import { LinkWithTitle } from '../WysiwygEditor';
import { DATA_CARD_KEY, DataCardExtension } from '../dataCard/DataCardExtension';
import { DataCardWidget } from '../dataCard/DataCardWidget';

vi.mock('@bendyline/squisq-grid-react', () => {
  throw new Error('grid module unavailable');
});

const HREF = 'report_files/data/q3.csv';
const CSV = 'Item,Qty\nwidget,2\ngadget,5\n';

function toDataUrl(text: string): string {
  return `data:text/csv;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
}

function makeProvider(): MediaProvider {
  return {
    async resolveUrl(relativePath: string) {
      return relativePath === HREF ? toDataUrl(CSV) : relativePath;
    },
    async listMedia(): Promise<MediaEntry[]> {
      return [{ name: HREF, mimeType: 'text/csv', size: CSV.length }];
    },
    async addMedia(name: string) {
      return name;
    },
    async removeMedia() {},
    dispose() {},
  };
}

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('DataCardWidget grid fallback', () => {
  it('renders the compact preview card when the grid module fails to load', async () => {
    const markdown = [`## Q3 {[dataTable src=${HREF}]}`, '', `[q3.csv](${HREF})`].join('\n');
    const editor = new Editor({
      extensions: [
        StarterKit,
        LinkWithTitle.configure({ openOnClick: false, autolink: false }),
        DataCardExtension.configure({ mediaProvider: () => null, mediaRevision: () => 0 }),
      ],
      content: markdownToTiptap(markdown),
    });
    editors.push(editor);
    const blockId = DATA_CARD_KEY.getState(editor.state)?.entries[0]?.id;
    expect(blockId).toBeDefined();

    const provider = makeProvider();
    render(
      <DataCardWidget
        editor={editor}
        blockId={blockId!}
        getMediaProvider={() => provider}
        getMediaRevision={() => 0}
      />,
    );

    // Identity strip renders immediately …
    expect(screen.getByText('q3.csv')).toBeTruthy();
    // … and the fallback preview table appears once bytes resolve.
    await waitFor(() => {
      expect(screen.getByText('widget')).toBeTruthy();
    });
    expect(screen.getByText('gadget')).toBeTruthy();
    // No grid mounted anywhere.
    expect(document.querySelector('.squisq-data-card-grid')).toBeNull();
  });
});
