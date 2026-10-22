/**
 * @vitest-environment jsdom
 *
 * Increase / decrease a list item's level from the toolbar and the context
 * menu — the visible counterparts of Tab / Shift+Tab.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useRef } from 'react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../EditorContext';
import { EditorContextMenuProvider } from '../EditorContextMenu';
import { Toolbar } from '../Toolbar';
import { tiptapToMarkdown } from '../tiptapBridge';
import {
  indentListItem,
  isTiptapActive,
  listNesting,
  outdentListItem,
} from '../toolbar/tiptapToolbar';

function makeEditor(content: string): Editor {
  return new Editor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })],
    content,
  });
}

/** Put the caret at the end of the first text node reading `text`. */
function caretIn(editor: Editor, text: string): void {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target < 0 && node.isText && node.text === text) target = pos + text.length;
  });
  if (target < 0) throw new Error(`No text node "${text}"`);
  editor.commands.setTextSelection(target);
}

function markdown(editor: Editor): string {
  return tiptapToMarkdown(editor.getHTML());
}

const BULLETS = '<ul><li><p>a</p></li><li><p>b</p></li></ul><p>after</p>';

describe('list nesting commands', () => {
  it('indents an item under the one above it and outdents it back', () => {
    const editor = makeEditor(BULLETS);
    caretIn(editor, 'b');
    expect(listNesting(editor)).toEqual({ canIndent: true, canOutdent: false });

    expect(indentListItem(editor)).toBe(true);
    expect(markdown(editor)).toBe('- a\n  - b\n\nafter\n');
    expect(listNesting(editor)).toEqual({ canIndent: false, canOutdent: true });

    expect(outdentListItem(editor)).toBe(true);
    expect(markdown(editor)).toBe('- a\n- b\n\nafter\n');
    editor.destroy();
  });

  it('cannot indent a first item, and never lifts a top-level item out of its list', () => {
    const editor = makeEditor(BULLETS);
    caretIn(editor, 'a');
    expect(listNesting(editor)).toEqual({ canIndent: false, canOutdent: false });
    expect(indentListItem(editor)).toBe(false);
    expect(outdentListItem(editor)).toBe(false);
    expect(markdown(editor)).toBe('- a\n- b\n\nafter\n');
    editor.destroy();
  });

  it('reports no list level outside a list', () => {
    const editor = makeEditor(BULLETS);
    caretIn(editor, 'after');
    expect(listNesting(editor)).toBeNull();
    editor.destroy();
  });

  it('lets a nested numbered level switch to bullets, and the buttons follow the innermost list', () => {
    const editor = makeEditor('<ol><li><p>one</p></li><li><p>two</p></li></ol>');
    caretIn(editor, 'two');
    indentListItem(editor);
    expect(markdown(editor)).toBe('1. one\n   1. two\n');
    expect(isTiptapActive(editor, 'ol')).toBe(true);
    expect(isTiptapActive(editor, 'ul')).toBe(false);

    editor.chain().focus().toggleBulletList().run();
    expect(markdown(editor)).toBe('1. one\n   - two\n');
    expect(isTiptapActive(editor, 'ul')).toBe(true);
    expect(isTiptapActive(editor, 'ol')).toBe(false);
    editor.destroy();
  });

  it('nests task items', () => {
    const editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>t1</p></li><li data-type="taskItem" data-checked="true"><p>t2</p></li></ul>',
    );
    caretIn(editor, 't2');
    expect(listNesting(editor)).toEqual({ canIndent: true, canOutdent: false });
    indentListItem(editor);
    expect(markdown(editor)).toBe('- [ ] t1\n  - [x] t2\n');
    expect(listNesting(editor)?.canOutdent).toBe(true);
    editor.destroy();
  });
});

let currentContext: EditorContextValue | null = null;

function ContextProbe() {
  currentContext = useEditorContext();
  return null;
}

beforeEach(() => {
  currentContext = null;
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

describe('<Toolbar> list level controls', () => {
  it('appear in a list item and change its level', () => {
    const editor = makeEditor(BULLETS);
    caretIn(editor, 'b');
    render(
      <EditorProvider initialMarkdown="- a\n- b\n\nafter" initialView="wysiwyg">
        <Toolbar />
        <ContextProbe />
      </EditorProvider>,
    );
    act(() => currentContext!.setTiptapEditor(editor));

    const indent = () =>
      screen.getByRole('button', { name: 'Increase indent (Tab)' }) as HTMLButtonElement;
    const outdent = () =>
      screen.getByRole('button', { name: 'Decrease indent (Shift+Tab)' }) as HTMLButtonElement;
    expect(indent().disabled).toBe(false);
    expect(outdent().disabled).toBe(true);

    fireEvent.click(indent());
    expect(markdown(editor)).toBe('- a\n  - b\n\nafter\n');
    expect(indent().disabled).toBe(true);
    expect(outdent().disabled).toBe(false);

    fireEvent.click(outdent());
    expect(markdown(editor)).toBe('- a\n- b\n\nafter\n');

    act(() => caretIn(editor, 'after'));
    expect(screen.queryByRole('button', { name: 'Increase indent (Tab)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decrease indent (Shift+Tab)' })).toBeNull();
    editor.destroy();
  });
});

function MountedListContextMenu({ editor }: { editor: Editor }) {
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
    <EditorContextMenuProvider rootRef={rootRef}>
      <div ref={rootRef} className="squisq-editor-shell">
        <div className="squisq-editor-content">
          <div ref={editorHostRef} />
        </div>
      </div>
    </EditorContextMenuProvider>
  );
}

describe('EditorContextMenu list level items', () => {
  it('offers increase / decrease indent inside a list item', async () => {
    const editor = makeEditor(BULLETS);
    caretIn(editor, 'b');
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
    render(
      <EditorProvider initialMarkdown="" initialView="wysiwyg">
        <MountedListContextMenu editor={editor} />
      </EditorProvider>,
    );

    fireEvent.contextMenu(editor.view.dom.querySelectorAll('li')[1], {
      clientX: 40,
      clientY: 60,
    });
    const increase = (await screen.findByRole('menuitem', {
      name: 'Increase indent',
    })) as HTMLButtonElement;
    const decrease = screen.getByRole('menuitem', { name: 'Decrease indent' }) as HTMLButtonElement;
    expect(increase.disabled).toBe(false);
    expect(decrease.disabled).toBe(true);

    fireEvent.click(increase);
    await waitFor(() => expect(markdown(editor)).toBe('- a\n  - b\n\nafter\n'));
    editor.destroy();
  });

  it('leaves the menu alone outside a list', async () => {
    const editor = makeEditor(BULLETS);
    caretIn(editor, 'after');
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
    render(
      <EditorProvider initialMarkdown="" initialView="wysiwyg">
        <MountedListContextMenu editor={editor} />
      </EditorProvider>,
    );

    fireEvent.contextMenu(editor.view.dom.querySelector('p:last-child')!, {
      clientX: 40,
      clientY: 60,
    });
    expect(await screen.findByRole('menuitem', { name: 'Paste' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: 'Increase indent' })).toBeNull();
    editor.destroy();
  });
});
