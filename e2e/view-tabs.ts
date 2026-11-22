import type { Page } from '@playwright/test';

export type ViewTab = 'Markdown' | 'Editor' | 'Play' | 'Preview';
export type UseMode = 'Slideshow' | 'Video' | 'Page' | 'Document' | 'Narrate';
export type WriteMode = 'Write' | 'Source' | 'Blocks' | 'Timeline' | 'Summaries';

const VIEW_IDS: Record<ViewTab, string> = {
  // Tests use the historical view-mode concepts while the toolbar shows only
  // the active view's name (Write, Blocks, Source, Slideshow, Narrate, …) on
  // one button. Those names are intentionally dynamic, so the button's
  // `data-active-view` is the stable contract for asserting the view.
  Markdown: 'raw',
  Editor: 'wysiwyg',
  Play: 'preview',
  Preview: 'preview',
};

const VIEW_SHORTCUTS: Record<string, string> = { wysiwyg: '1', raw: '2', preview: '3' };

/** The view button: named after the active view, it opens the View menu. */
export function viewButton(page: Page) {
  return page.locator('.squisq-toolbar-view-button');
}

/** The view button while it shows `tab` (no match while another view is on screen). */
export function activeView(page: Page, tab: ViewTab) {
  return page.locator(`.squisq-toolbar-view-button[data-active-view="${VIEW_IDS[tab]}"]`);
}

/**
 * Switches views the way the keyboard does (Ctrl/Cmd+Shift+1/2/3), which
 * returns to each view as it was left: Write in its layout, Use in its mode.
 */
export async function switchView(page: Page, tab: ViewTab): Promise<void> {
  const id = VIEW_IDS[tab];
  const button = viewButton(page);
  if ((await button.getAttribute('data-active-view')) === id) return;
  await button.focus();
  await page.keyboard.press(`ControlOrMeta+Shift+Digit${VIEW_SHORTCUTS[id]}`);
  await activeView(page, tab).waitFor();
}

/** Opens the View menu from the view button. */
export async function openViewMenu(page: Page) {
  await viewButton(page).click();
  const menu = page.getByRole('menu', { name: 'View', exact: true });
  await menu.waitFor();
  return menu;
}

/** Picks a Use mode from the View menu, which also enters Use. */
export async function selectUseMode(page: Page, mode: UseMode): Promise<void> {
  const menu = await openViewMenu(page);
  await menu
    .getByRole('group', { name: 'Use', exact: true })
    .getByRole('menuitemradio', { name: mode, exact: true })
    .click();
}

/**
 * Picks a Write layout — or Source — from the View menu's Edit views. It also
 * enters that view.
 */
export async function selectWriteMode(page: Page, mode: WriteMode): Promise<void> {
  const menu = await openViewMenu(page);
  await menu
    .getByRole('group', { name: 'Edit', exact: true })
    .getByRole('menuitemradio', { name: mode, exact: true })
    .click();
}

/** Shows or hides one of the editor's panes from the View menu, then closes it. */
export async function toggleViewPane(
  page: Page,
  pane: 'Outline' | 'Block previews' | 'Status bar',
): Promise<void> {
  const menu = await openViewMenu(page);
  await menu.getByRole('menuitemcheckbox', { name: pane, exact: true }).click();
  await page.keyboard.press('Escape');
}

/** Chooses how slides and video summarize the document, in Edit › Summaries. */
export async function chooseSummaryStyle(page: Page, style: string): Promise<void> {
  await selectWriteMode(page, 'Summaries');
  await page
    .getByRole('region', { name: 'Summaries', exact: true })
    .getByRole('radio', { name: style, exact: true })
    .check();
}
