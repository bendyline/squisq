import type { LayoutMode } from './EditorContext';
import type { ViewModeOption } from './toolbar/ViewModeMenu';

/** The Write tab's modes — the editor layouts — named as the tab shows them. */
export const WRITE_MODE_OPTIONS: ViewModeOption<LayoutMode>[] = [
  {
    key: 'document',
    label: 'Write',
    icon: 'fa-solid fa-file-lines',
    summary: 'Edit the whole document in one column.',
    view: 'wysiwyg',
  },
  {
    key: 'block',
    label: 'Blocks',
    icon: 'fa-solid fa-square',
    summary: 'Edit one block at a time on a card.',
    view: 'wysiwyg',
  },
  {
    key: 'timeline',
    label: 'Timeline',
    icon: 'fa-solid fa-timeline',
    summary: 'Edit timing for blocks and media clips.',
    view: 'wysiwyg',
  },
  {
    key: 'summary',
    label: 'Summarize',
    icon: 'fa-solid fa-wand-magic-sparkles',
    summary: 'Choose how slides summarize your text.',
    view: 'wysiwyg',
  },
];

/** A Write menu entry: one of the layouts, or Source — the Markdown file itself. */
export type WriteMenuKey = LayoutMode | 'source';

/**
 * Source is a view, not a layout: it always shows the whole file, whatever
 * layout Write is in. It sits in the same menu, right under Write, because it
 * is the other way to edit the document.
 */
export const SOURCE_MENU_OPTION: ViewModeOption<'source'> = {
  key: 'source',
  label: 'Source',
  icon: 'fa-solid fa-code',
  summary: 'Edit the whole file as Markdown.',
  view: 'raw',
};

/** The menu beside the editing tab: Write, Source, then the other layouts. */
export const WRITE_MENU_OPTIONS: ViewModeOption<WriteMenuKey>[] = [
  WRITE_MODE_OPTIONS[0]!,
  SOURCE_MENU_OPTION,
  ...WRITE_MODE_OPTIONS.slice(1),
];

export function writeModeLabel(mode: LayoutMode): string {
  return WRITE_MODE_OPTIONS.find((option) => option.key === mode)?.label ?? 'Write';
}
