import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { tiptapToMarkdown } from '../tiptapBridge';
import { LinkWithTitle } from '../WysiwygEditor';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { DATA_CARD_KEY, DataCardExtension } from '../dataCard/DataCardExtension';
import { buildSquisqMediaReference, fileReference } from '../mediaDragMime';
import {
  addFileToDocument,
  insertDataReference,
  type MediaInsertionTarget,
} from '../mediaInsertion';
import { partitionFiles, resolveDocBasename } from '../utils/dropUtils';

/**
 * Insert → File: a data file becomes a sidecar reference block, media embeds
 * as Image/Media does, and anything else is stored and linked by name.
 */

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function makeEditor(content = '<p>Intro text</p>'): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      LinkWithTitle.configure({ openOnClick: false, autolink: false }),
      DataCardExtension.configure({ mediaProvider: () => null, mediaRevision: () => 0 }),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

function wysiwyg(editor: Editor): MediaInsertionTarget {
  return {
    activeView: 'wysiwyg',
    tiptapEditor: editor,
    monacoEditor: null,
    appendMarkdown: vi.fn(),
  };
}

/** Just enough of a Monaco editor for an insertion over `lines`. */
function fakeMonaco(lines: string[], line: number, column: number) {
  const edits: string[] = [];
  const range = {
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: column,
  };
  const monaco = {
    getSelection: () => range,
    getModel: () => ({
      getLineContent: (n: number) => lines[n - 1] ?? '',
      getLineCount: () => lines.length,
    }),
    executeEdits: (_source: string, ops: Array<{ text: string }>) => {
      edits.push(...ops.map((op) => op.text));
      return true;
    },
    focus: () => undefined,
  };
  const target: MediaInsertionTarget = {
    activeView: 'raw',
    tiptapEditor: null,
    monacoEditor: monaco as unknown as MediaInsertionTarget['monacoEditor'],
    appendMarkdown: vi.fn(),
  };
  return { target, edits };
}

/** A MediaProvider that stores files by name in memory. */
function memoryProvider() {
  const stored = new Map<string, { mimeType: string; size: number }>();
  const provider: MediaProvider = {
    async addMedia(name, data, mimeType) {
      const size = data instanceof Blob ? data.size : data.byteLength;
      stored.set(name, { mimeType, size });
      return name;
    },
    async resolveUrl(path) {
      return path;
    },
    async listMedia(): Promise<MediaEntry[]> {
      return [...stored].map(([name, entry]) => ({ name, ...entry }));
    },
    async removeMedia(path) {
      stored.delete(path);
    },
    dispose() {},
  };
  return { provider, stored };
}

/** A File with bytes; jsdom's File lacks arrayBuffer(), so supply it. */
function makeFile(content: string | Uint8Array, name: string, type = ''): File {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const created = new File([bytes.slice()], name, { type });
  if (typeof created.arrayBuffer !== 'function') {
    Object.defineProperty(created, 'arrayBuffer', {
      value: async () => bytes.slice().buffer,
    });
  }
  return created;
}

async function containerFor(docName: string) {
  const container = new MemoryContentContainer();
  await container.writeDocument('# Notes', docName);
  return container;
}

describe('fileReference', () => {
  it('labels a linked file by its full name and media by alt text', () => {
    expect(fileReference('archive.zip', 'archive.zip', 'application/zip')).toEqual({
      name: 'archive.zip',
      mimeType: 'application/zip',
      alt: 'archive.zip',
    });
    expect(fileReference('readings.dat', 'readings.dat', '').alt).toBe('readings.dat');
    expect(fileReference('my_photo.png', 'my_photo.png', 'image/png').alt).toBe('my photo');
  });
});

describe('references to awkward file names', () => {
  it('uses the angle-bracket destination for a path with spaces', () => {
    const link = fileReference('Q3 Report.zip', 'Q3 Report.zip', 'application/zip');
    expect(buildSquisqMediaReference(link)).toBe('[Q3 Report.zip](<Q3 Report.zip>)');
    const image = fileReference('media/Screen Shot.png', 'Screen Shot.png', 'image/png');
    expect(buildSquisqMediaReference(image)).toBe('![Screen Shot](<media/Screen Shot.png>)');
  });

  it('escapes brackets in the label and keeps balanced parentheses bare', () => {
    const link = fileReference('v(2).zip', 'draft [v2].zip', 'application/zip');
    expect(buildSquisqMediaReference(link)).toBe('[draft \\[v2\\].zip](v(2).zip)');
  });
});

describe('insertDataReference', () => {
  it('writes a data-table heading and a body link the data card claims', () => {
    const editor = makeEditor();
    editor.commands.focus('end');
    insertDataReference(wysiwyg(editor), 'notes_files/data/q3.csv', 'q3.csv');
    const md = tiptapToMarkdown(editor.getHTML());
    expect(md).toContain('Intro text');
    expect(md).toContain('## q3 {[dataTable src=notes_files/data/q3.csv]}');
    expect(md).toContain('[q3.csv](notes_files/data/q3.csv)');
    expect(DATA_CARD_KEY.getState(editor.state)?.entries).toHaveLength(1);
  });

  it('takes the place of the empty line the caret is on', () => {
    const editor = makeEditor('<p>Intro text</p><p></p>');
    editor.commands.focus('end');
    insertDataReference(wysiwyg(editor), 'notes_files/data/q3.csv', 'q3.csv');
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'paragraph',
      'heading',
      'paragraph',
    ]);
  });

  it('starts the heading on its own line in the Source view', () => {
    const { target, edits } = fakeMonaco(['Intro text', 'More prose'], 1, 6);
    insertDataReference(target, 'notes_files/data/Q3 sales.csv', 'Q3 sales.csv');
    expect(edits).toEqual([
      '\n\n## Q3 sales {[dataTable src="notes_files/data/Q3 sales.csv"]}\n\n' +
        '[Q3 sales.csv](<notes_files/data/Q3 sales.csv>)\n\n',
    ]);
  });
});

describe('addFileToDocument', () => {
  it('stores a CSV in the document’s data sidecar folder and references it', async () => {
    const { provider, stored } = memoryProvider();
    const editor = makeEditor();
    editor.commands.focus('end');
    const file = makeFile('Item,Qty\nwidget,2\n', 'q3.csv', 'text/csv');
    const path = await addFileToDocument(file, wysiwyg(editor), {
      mediaProvider: provider,
      workspaceContainer: await containerFor('notes.md'),
    });
    expect(path).toBe('notes_files/data/q3.csv');
    expect(stored.get('notes_files/data/q3.csv')?.mimeType).toBe('text/csv');
    expect(tiptapToMarkdown(editor.getHTML())).toContain(
      '## q3 {[dataTable src=notes_files/data/q3.csv]}',
    );
  });

  it('stores an XLSX as a sidecar too', async () => {
    const { provider } = memoryProvider();
    const { target, edits } = fakeMonaco([''], 1, 1);
    const file = makeFile(new Uint8Array([0x50, 0x4b, 3, 4]), 'budget.xlsx');
    const path = await addFileToDocument(file, target, { mediaProvider: provider });
    // No container: the sidecar falls back to `document_files/`.
    expect(path).toBe('document_files/data/budget.xlsx');
    expect(edits[0]).toContain('{[dataTable src=document_files/data/budget.xlsx]}');
  });

  it('stores any other file beside the document and links it by name', async () => {
    const { provider, stored } = memoryProvider();
    const editor = makeEditor();
    editor.commands.focus('end');
    const file = makeFile(new Uint8Array([1, 2, 3]), 'readings.dat');
    const path = await addFileToDocument(file, wysiwyg(editor), { mediaProvider: provider });
    expect(path).toBe('readings.dat');
    expect(stored.get('readings.dat')?.mimeType).toBe('application/octet-stream');
    expect(tiptapToMarkdown(editor.getHTML())).toContain('[readings.dat](readings.dat)');
  });

  it('links a file whose name has spaces with a destination that stays one link', async () => {
    const { provider } = memoryProvider();
    const editor = makeEditor();
    editor.commands.focus('end');
    const file = makeFile(new Uint8Array([1]), 'Q3 Report.zip', 'application/zip');
    await addFileToDocument(file, wysiwyg(editor), { mediaProvider: provider });
    expect(tiptapToMarkdown(editor.getHTML())).toContain('[Q3 Report.zip](<Q3 Report.zip>)');
  });

  it('embeds media the way Image/Media does', async () => {
    const { provider } = memoryProvider();
    const { target, edits } = fakeMonaco([''], 1, 1);
    const file = makeFile(new Uint8Array([1]), 'take.flac');
    await addFileToDocument(file, target, { mediaProvider: provider });
    expect(edits).toEqual(['<audio src="take.flac" controls></audio>']);
  });

  it('inserts nothing when the file cannot be read', async () => {
    const { provider, stored } = memoryProvider();
    const { target, edits } = fakeMonaco([''], 1, 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = await addFileToDocument(makeFile(new Uint8Array(), 'empty.zip'), target, {
      mediaProvider: provider,
    });
    warn.mockRestore();
    expect(path).toBeNull();
    expect(stored.size).toBe(0);
    expect(edits).toEqual([]);
  });
});

describe('drop helpers', () => {
  it('keeps files of no known kind in an `other` bucket instead of dropping them', () => {
    const files = [
      new File(['x'], 'photo.png', { type: 'image/png' }),
      new File(['x'], 'q3.csv', { type: 'text/csv' }),
      new File(['x'], 'notes.md', { type: 'text/markdown' }),
      new File(['x'], 'archive.zip', { type: 'application/zip' }),
      new File(['x'], 'readings.dat', { type: '' }),
    ];
    const { media, data, text, other } = partitionFiles(files);
    expect(media.map((f) => f.name)).toEqual(['photo.png']);
    expect(data.map((f) => f.name)).toEqual(['q3.csv']);
    expect(text.map((f) => f.name)).toEqual(['notes.md']);
    expect(other.map((f) => f.name)).toEqual(['archive.zip', 'readings.dat']);
  });

  it('resolves the sidecar base name from the container', async () => {
    expect(await resolveDocBasename(await containerFor('notes.md'))).toBe('notes');
    expect(await resolveDocBasename(new MemoryContentContainer())).toBe('document');
    expect(await resolveDocBasename(null)).toBe('document');
  });
});
