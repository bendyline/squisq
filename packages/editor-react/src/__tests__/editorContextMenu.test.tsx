import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useMemo, useRef } from 'react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { CellSelection } from '@tiptap/pm/tables';
import { NodeSelection } from '@tiptap/pm/state';
import Image from '@tiptap/extension-image';
import { EditorProvider, useEditorContext } from '../EditorContext';
import {
  EditorContextMenuProvider,
  ownsContextMenuProps,
  useEditorContextMenuItems,
  type EditorContextMenuContext,
} from '../EditorContextMenu';
import { forgetMediaCopy, MediaClipboard } from '../mediaClipboard';
import type { ProofFinding } from '@bendyline/squisq/proof';
import { ProofingStateContext } from '../proofing/proofingStateContext';
import type { ProofingState } from '../proofing/useProofing';

function HostActions({ onNarrate }: { onNarrate: (context: EditorContextMenuContext) => void }) {
  const items = useMemo(
    () => [
      {
        id: 'narrate-selection',
        label: 'Narrate selection',
        group: 'speech',
        when: 'selection' as const,
        onSelect: onNarrate,
      },
    ],
    [onNarrate],
  );
  useEditorContextMenuItems(items);
  return null;
}

function Harness({
  onNarrate = () => undefined,
  readOnly = false,
  onPanelContextMenu = () => undefined,
}: {
  onNarrate?: (context: EditorContextMenuContext) => void;
  readOnly?: boolean;
  onPanelContextMenu?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <EditorProvider initialMarkdown="hello workshop" initialView="raw">
      <EditorContextMenuProvider rootRef={rootRef} readOnly={readOnly}>
        <div ref={rootRef} className="squisq-editor-shell">
          <div className="squisq-editor-content">
            <textarea aria-label="Source" defaultValue="hello workshop" />
            <div {...ownsContextMenuProps}>
              <button type="button" onContextMenu={onPanelContextMenu}>
                pasted.png
              </button>
            </div>
          </div>
          <HostActions onNarrate={onNarrate} />
        </div>
      </EditorContextMenuProvider>
    </EditorProvider>
  );
}

function MountedTableContextMenu({ editor, readOnly }: { editor: Editor; readOnly?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const { setTiptapEditor } = useEditorContext();

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;
    host.append(editor.view.dom);
    setTiptapEditor(editor);
    return () => {
      setTiptapEditor(null);
      editor.view.dom.remove();
    };
  }, [editor, setTiptapEditor]);

  return (
    <EditorContextMenuProvider rootRef={rootRef} readOnly={readOnly}>
      <div ref={rootRef} className="squisq-editor-shell">
        <div className="squisq-editor-content">
          <div ref={editorHostRef} />
        </div>
      </div>
    </EditorContextMenuProvider>
  );
}

function TableHarness({
  editor,
  readOnly = false,
  proofing = null,
}: {
  editor: Editor;
  readOnly?: boolean;
  /** Proofing state, as `ProofingRoot` provides it around the shell. */
  proofing?: ProofingState | null;
}) {
  return (
    <EditorProvider initialMarkdown="" initialView="wysiwyg">
      <ProofingStateContext.Provider value={proofing}>
        <MountedTableContextMenu editor={editor} readOnly={readOnly} />
      </ProofingStateContext.Provider>
    </EditorProvider>
  );
}

function makeTableEditor(): Editor {
  return new Editor({
    extensions: [StarterKit, Table, TableRow, TableCell, TableHeader],
    content:
      '<table><tbody><tr><td><p>A1</p></td><td><p>B1</p></td><td><p>C1</p></td></tr><tr><td><p>A2</p></td><td><p>B2</p></td><td><p>C2</p></td></tr><tr><td><p>A3</p></td><td><p>B3</p></td><td><p>C3</p></td></tr></tbody></table>',
    editorProps: { attributes: { class: 'squisq-wysiwyg-editor' } },
  });
}

function tableCellPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') positions.push(pos);
  });
  return positions;
}

function tableRowCount(editor: Editor): number {
  let rows = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') rows += 1;
  });
  return rows;
}

function firstRowColumnCount(editor: Editor): number {
  let columns = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow' && columns === 0) columns = node.childCount;
  });
  return columns;
}

describe('EditorContextMenu', () => {
  const writeText = vi.fn<(value: string) => Promise<void>>();
  const readText = vi.fn<() => Promise<string>>();

  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    readText.mockResolvedValue(' world');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows clipboard actions and registered selection actions', async () => {
    const onNarrate = vi.fn();
    render(<Harness onNarrate={onNarrate} />);
    const source = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    source.setSelectionRange(0, 5);

    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });

    expect(
      ((await screen.findByRole('menuitem', { name: 'Cut' })) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('menuitem', { name: 'Paste' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Narrate selection' }));

    await waitFor(() => expect(onNarrate).toHaveBeenCalledOnce());
    expect(onNarrate.mock.calls[0]?.[0]).toMatchObject({
      view: 'raw',
      selectedText: 'hello',
      hasSelection: true,
      editable: true,
    });
  });

  it('copies and cuts through the shared clipboard commands', async () => {
    render(<Harness />);
    const source = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    source.setSelectionRange(0, 5);
    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hello'));

    source.setSelectionRange(0, 5);
    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cut' }));

    await waitFor(() => expect(source.value).toBe(' workshop'));
  });

  it('offers location paste while hiding selection-only host actions', async () => {
    render(<Harness />);
    const source = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    source.setSelectionRange(5, 5);

    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });

    expect(
      ((await screen.findByRole('menuitem', { name: 'Cut' })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole('menuitem', { name: 'Narrate selection' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    await waitFor(() => expect(source.value).toBe('hello world workshop'));
  });

  it('leaves right-clicks alone inside a panel that owns its context menu', async () => {
    const onPanelContextMenu = vi.fn();
    render(<Harness onPanelContextMenu={onPanelContextMenu} />);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'pasted.png' }), {
      clientX: 24,
      clientY: 32,
    });

    expect(onPanelContextMenu).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  describe('while the content scrolls', () => {
    function rect(left: number, top: number, right: number, bottom: number): DOMRect {
      return {
        left,
        top,
        right,
        bottom,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        toJSON: () => ({}),
      };
    }

    /** Make the content a 400×200 scroller at (0, 50) whose offset tests can move. */
    function scrollableContent(): { content: HTMLElement; scrollTo: (top: number) => void } {
      const content = document.querySelector<HTMLElement>('.squisq-editor-content')!;
      let scrollTop = 0;
      Object.defineProperty(content, 'scrollTop', { configurable: true, get: () => scrollTop });
      content.style.overflow = 'auto';
      content.getBoundingClientRect = () => rect(0, 50, 400, 250);
      return {
        content,
        scrollTo: (top: number) => {
          scrollTop = top;
          fireEvent.scroll(content);
        },
      };
    }

    it('stays open and moves with the spot it was opened on', async () => {
      render(<Harness />);
      const { scrollTo } = scrollableContent();
      fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Source' }), {
        clientX: 40,
        clientY: 120,
      });
      const menu = await screen.findByRole('menu');
      expect(menu.style.top).toBe('124px');

      // A trackpad's two-finger click scrolls a few pixels as it settles.
      scrollTo(3);

      expect(screen.getByRole('menu')).toBe(menu);
      await waitFor(() => expect(menu.style.top).toBe('121px'));
    });

    it('ignores scrolling elsewhere on the page', async () => {
      render(<Harness />);
      scrollableContent();
      fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Source' }), {
        clientX: 40,
        clientY: 120,
      });
      await screen.findByRole('menu');
      const sidebar = document.createElement('div');
      document.body.append(sidebar);

      fireEvent.scroll(sidebar);

      expect(screen.getByRole('menu')).toBeDefined();
      sidebar.remove();
    });

    it('closes once that spot scrolls out of view', async () => {
      render(<Harness />);
      const { scrollTo } = scrollableContent();
      fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Source' }), {
        clientX: 40,
        clientY: 120,
      });
      await screen.findByRole('menu');

      scrollTo(40);
      expect(screen.getByRole('menu')).toBeDefined();
      // 120 - 80 = 40, above the scroller's top edge at 50.
      scrollTo(80);

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    });
  });

  it('slides a menu that fits neither below nor above into a short window', async () => {
    const innerHeight = window.innerHeight;
    const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute('role') === 'menu' ? 240 : 0;
      },
    });
    try {
      render(<Harness />);
      fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Source' }), {
        clientX: 40,
        clientY: 150,
      });
      const menu = await screen.findByRole('menu');

      // 240px fits neither below 150 nor above it, so it ends 8px above the bottom.
      await waitFor(() => expect(menu.style.top).toBe('52px'));
      expect(menu.style.maxHeight).toBe('240px');
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
      if (scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight);
    }
  });

  it('disables destructive clipboard actions in a read-only editor', async () => {
    render(<Harness readOnly />);
    const source = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    source.setSelectionRange(0, 5);

    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });

    expect(
      ((await screen.findByRole('menuitem', { name: 'Cut' })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('menuitem', { name: 'Paste' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('offers only row actions for a whole-row table selection', async () => {
    const editor = makeTableEditor();
    const cells = tableCellPositions(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        CellSelection.rowSelection(
          editor.state.doc.resolve(cells[0]),
          editor.state.doc.resolve(cells[2]),
        ),
      ),
    );
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
    render(<TableHarness editor={editor} />);

    fireEvent.contextMenu(editor.view.dom.querySelectorAll('td')[0], { clientX: 40, clientY: 60 });

    expect(await screen.findByRole('menuitem', { name: 'Insert row above' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Insert row below' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Delete this row' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: 'Insert column to the left' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Insert column to the right' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete column' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row below' }));
    await waitFor(() => expect(tableRowCount(editor)).toBe(4));
    editor.destroy();
  });

  it('offers only column actions for a whole-column table selection', async () => {
    const editor = makeTableEditor();
    const cells = tableCellPositions(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        CellSelection.colSelection(
          editor.state.doc.resolve(cells[0]),
          editor.state.doc.resolve(cells[6]),
        ),
      ),
    );
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
    render(<TableHarness editor={editor} />);

    fireEvent.contextMenu(editor.view.dom.querySelectorAll('td')[0], { clientX: 40, clientY: 60 });

    expect(
      await screen.findByRole('menuitem', { name: 'Insert column to the left' }),
    ).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Insert column to the right' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Delete column' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: 'Insert row above' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Insert row below' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete this row' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert column to the left' }));
    await waitFor(() => expect(firstRowColumnCount(editor)).toBe(4));
    editor.destroy();
  });

  it('offers both row and column actions for a cell-range selection', async () => {
    const editor = makeTableEditor();
    const cells = tableCellPositions(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[4])),
    );
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
    render(<TableHarness editor={editor} />);

    fireEvent.contextMenu(editor.view.dom.querySelectorAll('td')[0], { clientX: 40, clientY: 60 });

    expect(await screen.findByRole('menuitem', { name: 'Insert row above' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Insert row below' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Delete this row' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Insert column to the left' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Insert column to the right' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Delete column' })).toBeDefined();
    editor.destroy();
  });

  describe('on a squiggled word', () => {
    const finding: ProofFinding = {
      id: 'finding-1',
      start: 0,
      end: 4,
      category: 'spelling',
      kind: 'Typo',
      message: 'Did you mean to spell `Qwen` this way?',
      originalText: 'Qwen',
      suggestions: [
        { text: 'Queen', kind: 'replace' },
        { text: 'Gwen', kind: 'replace' },
      ],
    };

    function fakeProofing(findingId: string | null = finding.id) {
      const state = {
        findings: [finding],
        findingAtPoint: vi.fn(() => findingId),
        applySuggestion: vi.fn(),
        ignoreFinding: vi.fn(),
        addToAppDictionary: vi.fn(),
        addToDocWordList: vi.fn(),
        canAddToAppDictionary: true,
      };
      return { state, proofing: state as unknown as ProofingState };
    }

    function renderTable(proofing: ProofingState, readOnly = false): Editor {
      const editor = makeTableEditor();
      vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
      render(<TableHarness editor={editor} proofing={proofing} readOnly={readOnly} />);
      return editor;
    }

    const labels = () =>
      screen.getAllByRole('menuitem').map((item) => item.textContent?.replace(/[⌘]|Ctrl\+/g, ''));

    it('leads with its suggestions and keeps the table actions beneath', async () => {
      const { state, proofing } = fakeProofing();
      const editor = renderTable(proofing);

      fireEvent.contextMenu(editor.view.dom.querySelectorAll('td')[0], {
        clientX: 40,
        clientY: 60,
      });

      const menu = await screen.findByRole('menu');
      expect(state.findingAtPoint).toHaveBeenCalledWith('wysiwyg', 40, 60);
      expect(labels()).toEqual([
        'Queen',
        'Gwen',
        'Ignore',
        'Add to dictionary',
        'Add to document word list',
        'CutX',
        'CopyC',
        'PasteV',
        'Insert row above',
        'Insert row below',
        'Delete this row',
        'Insert column to the left',
        'Insert column to the right',
        'Delete column',
      ]);
      const heading = document.getElementById(menu.getAttribute('aria-describedby') ?? '');
      expect(heading?.textContent).toBe('Did you mean to spell “Qwen” this way?');

      fireEvent.click(screen.getByRole('menuitem', { name: 'Queen' }));
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(state.applySuggestion).toHaveBeenCalledExactlyOnceWith(finding.id, 0);
      editor.destroy();
    });

    it('offers only the actions that leave a read-only document alone', async () => {
      const { proofing } = fakeProofing();
      const editor = renderTable(proofing, true);

      fireEvent.contextMenu(editor.view.dom.querySelectorAll('td')[0], {
        clientX: 40,
        clientY: 60,
      });

      const disabled = (name: string) =>
        (screen.getByRole('menuitem', { name }) as HTMLButtonElement).disabled;
      expect(
        ((await screen.findByRole('menuitem', { name: 'Queen' })) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(disabled('Add to document word list')).toBe(true);
      expect(disabled('Ignore')).toBe(false);
      expect(disabled('Add to dictionary')).toBe(false);
      editor.destroy();
    });

    it('is the ordinary menu where no word is squiggled', async () => {
      const { proofing } = fakeProofing(null);
      const editor = renderTable(proofing);

      fireEvent.contextMenu(editor.view.dom.querySelectorAll('td')[0], {
        clientX: 40,
        clientY: 60,
      });

      const menu = await screen.findByRole('menu');
      expect(menu.getAttribute('aria-describedby')).toBeNull();
      expect(labels()[0]).toBe('CutX');
      editor.destroy();
    });

    it('leaves the menu key to proofing, which answers it at the caret', async () => {
      const { state, proofing } = fakeProofing();
      const editor = renderTable(proofing);

      fireEvent.keyDown(editor.view.dom.querySelectorAll('td')[0], { key: 'ContextMenu' });

      await screen.findByRole('menu');
      expect(state.findingAtPoint).not.toHaveBeenCalled();
      expect(screen.queryByRole('menuitem', { name: 'Queen' })).toBeNull();
      editor.destroy();
    });
  });

  describe('on an image', () => {
    const written: Array<Record<string, Promise<Blob> | Blob>> = [];

    beforeEach(() => {
      written.length = 0;
      vi.stubGlobal(
        'ClipboardItem',
        class {
          constructor(readonly items: Record<string, Promise<Blob> | Blob>) {}
        },
      );
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText,
          readText,
          // Settles as a browser does: only once every format has resolved.
          write: vi.fn(async ([item]: Array<{ items: Record<string, Promise<Blob> | Blob> }>) => {
            await Promise.all(Object.values(item.items));
            written.push(item.items);
          }),
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      forgetMediaCopy();
    });

    /** jsdom's Blob reads only through FileReader. */
    function blobText(blob: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
    }

    function makeImageEditor(): Editor {
      return new Editor({
        extensions: [StarterKit, Image.configure({ inline: false }), MediaClipboard],
        content: '<p>Before</p><img src="images/photo.png" alt="Photo"><p>After</p>',
        editorProps: { attributes: { class: 'squisq-wysiwyg-editor' } },
      });
    }

    it('selects the image and offers Cut and Copy for it', async () => {
      const editor = makeImageEditor();
      render(<TableHarness editor={editor} />);

      fireEvent.contextMenu(editor.view.dom.querySelector('img')!, { clientX: 40, clientY: 60 });

      const copy = await screen.findByRole('menuitem', { name: /^Copy/ });
      expect(copy).toHaveProperty('disabled', false);
      expect(screen.getByRole('menuitem', { name: /^Cut/ })).toHaveProperty('disabled', false);
      const { selection } = editor.state;
      expect(selection).toBeInstanceOf(NodeSelection);
      expect((selection as NodeSelection).node.type.name).toBe('image');
      editor.destroy();
    });

    it('copies the image as its reference', async () => {
      const editor = makeImageEditor();
      render(<TableHarness editor={editor} />);
      fireEvent.contextMenu(editor.view.dom.querySelector('img')!, { clientX: 40, clientY: 60 });

      fireEvent.click(await screen.findByRole('menuitem', { name: /^Copy/ }));

      // No picture to draw in jsdom, so the HTML alone is written.
      await waitFor(() => expect(written).toHaveLength(1));
      expect(Object.keys(written[0]!)).toEqual(['text/html']);
      const html = await blobText(written[0]!['text/html'] as Blob);
      expect(html).toContain('src="images/photo.png"');
      expect(html).toMatch(/data-squisq-media-copy="[^"]+"/);
      expect(writeText).not.toHaveBeenCalled();
      expect(screen.queryByRole('menu')).toBeNull();
      editor.destroy();
    });

    it('cuts the image out of the document', async () => {
      const editor = makeImageEditor();
      render(<TableHarness editor={editor} />);
      fireEvent.contextMenu(editor.view.dom.querySelector('img')!, { clientX: 40, clientY: 60 });

      fireEvent.click(await screen.findByRole('menuitem', { name: /^Cut/ }));

      await waitFor(() => expect(editor.view.dom.querySelector('img')).toBeNull());
      expect(written).toHaveLength(1);
      expect(editor.getText()).toContain('Before');
      expect(editor.getText()).toContain('After');
      editor.destroy();
    });
  });
});
