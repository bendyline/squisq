import type { Page } from '@playwright/test';

export type ViewTab = 'Markdown' | 'Editor' | 'Play' | 'Preview';

const VIEW_TAB_LABELS: Record<ViewTab, string> = {
  // Tests use the stable view-mode concepts; the visible product labels
  // currently use the friendlier Write / Source / Use copy.
  Markdown: 'Source',
  Editor: 'Write',
  Play: 'Use',
  Preview: 'Use',
};

export function viewTabLabel(tab: ViewTab): string {
  return VIEW_TAB_LABELS[tab];
}

export async function switchView(page: Page, tab: ViewTab): Promise<void> {
  await page.getByRole('tab', { name: viewTabLabel(tab), exact: true }).click();
}
