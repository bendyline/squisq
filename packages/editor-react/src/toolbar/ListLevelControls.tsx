import type { Editor as TiptapEditor } from '@tiptap/core';
import { Icon } from '../Icon';
import { indentListItem, outdentListItem, type ListNesting } from './tiptapToolbar';

interface ListLevelControlsProps {
  /** The editor the formatting buttons drive: the document or a focused layout textbox. */
  editor: TiptapEditor;
  /** `listNesting(editor)` for the list item at the caret. */
  nesting: ListNesting;
  /** Disables both actions regardless of nesting (e.g. while a data card holds focus). */
  disabled: boolean;
}

function listLevelActions(editor: TiptapEditor, nesting: ListNesting) {
  return [
    {
      id: 'outdent',
      label: 'Decrease indent',
      title: 'Decrease indent (Shift+Tab)',
      faIcon: 'fa-solid fa-outdent',
      enabled: nesting.canOutdent,
      run: () => outdentListItem(editor),
    },
    {
      id: 'indent',
      label: 'Increase indent',
      title: 'Increase indent (Tab)',
      faIcon: 'fa-solid fa-indent',
      enabled: nesting.canIndent,
      run: () => indentListItem(editor),
    },
  ];
}

/** The contextual list group in the toolbar's actions row (Tab / Shift+Tab equivalents). */
export function ListLevelButtons({
  editor,
  nesting,
  disabled,
  clipped,
}: ListLevelControlsProps & { clipped: boolean }) {
  return (
    <div
      className={`squisq-toolbar-group squisq-toolbar-contextual squisq-list-controls${clipped ? ' squisq-toolbar-contextual--clipped' : ''}`}
      data-contextual="list"
    >
      <div className="squisq-toolbar-separator" />
      {listLevelActions(editor, nesting).map((action) => (
        <button
          key={action.id}
          className="squisq-toolbar-button"
          data-toolbar-item={action.id}
          data-tooltip={action.title}
          onClick={action.run}
          aria-label={action.title}
          disabled={!action.enabled || disabled}
        >
          <Icon icon={action.faIcon} />
        </button>
      ))}
    </div>
  );
}

/** The same actions as overflow-menu rows, shown while the toolbar group is clipped. */
export function ListLevelOverflowItems({
  editor,
  nesting,
  disabled,
  onSelect,
}: ListLevelControlsProps & { onSelect: () => void }) {
  return (
    <>
      <div
        className="squisq-toolbar-separator"
        style={{ margin: '4px 0', width: '100%', height: 1 }}
      />
      {listLevelActions(editor, nesting).map((action) => (
        <button
          key={action.id}
          className="squisq-toolbar-overflow-item"
          onClick={() => {
            action.run();
            onSelect();
          }}
          disabled={!action.enabled || disabled}
        >
          <span className="squisq-toolbar-overflow-icon">
            <Icon icon={action.faIcon} />
          </span>
          <span>{action.label}</span>
        </button>
      ))}
    </>
  );
}
