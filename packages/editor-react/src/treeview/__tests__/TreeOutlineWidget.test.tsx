import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseTree } from '@bendyline/squisq/doc';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { TreeOutlineWidget } from '../TreeOutlineWidget';
import { TREEVIEW_KEY, TreeViewExtension } from '../TreeViewExtension';

const ART = ['src/', '├── index.ts', '├── utils/', '│   └── math.ts', '└── config.ts'].join('\n');

const editors: Editor[] = [];

beforeAll(() => {
  if (typeof globalThis.ResizeObserver !== 'undefined') return;
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

function makeEditor(): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      TreeViewExtension,
    ],
    content: markdownToTiptap(`\`\`\`tree\n${ART}\n\`\`\`\n`),
  });
  editors.push(editor);
  return editor;
}

function blockIdOf(editor: Editor): string {
  const entries = TREEVIEW_KEY.getState(editor.state)?.entries ?? [];
  expect(entries).toHaveLength(1);
  return entries[0].id;
}

function treeOf(editor: Editor) {
  let text = '';
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'codeBlock') return true;
    text = node.textContent;
    return false;
  });
  return parseTree(text);
}

function renderWidget(): Editor {
  const editor = makeEditor();
  render(<TreeOutlineWidget editor={editor} blockId={blockIdOf(editor)} fallbackPos={0} />);
  return editor;
}

function makeDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    getData: vi.fn((type: string) => values.get(type) ?? ''),
    get types() {
      return [...values.keys()];
    },
  } as unknown as DataTransfer;
}

function rowFor(label: string): HTMLElement {
  const input = screen.getByDisplayValue(label);
  const row = input.closest<HTMLElement>('.squisq-tree-row');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function setRowRect(row: HTMLElement): void {
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 300,
    bottom: 30,
    left: 0,
    width: 300,
    height: 30,
    toJSON: () => ({}),
  });
}

function fireDragAt(
  type: 'dragOver' | 'drop',
  row: HTMLElement,
  transfer: DataTransfer,
  clientY: number,
): void {
  const event = createEvent[type](row, { dataTransfer: transfer });
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(row, event);
}

describe('TreeOutlineWidget drag and drop', () => {
  it('drops before a row to reorder siblings', async () => {
    const editor = renderWidget();
    const indexRow = rowFor('index.ts');
    const transfer = makeDataTransfer();

    fireEvent.dragStart(screen.getByTitle('Drag config.ts to move'), { dataTransfer: transfer });
    setRowRect(indexRow);
    expect(transfer.effectAllowed).toBe('move');
    fireDragAt('dragOver', indexRow, transfer, 1);
    expect(indexRow.closest('.squisq-tree-item')?.classList).toContain(
      'squisq-tree-item--drop-before',
    );
    fireDragAt('drop', indexRow, transfer, 1);

    await waitFor(() =>
      expect(treeOf(editor).roots[0].children.map((node) => node.label)).toEqual([
        'config.ts',
        'index.ts',
        'utils/',
      ]),
    );
  });

  it('drops onto the middle of a row to indent as its last child', async () => {
    const editor = renderWidget();
    const utilsRow = rowFor('utils/');
    const transfer = makeDataTransfer();

    fireEvent.dragStart(screen.getByTitle('Drag config.ts to move'), { dataTransfer: transfer });
    setRowRect(utilsRow);
    fireDragAt('dragOver', utilsRow, transfer, 15);
    expect(utilsRow.closest('.squisq-tree-item')?.classList).toContain(
      'squisq-tree-item--drop-child',
    );
    fireDragAt('drop', utilsRow, transfer, 15);

    await waitFor(() => {
      const utils = treeOf(editor).roots[0].children.find((node) => node.label === 'utils/');
      expect(utils?.children.map((node) => node.label)).toEqual(['math.ts', 'config.ts']);
    });
  });
});
