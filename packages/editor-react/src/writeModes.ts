import type { LayoutMode } from './EditorContext';

/** One entry in the View menu's list of views. */
export interface ViewModeOption<K extends string> {
  key: K;
  label: string;
  /** Font Awesome class string or chrome glyph name (see `Icon`). */
  icon: string;
  /** One line saying what the mode is for. */
  summary: string;
  /**
   * The editor view choosing this entry opens, written as `data-view` on the
   * item as it is on the view tabs, so a host that follows view changes by
   * their clicks sees the ones made from the menu too.
   */
  view?: string;
}

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
    label: 'Summaries',
    icon: 'fa-solid fa-wand-magic-sparkles',
    summary: 'Choose how slides summarize your text.',
    view: 'wysiwyg',
  },
  {
    key: 'study',
    label: 'Study cards',
    icon: 'fa-solid fa-layer-group',
    summary: 'Make flashcards and quiz questions for each section.',
    view: 'wysiwyg',
  },
];

/**
 * Layouts that replace the Write surface with a view of their own (Summaries,
 * Study cards). The whole-document editor stays mounted, hidden, behind them,
 * so the changes they write are undoable steps there.
 */
export function replacesWriteSurface(mode: LayoutMode): boolean {
  return mode === 'summary' || mode === 'study';
}

/** An Edit entry in the View menu: one of the layouts, or Source — the Markdown file itself. */
export type WriteMenuKey = LayoutMode | 'source';

/**
 * Source is a view, not a layout: it always shows the whole file, whatever
 * layout Write is in. It is listed right under Write, because it is the other
 * way to edit the document.
 */
export const SOURCE_MENU_OPTION: ViewModeOption<'source'> = {
  key: 'source',
  label: 'Source',
  icon: 'fa-solid fa-code',
  summary: 'Edit the whole file as Markdown.',
  view: 'raw',
};

/** The View menu's Edit views: Write, Source, then the other layouts. */
export const WRITE_MENU_OPTIONS: ViewModeOption<WriteMenuKey>[] = [
  WRITE_MODE_OPTIONS[0]!,
  SOURCE_MENU_OPTION,
  ...WRITE_MODE_OPTIONS.slice(1),
];

export function writeModeLabel(mode: LayoutMode): string {
  return WRITE_MODE_OPTIONS.find((option) => option.key === mode)?.label ?? 'Write';
}
