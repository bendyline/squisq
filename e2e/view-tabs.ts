import type { Page } from '@playwright/test';

export type ViewTab = 'Markdown' | 'Editor' | 'Play' | 'Preview';
export type UseMode = 'Slideshow' | 'Video' | 'Page' | 'Document' | 'Narrate';
export type WriteMode = 'Write' | 'Blocks' | 'Timeline';

const VIEW_TAB_IDS: Record<ViewTab, string> = {
  // Tests use the historical view-mode concepts while the visible product
  // labels are <selected Write mode> / Source / <selected Use mode>. Those
  // labels are intentionally dynamic (for example Blocks, Slideshow or
  // Narrate), so data-view is the stable contract for selecting and asserting
  // the tab.
  Markdown: 'raw',
  Editor: 'wysiwyg',
  Play: 'preview',
  Preview: 'preview',
};

export function viewTab(page: Page, tab: ViewTab) {
  return page.locator(`[role="tab"][data-view="${VIEW_TAB_IDS[tab]}"]`);
}

export async function switchView(page: Page, tab: ViewTab): Promise<void> {
  const target = viewTab(page, tab);
  // Clicking the tab you're already on opens its mode menu (Write, Use)
  // instead, which would sit over whatever the test clicks next.
  if ((await target.getAttribute('aria-selected')) === 'true') return;
  await target.click();
}

export async function selectUseMode(page: Page, mode: UseMode): Promise<void> {
  await page.getByRole('button', { name: 'Choose Use mode', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Use mode', exact: true })
    .getByRole('menuitemradio', { name: mode, exact: true })
    .click();
}

/** Picks a Write layout from the menu beside the Write tab; it also enters Write. */
export async function selectWriteMode(page: Page, mode: WriteMode): Promise<void> {
  await page.getByRole('button', { name: 'Choose Write mode', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Write mode', exact: true })
    .getByRole('menuitemradio', { name: mode, exact: true })
    .click();
}
