import type { Page } from '@playwright/test';

export type ViewTab = 'Markdown' | 'Editor' | 'Play' | 'Preview';
export type UseMode = 'Slideshow' | 'Video' | 'Page' | 'Document' | 'Narrate';
export type WriteMode = 'Write' | 'Source' | 'Blocks' | 'Timeline' | 'Summarize';

const VIEW_TAB_IDS: Record<ViewTab, string> = {
  // Tests use the historical view-mode concepts while the visible product
  // labels are <selected Write mode, or Source> / <selected Use mode>. Those
  // labels are intentionally dynamic (for example Blocks, Slideshow or
  // Narrate), so data-view is the stable contract for selecting and asserting
  // the tab. Write and Source share the first tab, which carries the
  // data-view of whichever of the two it shows.
  Markdown: 'raw',
  Editor: 'wysiwyg',
  Play: 'preview',
  Preview: 'preview',
};

/** The tab for a view; Write and Source have one only while it is theirs. */
export function viewTab(page: Page, tab: ViewTab) {
  return page.locator(`[role="tab"][data-view="${VIEW_TAB_IDS[tab]}"]`);
}

export async function switchView(page: Page, tab: ViewTab): Promise<void> {
  const target = viewTab(page, tab);
  if ((await target.count()) > 0) {
    // Clicking the tab you're already on opens its mode menu (Write, Use)
    // instead, which would sit over whatever the test clicks next.
    if ((await target.getAttribute('aria-selected')) === 'true') return;
    await target.click();
    return;
  }
  if (VIEW_TAB_IDS[tab] === 'raw') {
    await selectWriteMode(page, 'Source');
    return;
  }
  // Back to Write from Source. Its shortcut returns to the layout Write was
  // in, where choosing an entry in the Write menu would pick one.
  await page.locator('[role="tab"][data-view="raw"]').focus();
  await page.keyboard.press('ControlOrMeta+Shift+Digit1');
  await target.waitFor();
}

export async function selectUseMode(page: Page, mode: UseMode): Promise<void> {
  await page.getByRole('button', { name: 'Choose Use mode', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Use mode', exact: true })
    .getByRole('menuitemradio', { name: mode, exact: true })
    .click();
}

/**
 * Picks a Write layout — or Source — from the menu beside the first tab. It
 * also enters that view.
 */
export async function selectWriteMode(page: Page, mode: WriteMode): Promise<void> {
  await page.getByRole('button', { name: 'Choose Write mode', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Write mode', exact: true })
    .getByRole('menuitemradio', { name: mode, exact: true })
    .click();
}

/** Chooses how slides and video summarize the document, in Write › Summarize. */
export async function chooseSummaryStyle(page: Page, style: string): Promise<void> {
  await selectWriteMode(page, 'Summarize');
  await page
    .getByRole('region', { name: 'Summarize', exact: true })
    .getByRole('radio', { name: style, exact: true })
    .check();
}
