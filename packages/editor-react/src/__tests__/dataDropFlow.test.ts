/**
 * Data-sidecar drop flow: dropped csv/tsv/xlsx/parquet files classify as
 * `'data'` (they used to be silently DISCARDED — `partitionFiles` had no
 * bucket for them), land under the doc's `_files/data/` prefix via
 * `processDataFiles`, and the reference snippet the shell inserts round-trips
 * through the tiptap bridge with its `{[dataTable src=…]}` annotation intact.
 */

import { describe, expect, it } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { dataSidecarPrefix } from '@bendyline/squisq/doc';
import { classifyFile, partitionFiles, processDataFiles } from '../utils/dropUtils';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

function file(name: string, type = ''): File {
  const created = new File(['Region,Revenue\nNorth,1200\n'], name, type ? { type } : undefined);
  // jsdom's File lacks arrayBuffer(); the browser path is exercised in e2e.
  if (typeof created.arrayBuffer !== 'function') {
    Object.defineProperty(created, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('Region,Revenue\nNorth,1200\n').buffer,
    });
  }
  return created;
}

function fakeMediaProvider(store: Map<string, ArrayBuffer>): MediaProvider {
  return {
    async addMedia(name, data, _mime) {
      store.set(name, data instanceof ArrayBuffer ? data : new Uint8Array(0).buffer);
      return name;
    },
    async resolveUrl(relPath) {
      return relPath;
    },
    async listMedia() {
      return [...store.keys()].map((name) => ({ name, mimeType: 'text/csv', size: 1 }));
    },
    async removeMedia() {
      /* no-op */
    },
    dispose() {
      /* no-op */
    },
  };
}

describe('classifyFile data category', () => {
  it('classifies by extension', () => {
    expect(classifyFile({ name: 'q3.csv', type: '' })).toBe('data');
    expect(classifyFile({ name: 'q3.TSV', type: '' })).toBe('data');
    expect(classifyFile({ name: 'book.xlsx', type: '' })).toBe('data');
    expect(classifyFile({ name: 'm.parquet', type: '' })).toBe('data');
  });

  it('falls back to data MIME types', () => {
    expect(classifyFile({ name: 'noext', type: 'text/csv' })).toBe('data');
    expect(
      classifyFile({
        name: 'noext',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ).toBe('data');
    expect(classifyFile({ name: 'noext', type: 'application/vnd.ms-excel' })).toBe('data');
  });

  it('keeps media and text classifications unchanged', () => {
    expect(classifyFile({ name: 'a.png', type: '' })).toBe('media');
    expect(classifyFile({ name: 'a.md', type: '' })).toBe('text');
    expect(classifyFile({ name: 'a.bin', type: '' })).toBe('unknown');
  });
});

describe('partitionFiles', () => {
  it('buckets data files instead of discarding them', () => {
    const { media, text, data } = partitionFiles([
      file('hero.png', 'image/png'),
      file('notes.md', 'text/markdown'),
      file('q3.csv', 'text/csv'),
      file('mystery.bin'),
    ]);

    expect(media.map((f) => f.name)).toEqual(['hero.png']);
    expect(text.map((f) => f.name)).toEqual(['notes.md']);
    expect(data.map((f) => f.name)).toEqual(['q3.csv']);
  });
});

describe('processDataFiles', () => {
  it('stores files under the sidecar prefix', async () => {
    const store = new Map<string, ArrayBuffer>();
    const provider = fakeMediaProvider(store);

    const paths = await processDataFiles(
      [file('q3.csv', 'text/csv')],
      provider,
      dataSidecarPrefix('report'),
    );

    expect(paths).toEqual(['report_files/data/q3.csv']);
    expect(store.has('report_files/data/q3.csv')).toBe(true);
  });

  it('suffixes on collision instead of overwriting an existing sidecar', async () => {
    const store = new Map<string, ArrayBuffer>();
    store.set('report_files/data/q3.csv', new Uint8Array([1]).buffer);
    const provider = fakeMediaProvider(store);

    const paths = await processDataFiles(
      [file('q3.csv', 'text/csv')],
      provider,
      'report_files/data/',
    );

    expect(paths).toEqual(['report_files/data/q3-1.csv']);
  });
});

describe('data reference snippet round-trip', () => {
  it('survives the tiptap bridge with annotation and link intact', () => {
    // The exact snippet EditorShell.insertDataRef emits in raw/preview mode.
    const snippet =
      '## q3 {[dataTable src=report_files/data/q3.csv]}\n\n[q3.csv](report_files/data/q3.csv)';

    const roundTripped = tiptapToMarkdown(markdownToTiptap(snippet));

    expect(roundTripped).toContain('{[dataTable src=report_files/data/q3.csv]}');
    expect(roundTripped).toContain('[q3.csv](report_files/data/q3.csv)');
  });
});
