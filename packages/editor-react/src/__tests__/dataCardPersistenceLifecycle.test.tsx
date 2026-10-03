/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createInHouseEngine } from '@bendyline/squisq-calc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import {
  markdownDocToXlsx,
  patchXlsxCellValues,
  xlsxToCellGrids,
} from '@bendyline/squisq-formats/xlsx';
import { markdownToTiptap } from '../tiptapBridge';
import { LinkWithTitle } from '../WysiwygEditor';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { DATA_CARD_KEY, DataCardExtension } from '../dataCard/DataCardExtension';
import { DataCardWidget } from '../dataCard/DataCardWidget';

const path = 'book.xlsx';
const editors: Editor[] = [];
const engineFactory = async (config: Parameters<typeof createInHouseEngine>[0]) =>
  createInHouseEngine(config);
beforeAll(() => {
  for (const [name, value] of [
    ['offsetHeight', 420],
    ['offsetWidth', 800],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
});
afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

async function setup() {
  let bytes = await markdownDocToXlsx(
    parseMarkdown(
      '## Sales {[dataTable sheet=Sales anchor=A1]}\n\n| Item | Value |\n| --- | --- |\n| Input | 100 |\n| Total | 0 |\n\n' +
        '## Rates {[dataTable sheet=Rates anchor=A1]}\n\n| Item | Value |\n| --- | --- |\n| Rate | 2 |\n',
    ),
  );
  bytes = await patchXlsxCellValues(bytes, [
    { sheet: 'Sales', ref: 'B3', formula: 'B2*2', cachedValue: 200 },
  ]);
  const provider: MediaProvider = {
    resolveUrl: async () =>
      `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`,
    listMedia: async () => [
      { name: path, size: bytes.byteLength, mimeType: 'application/octet-stream' },
    ],
    addMedia: async (name, data) => {
      bytes =
        data instanceof Blob
          ? await data.arrayBuffer()
          : ArrayBuffer.isView(data)
            ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
            : data;
      return name;
    },
    removeMedia: async () => {},
    dispose() {},
  };
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      LinkWithTitle.configure({ openOnClick: false, autolink: false }),
      DataCardExtension.configure({ mediaProvider: () => null, mediaRevision: () => 0 }),
    ],
    content: markdownToTiptap(
      `## Sales {[dataTable src=${path} sheet=Sales anchor=A1]}\n\n[book](${path})`,
    ),
  });
  editors.push(editor);
  const blockId = DATA_CARD_KEY.getState(editor.state)!.entries[0]!.id;
  const onSaved = vi.fn();
  const element = (
    <DataCardWidget
      editor={editor}
      blockId={blockId}
      getMediaProvider={() => provider}
      getMediaRevision={() => 0}
      getCalcEngineFactory={() => engineFactory}
      onMediaSaved={onSaved}
    />
  );
  return { editor, element, bytes: () => bytes, onSaved };
}

function valueCell(host: HTMLElement, row: number): HTMLElement | null {
  return host.querySelectorAll<HTMLElement>('[role="gridcell"]')[row * 2 + 1] ?? null;
}

async function editValue(host: HTMLElement, row: number, value: string) {
  // Rows render before their values load, and the grid opens no editor on a
  // cell it has no value for yet — keep double-clicking until one opens.
  await waitFor(() => {
    const cell = valueCell(host, row);
    expect(cell).not.toBeNull();
    fireEvent.doubleClick(cell!);
    expect(host.querySelector('.squisq-grid-editor')).not.toBeNull();
  });
  const input = host.querySelector<HTMLInputElement>('.squisq-grid-editor')!;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(host.querySelector('.squisq-grid-editor')).toBeNull());
}

describe('data card save and remount sequences', () => {
  it('restores unsaved values and formulas, then discards to the latest save', async () => {
    const card = await setup();
    let ui = render(card.element);
    await editValue(ui.container, 0, '150');
    await waitFor(() => expect(valueCell(ui.container, 1)?.textContent).toBe('300'));
    await editValue(ui.container, 1, '=B2*3');
    await waitFor(() => expect(valueCell(ui.container, 1)?.textContent).toBe('450'));
    ui.unmount();
    ui = render(card.element);
    await waitFor(() => {
      expect(valueCell(ui.container, 0)?.textContent).toBe('150');
      expect(valueCell(ui.container, 1)?.textContent).toBe('450');
    });
    fireEvent.click(ui.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(card.onSaved).toHaveBeenCalledOnce());
    await waitFor(() => expect(ui.container.querySelector('.squisq-grid-dirtybar')).toBeNull());
    const saved = await xlsxToCellGrids(card.bytes());
    expect(saved.sheets[0]!.cells[2]![1]).toMatchObject({ formula: 'B2*3', value: 450 });
    await editValue(ui.container, 1, '=B2*4');
    await waitFor(() => expect(valueCell(ui.container, 1)?.textContent).toBe('600'));
    fireEvent.click(ui.getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(valueCell(ui.container, 1)?.textContent).toBe('450');
      expect(ui.container.querySelector('.squisq-grid-dirtybar')).toBeNull();
    });
  });

  it('reloads a changed worksheet annotation and restores each region independently', async () => {
    const card = await setup();
    const ui = render(card.element);
    await editValue(ui.container, 0, '150');
    await waitFor(() => expect(valueCell(ui.container, 1)?.textContent).toBe('300'));
    await act(async () => {
      card.editor.view.dispatch(
        card.editor.state.tr.setNodeAttribute(
          0,
          'dataTemplateParams',
          `src=${path} sheet=Rates anchor=A1`,
        ),
      );
    });
    await waitFor(() => expect(valueCell(ui.container, 0)?.textContent).toBe('2'));
    expect(ui.container.querySelector('.squisq-grid-dirtybar')).toBeNull();
    await act(async () => {
      card.editor.view.dispatch(
        card.editor.state.tr.setNodeAttribute(
          0,
          'dataTemplateParams',
          `src=${path} sheet=Sales anchor=A1`,
        ),
      );
    });
    await waitFor(() => {
      expect(valueCell(ui.container, 0)?.textContent).toBe('150');
      expect(valueCell(ui.container, 1)?.textContent).toBe('300');
    });
  });
});
