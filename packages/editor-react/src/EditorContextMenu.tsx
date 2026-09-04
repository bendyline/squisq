/**
 * Shared editor context menu.
 *
 * EditorShell installs this once for every text surface. Squisq contributes
 * the ordinary clipboard actions; hosts register domain-specific actions with
 * `useEditorContextMenuItems` without installing competing DOM listeners.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import { CellSelection } from '@tiptap/pm/tables';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { useEditorContext, type EditorView } from './EditorContext';

export interface EditorContextMenuContext {
  /** Editor rendition that was right-clicked. */
  view: EditorView;
  /** Exact selected plain text at the time the menu opened. */
  selectedText: string;
  hasSelection: boolean;
  /** False in Preview and when the host made the editor read-only. */
  editable: boolean;
  clientX: number;
  clientY: number;
  target: Element;
}

export type EditorContextMenuItemVisibility =
  | 'always'
  | 'selection'
  | 'location'
  | ((context: EditorContextMenuContext) => boolean);

export interface EditorContextMenuItem {
  /** Stable within one host registration. */
  id: string;
  label: string;
  /** Optional trailing shortcut hint, e.g. `Ctrl+C`. */
  shortcut?: string;
  /** Consecutive groups are separated visually. Defaults to `host`. */
  group?: string;
  icon?: ReactNode;
  /** Defaults to `always`. */
  when?: EditorContextMenuItemVisibility;
  disabled?: boolean | ((context: EditorContextMenuContext) => boolean);
  onSelect: (context: EditorContextMenuContext) => void | Promise<void>;
}

type ItemGetter = () => readonly EditorContextMenuItem[];

interface ItemRegistry {
  register: (getItems: ItemGetter) => () => void;
}

const EditorContextMenuRegistry = createContext<ItemRegistry | null>(null);

/**
 * Spread onto a panel that brings its own context menu (the Files bin's
 * per-entry actions). The shared menu leaves right-clicks inside such a
 * subtree alone: its listener sits on the shell root, so it would otherwise
 * consume the event before React delivered it to the panel's own
 * `onContextMenu`. Surfaces that hook the DOM directly — proofing squiggles,
 * Monaco — coordinate by calling `preventDefault()` instead.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const ownsContextMenuProps = { 'data-editor-context-menu': 'own' } as const;

const OWN_CONTEXT_MENU_SELECTOR = '[data-editor-context-menu="own"]';

/** Internal signal used by RawEditor to preserve Monaco's menu standalone. */
// eslint-disable-next-line react-refresh/only-export-components
export function useEditorContextMenuAvailable(): boolean {
  return useContext(EditorContextMenuRegistry) !== null;
}

/** Register host actions with the nearest EditorShell context menu. */
// eslint-disable-next-line react-refresh/only-export-components
export function useEditorContextMenuItems(items: readonly EditorContextMenuItem[]): void {
  const registry = useContext(EditorContextMenuRegistry);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  if (!registry) {
    throw new Error('useEditorContextMenuItems must be used within an <EditorShell>');
  }

  useEffect(() => registry.register(() => itemsRef.current), [registry]);
}

interface SelectionInteraction {
  context: EditorContextMenuContext;
  copy: () => Promise<void>;
  cut: () => Promise<void>;
  paste: () => Promise<void>;
}

interface ResolvedMenuItem {
  item: EditorContextMenuItem;
  disabled: boolean;
}

interface OpenMenu {
  context: EditorContextMenuContext;
  items: readonly ResolvedMenuItem[];
  x: number;
  y: number;
  error: string | null;
}

interface TableActionScope {
  row: boolean;
  column: boolean;
}

export interface EditorContextMenuProviderProps {
  rootRef: RefObject<HTMLElement | null>;
  readOnly?: boolean;
  children: ReactNode;
}

function selectedTextFromBrowser(content: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
    return '';
  }
  if (!content.contains(selection.anchorNode) || !content.contains(selection.focusNode)) return '';
  return selection.toString();
}

function selectionContainsMonacoPosition(
  model: MonacoEditorNs.ITextModel,
  selection: {
    getStartPosition: () => { lineNumber: number; column: number };
    getEndPosition: () => { lineNumber: number; column: number };
  },
  position: { lineNumber: number; column: number },
): boolean {
  const offset = model.getOffsetAt(position);
  const start = model.getOffsetAt(selection.getStartPosition());
  const end = model.getOffsetAt(selection.getEndPosition());
  return offset >= start && offset <= end;
}

function dispatchTextInput(element: HTMLTextAreaElement | HTMLInputElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = window.getSelection();
  const ranges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index).cloneRange());
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand?.('copy') ?? false;
  textarea.remove();
  if (selection) {
    selection.removeAllRanges();
    ranges.forEach((range) => selection.addRange(range));
  }
  active?.focus({ preventScroll: true });
  if (!copied) throw new Error('Clipboard access is unavailable.');
}

async function readClipboard(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new Error('Clipboard access is unavailable.');
  return navigator.clipboard.readText();
}

function shouldShowItem(item: EditorContextMenuItem, context: EditorContextMenuContext): boolean {
  if (typeof item.when === 'function') return item.when(context);
  if (item.when === 'selection') return context.hasSelection;
  if (item.when === 'location') return !context.hasSelection;
  return true;
}

function resolveDisabled(item: EditorContextMenuItem, context: EditorContextMenuContext): boolean {
  return typeof item.disabled === 'function' ? item.disabled(context) : Boolean(item.disabled);
}

/**
 * Resolve which structural table commands apply to the current selection.
 * A whole-row selection gets row actions, a whole-column selection gets
 * column actions, and a cell/cell-range selection gets both. Selecting the
 * entire table is both a row and column selection, so both groups remain.
 */
function tableActionScope(
  editor: TiptapEditor | null,
  context: EditorContextMenuContext,
): TableActionScope | null {
  if (context.view !== 'wysiwyg' || !editor?.view.dom.contains(context.target)) return null;
  const cell = context.target.closest('td, th');
  if (!cell || !editor.view.dom.contains(cell)) return null;

  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) return { row: true, column: true };

  const selectsRows = selection.isRowSelection();
  const selectsColumns = selection.isColSelection();
  return {
    row: selectsRows || !selectsColumns,
    column: selectsColumns || !selectsRows,
  };
}

function tableMenuItems(
  editor: TiptapEditor | null,
  context: EditorContextMenuContext,
): EditorContextMenuItem[] {
  const scope = tableActionScope(editor, context);
  if (!scope || !editor) return [];

  const disabled = !context.editable;
  const items: EditorContextMenuItem[] = [];
  if (scope.row) {
    items.push(
      {
        id: 'squisq.table.insert-row-above',
        label: 'Insert row above',
        group: 'table-row',
        disabled,
        onSelect: () => {
          editor.chain().focus().addRowBefore().run();
        },
      },
      {
        id: 'squisq.table.insert-row-below',
        label: 'Insert row below',
        group: 'table-row',
        disabled,
        onSelect: () => {
          editor.chain().focus().addRowAfter().run();
        },
      },
      {
        id: 'squisq.table.delete-row',
        label: 'Delete this row',
        group: 'table-row',
        disabled,
        onSelect: () => {
          editor.chain().focus().deleteRow().run();
        },
      },
    );
  }
  if (scope.column) {
    items.push(
      {
        id: 'squisq.table.insert-column-left',
        label: 'Insert column to the left',
        group: 'table-column',
        disabled,
        onSelect: () => {
          editor.chain().focus().addColumnBefore().run();
        },
      },
      {
        id: 'squisq.table.insert-column-right',
        label: 'Insert column to the right',
        group: 'table-column',
        disabled,
        onSelect: () => {
          editor.chain().focus().addColumnAfter().run();
        },
      },
      {
        id: 'squisq.table.delete-column',
        label: 'Delete column',
        group: 'table-column',
        disabled,
        onSelect: () => {
          editor.chain().focus().deleteColumn().run();
        },
      },
    );
  }
  return items;
}

function shortcutModifier(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
}

function computeMenuStyle(menu: OpenMenu, element?: HTMLElement | null): CSSProperties {
  const rect = element?.getBoundingClientRect();
  const width = rect?.width ?? 220;
  const height = rect?.height ?? 150;
  const margin = 8;
  const gap = 4;
  let top = menu.y + gap;
  if (top + height + margin > window.innerHeight && menu.y - height - gap >= margin) {
    top = menu.y - height - gap;
  }
  const left = Math.min(
    Math.max(margin, menu.x),
    Math.max(margin, window.innerWidth - width - margin),
  );
  return { position: 'fixed', top, left, zIndex: 9999 };
}

/**
 * Context-menu owner used by EditorShell. Exported for hosts that compose the
 * lower-level RawEditor/WysiwygEditor primitives into their own shell.
 */
export function EditorContextMenuProvider({
  rootRef,
  readOnly = false,
  children,
}: EditorContextMenuProviderProps): ReactElement {
  const { activeView, editorMode, colorScheme, monacoEditor, tiptapEditor } = useEditorContext();
  const itemGettersRef = useRef(new Set<ItemGetter>());
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const register = useCallback((getItems: ItemGetter) => {
    itemGettersRef.current.add(getItems);
    return () => itemGettersRef.current.delete(getItems);
  }, []);
  const registry = useMemo<ItemRegistry>(() => ({ register }), [register]);

  const buildInteraction = useCallback(
    (target: Element, clientX: number, clientY: number): SelectionInteraction | null => {
      const content = target.closest<HTMLElement>('.squisq-editor-content');
      if (!content || !rootRef.current?.contains(content) || editorMode === 'image') return null;
      if (target.closest(OWN_CONTEXT_MENU_SELECTOR)) return null;

      const editable = !readOnly && activeView !== 'preview';
      let selectedText = '';
      let cutSelection: () => Promise<void> = async () => undefined;
      let pasteText: (text: string) => Promise<void> = async () => undefined;
      let focusTarget: () => void = () => undefined;

      const monacoDom = monacoEditor?.getDomNode();
      if (monacoEditor && monacoDom?.contains(target)) {
        const model = monacoEditor.getModel();
        let selection = monacoEditor.getSelection();
        const clickPosition = monacoEditor.getTargetAtClientPoint(clientX, clientY)?.position;
        if (
          model &&
          selection &&
          clickPosition &&
          (selection.isEmpty() || !selectionContainsMonacoPosition(model, selection, clickPosition))
        ) {
          monacoEditor.setPosition(clickPosition);
          selection = monacoEditor.getSelection();
        }
        if (model && selection && !selection.isEmpty()) {
          selectedText = model.getValueInRange(selection);
        }
        const capturedSelection = selection;
        focusTarget = () => monacoEditor.focus();
        cutSelection = async () => {
          if (!model || !capturedSelection || capturedSelection.isEmpty()) return;
          monacoEditor.executeEdits('squisq-context-menu', [
            { range: capturedSelection, text: '', forceMoveMarkers: true },
          ]);
          monacoEditor.focus();
        };
        pasteText = async (text: string) => {
          if (!model || !capturedSelection) return;
          const startOffset = model.getOffsetAt(capturedSelection.getStartPosition());
          monacoEditor.executeEdits('squisq-context-menu', [
            { range: capturedSelection, text, forceMoveMarkers: true },
          ]);
          const end = model.getPositionAt(startOffset + text.length);
          monacoEditor.setPosition(end);
          monacoEditor.focus();
        };
      } else if (tiptapEditor && tiptapEditor.view.dom.contains(target)) {
        const hit = tiptapEditor.view.posAtCoords({ left: clientX, top: clientY });
        let { from, to, empty } = tiptapEditor.state.selection;
        if (hit && ((!empty && (hit.pos < from || hit.pos > to)) || empty)) {
          tiptapEditor.commands.setTextSelection(hit.pos);
          ({ from, to, empty } = tiptapEditor.state.selection);
        }
        if (!empty) selectedText = tiptapEditor.state.doc.textBetween(from, to, '\n');
        focusTarget = () => tiptapEditor.commands.focus();
        cutSelection = async () => {
          tiptapEditor.chain().focus().setTextSelection({ from, to }).deleteSelection().run();
        };
        pasteText = async (text: string) => {
          tiptapEditor
            .chain()
            .focus()
            .setTextSelection({ from, to })
            .command(({ tr }) => {
              tr.insertText(text, from, to);
              return true;
            })
            .run();
        };
      } else if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? start;
        selectedText = target.value.slice(start, end);
        focusTarget = () => target.focus({ preventScroll: true });
        cutSelection = async () => {
          target.setRangeText('', start, end, 'end');
          dispatchTextInput(target);
          focusTarget();
        };
        pasteText = async (text: string) => {
          target.setRangeText(text, start, end, 'end');
          dispatchTextInput(target);
          focusTarget();
        };
      } else {
        selectedText = selectedTextFromBrowser(content);
      }

      const context: EditorContextMenuContext = {
        view: activeView,
        selectedText,
        hasSelection: selectedText.length > 0,
        editable,
        clientX,
        clientY,
        target,
      };
      return {
        context,
        copy: () => writeClipboard(selectedText),
        cut: async () => {
          await writeClipboard(selectedText);
          await cutSelection();
        },
        paste: async () => {
          try {
            await pasteText(await readClipboard());
          } catch (error: unknown) {
            focusTarget();
            if (document.execCommand?.('paste')) return;
            throw error;
          }
        },
      };
    },
    [activeView, editorMode, monacoEditor, readOnly, rootRef, tiptapEditor],
  );

  const openAt = useCallback(
    (target: Element, clientX: number, clientY: number): boolean => {
      const interaction = buildInteraction(target, clientX, clientY);
      if (!interaction) return false;
      const { context } = interaction;
      const modifier = shortcutModifier();
      const baseItems: EditorContextMenuItem[] = [
        {
          id: 'squisq.cut',
          label: 'Cut',
          shortcut: `${modifier}X`,
          group: 'clipboard',
          disabled: !context.editable || !context.hasSelection,
          onSelect: interaction.cut,
        },
        {
          id: 'squisq.copy',
          label: 'Copy',
          shortcut: `${modifier}C`,
          group: 'clipboard',
          disabled: !context.hasSelection,
          onSelect: interaction.copy,
        },
        {
          id: 'squisq.paste',
          label: 'Paste',
          shortcut: `${modifier}V`,
          group: 'clipboard',
          disabled: !context.editable,
          onSelect: interaction.paste,
        },
      ];
      const tableItems = tableMenuItems(tiptapEditor, context);
      const hostItems = Array.from(itemGettersRef.current).flatMap((getItems) => getItems());
      const items = [...baseItems, ...tableItems, ...hostItems]
        .filter((item) => shouldShowItem(item, context))
        .map((item) => ({ item, disabled: resolveDisabled(item, context) }));
      if (!items.some((item) => !item.disabled)) return false;
      const nextMenu = { context, items, x: clientX, y: clientY, error: null };
      setMenuStyle(computeMenuStyle(nextMenu));
      setMenu(nextMenu);
      return true;
    },
    [buildInteraction, tiptapEditor],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      if (!openAt(event.target, event.clientX, event.clientY)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      if (!(event.target instanceof Element)) return;
      const rect = event.target.getBoundingClientRect();
      if (!openAt(event.target, rect.left + 12, rect.top + 20)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('contextmenu', onContextMenu);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [openAt, rootRef]);

  useEffect(() => {
    if (!menu) return;
    const frame = requestAnimationFrame(() => {
      setMenuStyle(computeMenuStyle(menu, menuRef.current));
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    });
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(null);
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  const runItem = useCallback(
    async (resolved: ResolvedMenuItem) => {
      if (!menu || resolved.disabled) return;
      try {
        await resolved.item.onSelect(menu.context);
        setMenu(null);
      } catch (error: unknown) {
        setMenu((current) =>
          current
            ? {
                ...current,
                error:
                  error instanceof Error ? error.message : 'The action could not be completed.',
              }
            : null,
        );
      }
    },
    [menu],
  );

  const onMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  }, []);

  return (
    <EditorContextMenuRegistry.Provider value={registry}>
      {children}
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="squisq-editor-context-menu"
            data-theme={colorScheme}
            role="menu"
            aria-label="Editor actions"
            style={menuStyle}
            onKeyDown={onMenuKeyDown}
          >
            {menu.items.map((resolved, index) => {
              const group = resolved.item.group ?? 'host';
              const previousGroup =
                index > 0 ? (menu.items[index - 1]?.item.group ?? 'host') : group;
              return (
                <div key={`${group}:${resolved.item.id}`}>
                  {index > 0 && group !== previousGroup && (
                    <div className="squisq-editor-context-menu-separator" role="separator" />
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={resolved.disabled}
                    className="squisq-editor-context-menu-item"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void runItem(resolved)}
                  >
                    {resolved.item.icon && (
                      <span className="squisq-editor-context-menu-icon" aria-hidden="true">
                        {resolved.item.icon}
                      </span>
                    )}
                    <span className="squisq-editor-context-menu-label">{resolved.item.label}</span>
                    {resolved.item.shortcut && (
                      <span className="squisq-editor-context-menu-shortcut" aria-hidden="true">
                        {resolved.item.shortcut}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
            {menu.error && (
              <div className="squisq-editor-context-menu-error" role="alert">
                {menu.error}
              </div>
            )}
          </div>,
          document.body,
        )}
    </EditorContextMenuRegistry.Provider>
  );
}
