/* eslint-disable react-refresh/only-export-components -- static toolbar model, not a component module */
import type { ReactNode } from 'react';
import { Icon } from '../Icon';

export interface ToolbarButton {
  id: string;
  label: string;
  /** Text glyph shown when the button has no Font Awesome icon (headings). */
  icon: string;
  title: string;
  group: 'format' | 'lists' | 'structure' | 'insert' | 'media';
  /** Font Awesome class string (e.g. `"fa-solid fa-bold"`); omitted for text buttons. */
  faIcon?: string;
}

export const BUTTONS: ToolbarButton[] = [
  // Format group — B/I/S trio.
  {
    id: 'bold',
    label: 'B',
    icon: 'B',
    title: 'Bold (Ctrl+B)',
    group: 'format',
    faIcon: 'fa-solid fa-bold',
  },
  {
    id: 'italic',
    label: 'I',
    icon: 'I',
    title: 'Italic (Ctrl+I)',
    group: 'format',
    faIcon: 'fa-solid fa-italic',
  },
  {
    id: 'strikethrough',
    label: 'S',
    icon: 'S',
    title: 'Strikethrough',
    group: 'format',
    faIcon: 'fa-solid fa-strikethrough',
  },

  // Lists group — sits between format and structure so bullets/numbers
  // are adjacent to the inline formatters people reach for together.
  {
    id: 'ul',
    label: '•',
    icon: '•',
    title: 'Bullet list',
    group: 'lists',
    faIcon: 'fa-solid fa-list-ul',
  },
  {
    id: 'ol',
    label: '1.',
    icon: '1.',
    title: 'Numbered list',
    group: 'lists',
    faIcon: 'fa-solid fa-list-ol',
  },

  // Structure group — headings keep their text labels; Font Awesome Free
  // has no numbered (H1–H6) heading glyphs, and the numerals are clearer.
  { id: 'h1', label: 'H1', icon: 'H1', title: 'Heading 1', group: 'structure' },
  { id: 'h2', label: 'H2', icon: 'H2', title: 'Heading 2', group: 'structure' },
  { id: 'h3', label: 'H3', icon: 'H3', title: 'Heading 3', group: 'structure' },
  { id: 'h4', label: 'H4', icon: 'H4', title: 'Heading 4', group: 'structure' },
  { id: 'h5', label: 'H5', icon: 'H5', title: 'Heading 5', group: 'structure' },
  { id: 'h6', label: 'H6', icon: 'H6', title: 'Heading 6', group: 'structure' },

  // Insert group — block-level inserts (quote and rules). Generic code
  // blocks live alongside the language-specific entries in the Code Snippet
  // submenu.
  {
    id: 'quote',
    label: '❝',
    icon: '❝',
    title: 'Blockquote',
    group: 'insert',
    faIcon: 'fa-solid fa-quote-left',
  },
  {
    id: 'code',
    label: '</>',
    icon: '</>',
    title: 'Inline code',
    group: 'insert',
    faIcon: 'fa-solid fa-code',
  },
  {
    id: 'hr',
    label: '—',
    icon: '—',
    title: 'Horizontal rule',
    group: 'insert',
    faIcon: 'fa-solid fa-minus',
  },

  // Media group — links, tables, images, emoji
  {
    id: 'link',
    label: '🔗',
    icon: '🔗',
    title: 'Insert link',
    group: 'media',
    faIcon: 'fa-solid fa-link',
  },
  {
    id: 'table',
    label: 'table',
    icon: '',
    title: 'Insert table',
    group: 'media',
    faIcon: 'fa-solid fa-table',
  },
  {
    id: 'tasklist',
    label: 'tasks',
    icon: '',
    title: 'Insert Task List',
    group: 'media',
    faIcon: 'fa-solid fa-list-check',
  },
  {
    id: 'chart',
    label: 'chart',
    icon: '',
    title: 'Insert chart',
    group: 'media',
    faIcon: 'fa-solid fa-chart-column',
  },
  {
    id: 'diagram',
    label: 'diagram',
    icon: '',
    title: 'Insert diagram',
    group: 'media',
    faIcon: 'fa-solid fa-diagram-project',
  },
  {
    id: 'complexdiagram',
    label: 'complex diagram',
    icon: '',
    title: 'Insert Complex Diagram (Mermaid)',
    group: 'media',
    faIcon: 'fa-solid fa-code-branch',
  },
  {
    id: 'tree',
    label: 'tree',
    icon: '',
    title: 'Insert tree',
    group: 'media',
    faIcon: 'fa-solid fa-folder-tree',
  },
  {
    id: 'timeline',
    label: 'timeline',
    icon: '',
    title: 'Insert timeline',
    group: 'media',
    faIcon: 'fa-solid fa-timeline',
  },
  {
    id: 'drawing',
    label: 'drawing',
    icon: '',
    title: 'Insert drawing',
    group: 'media',
    faIcon: 'fa-solid fa-pen-nib',
  },
  {
    id: 'layout',
    label: 'layout',
    icon: '',
    title: 'Insert layout',
    group: 'media',
    faIcon: 'fa-solid fa-object-group',
  },
  {
    id: 'image',
    label: '🖼',
    icon: '🖼',
    title: 'Insert image',
    group: 'media',
    faIcon: 'fa-solid fa-image',
  },
  {
    id: 'emoji',
    label: '😊',
    icon: '😊',
    title: 'Insert emoji',
    group: 'media',
    faIcon: 'fa-solid fa-face-smile',
  },
];

export const FIRST_MEDIA_INDEX = BUTTONS.findIndex((b) => b.group === 'media');
export const MEDIA_BUTTONS = BUTTONS.filter((b) => b.group === 'media');
export const CONVERT_BUTTONS = MEDIA_BUTTONS.filter((b) => b.id === 'table' || b.id === 'tasklist');
export const INSERT_MENU_WIDTH = 200;
export const CODE_SNIPPET_MENU_WIDTH = 220;
export const MERMAID_TYPE_MENU_WIDTH = 520;
export const CHART_TYPE_MENU_WIDTH = 360;
export const TASK_LIST_ITEMS = ['Task 1', 'Task 2', 'Task 3'] as const;
export const TASK_LIST_MARKDOWN = TASK_LIST_ITEMS.map((item) => `- [ ] ${item}`).join('\n');

// BUTTONS position per id — stamped on each rendered button as
// data-btn-index so the overflow measurement can map a clipped DOM button
// back to its BUTTONS entry. Walking a counter over the DOM instead would
// drift whenever some entries render no button of their own (hidden H5/H6
// heading levels, the media group collapsed behind the Insert dropdown).
export const BUTTON_INDEX_BY_ID = new Map(BUTTONS.map((b, i) => [b.id, i]));

/** Renders a button's icon: a Font Awesome glyph when set, else the text label. */
export function buttonIcon(btn: ToolbarButton): ReactNode {
  return btn.faIcon ? <Icon icon={btn.faIcon} /> : btn.icon;
}

export function fileCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

export function fileCountBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}
