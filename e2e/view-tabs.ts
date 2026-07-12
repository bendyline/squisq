import type { Page } from '@playwright/test';

export type ViewTab = 'Markdown' | 'Editor' | 'Play' | 'Preview';
export type UseMode = 'Slideshow' | 'Video' | 'Page' | 'Document' | 'Narrate';

const VIEW_TAB_IDS: Record<ViewTab, string> = {
  // Tests use the historical view-mode concepts while the visible product
  // labels are Write / Source / <selected Use mode>. The preview label is
  // intentionally dynamic (for example Slideshow or Narrate), so data-view is
  // the stable contract for selecting and asserting the tab.
  Markdown: 'raw',
  Editor: 'wysiwyg',
  Play: 'preview',
  Preview: 'preview',
};

export function viewTab(page: Page, tab: ViewTab) {
  return page.locator(`[role="tab"][data-view="${VIEW_TAB_IDS[tab]}"]`);
}

export async function switchView(page: Page, tab: ViewTab): Promise<void> {
  await viewTab(page, tab).click();
}

export async function selectUseMode(page: Page, mode: UseMode): Promise<void> {
  await page.getByRole('button', { name: 'Choose Use mode', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Use mode', exact: true })
    .getByRole('menuitemradio', { name: mode, exact: true })
    .click();
}
