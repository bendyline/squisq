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
import { EditorProvider, useEditorContext } from '../EditorContext';
import {
  EditorContextMenuProvider,
  ownsContextMenuProps,
  useEditorContextMenuItems,
  type EditorContextMenuContext,
} from '../EditorContextMenu';

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

function TableHarness({ editor, readOnly = false }: { editor: Editor; readOnly?: boolean }) {
  return (
    <EditorProvider initialMarkdown="" initialView="wysiwyg">
      <MountedTableContextMenu editor={editor} readOnly={readOnly} />
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
});
