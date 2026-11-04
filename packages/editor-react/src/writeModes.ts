import type { LayoutMode } from './EditorContext';
import type { ViewModeOption } from './toolbar/ViewModeMenu';

/** The Write tab's modes — the editor layouts — named as the tab shows them. */
export const WRITE_MODE_OPTIONS: ViewModeOption<LayoutMode>[] = [
  {
    key: 'document',
    label: 'Write',
    icon: 'fa-solid fa-file-lines',
    summary: 'Edit the whole document in one column.',
  },
  {
    key: 'block',
    label: 'Blocks',
    icon: 'fa-solid fa-square',
    summary: 'Edit one block at a time on a card.',
  },
  {
    key: 'timeline',
    label: 'Timeline',
    icon: 'fa-solid fa-timeline',
    summary: 'Edit timing for blocks and media clips.',
  },
];

export function writeModeLabel(mode: LayoutMode): string {
  return WRITE_MODE_OPTIONS.find((option) => option.key === mode)?.label ?? 'Write';
}
