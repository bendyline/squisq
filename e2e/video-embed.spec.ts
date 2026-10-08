import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

/**
 * Hosted-video embeds: a top-level paragraph that is only a link (or bare
 * URL, or a provider `<iframe>` line) to a YouTube/Vimeo/… page plays inline.
 * The Write view mounts the player above the paragraph, Insert → Online Video
 * writes that paragraph, Page mode renders the player, and the sandboxed
 * Document preview (no scripts, so no player) shows a linked poster.
 *
 * Provider requests are aborted: the suite checks what Squisq renders, never
 * the providers' availability.
 */

const BUNNY_EMBED = 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ';

async function blockProviders(page: Page) {
  await page.route(
    /^https:\/\/([a-z0-9-]+\.)*(youtube-nocookie\.com|youtube\.com|ytimg\.com|vimeo\.com|vimeocdn\.com)\//,
    (route) => route.abort(),
  );
}

async function loadSample(page: Page, sample: string) {
  await blockProviders(page);
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption(sample);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function markdownSource(page: Page): Promise<string> {
  await switchView(page, 'Markdown');
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  return (await page.locator('.monaco-editor .view-lines').first().innerText()).replace(
    /\s+/g,
    ' ',
  );
}

test('the Write view plays standalone video links above their captions', async ({ page }) => {
  await loadSample(page, 'video-embeds');
  const players = page.locator('.tiptap.ProseMirror .squisq-video-embed-host iframe');
  // Titled link, bare URL, Vimeo, and the embed-code line — not the prose
  // link or the list item.
  await expect(players).toHaveCount(4);
  await expect(players.first()).toHaveAttribute('src', BUNNY_EMBED);
  await expect(players.nth(1)).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/eRsGyueVLvQ?start=60',
  );
  await expect(players.nth(2)).toHaveAttribute('src', 'https://player.vimeo.com/video/76979871');

  const caption = page.locator('.tiptap.ProseMirror p.squisq-video-embed-caption').first();
  await expect(caption).toHaveText('Big Buck Bunny -- Blender Foundation');
  await expect(page.locator('.squisq-video-embed-host-convert')).toHaveCount(1);
});

test('Insert → Online Video writes a link paragraph that plays', async ({ page }) => {
  await loadSample(page, 'e2e-tiny');
  await page.locator('.tiptap.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Online Video', exact: true }).click();

  const dialog = page.getByTestId('video-embed-dialog');
  await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled();
  await dialog
    .getByLabel(/^Video link or embed code/)
    .fill('https://youtu.be/aqz-KE-bpKQ?si=share&t=30');
  await expect(dialog).toContainText('YouTube video · starts at 0:30');
  await expect(dialog.locator('iframe')).toHaveAttribute('src', `${BUNNY_EMBED}?start=30`);
  await dialog.getByLabel('Title (optional)').fill('Big Buck Bunny');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(
    page.locator('.tiptap.ProseMirror .squisq-video-embed-host iframe').last(),
  ).toHaveAttribute('src', `${BUNNY_EMBED}?start=30`);
  expect(await markdownSource(page)).toContain(
    '[Big Buck Bunny](https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30s)',
  );
});

test('Page mode renders players; the sandboxed Document preview shows posters', async ({
  page,
}) => {
  await loadSample(page, 'video-embeds');
  await switchView(page, 'Preview');

  await selectUseMode(page, 'Page');
  const pagePlayers = page.locator('.squisq-video-embed iframe');
  await expect(pagePlayers).toHaveCount(4);
  await expect(pagePlayers.first()).toHaveAttribute('src', BUNNY_EMBED);

  await selectUseMode(page, 'Document');
  const frame = page.frameLocator('[data-testid="plain-html-preview"]');
  await expect(frame.locator('.squisq-video-embed-poster')).toHaveCount(4);
  await expect(frame.locator('iframe')).toHaveCount(0);
  await expect(frame.locator('.squisq-video-embed-poster').first()).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  );
});
