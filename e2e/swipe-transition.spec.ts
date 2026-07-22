import { expect, test } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { switchView } from './view-tabs';

test('a completed swipe does not restore the outgoing slide during the destination transition', async ({
  page,
}) => {
  await page.goto('/');
  await waitForAppReady(page);
  await switchView(page, 'Play');

  const player = page.locator('.doc-player');
  const counter = page.getByTestId('slide-counter');
  const next = page.getByTestId('slide-next');
  await expect(player).toBeVisible();
  await expect(counter).toHaveText('Cover');

  // Advance through the cover until the outgoing 42% slide is active. Locate
  // it by its stable block id so unrelated sample additions do not break this
  // regression.
  const outgoing = player.locator('.doc-player__block--active [data-block-id="the-big-number"]');
  for (let step = 0; step < 20 && (await outgoing.count()) === 0; step++) {
    await next.click();
  }
  await expect(outgoing).toBeAttached();
  const beforeLabel = (await counter.textContent())?.trim();
  const beforeMatch = beforeLabel?.match(/^(\d+) \/ (\d+)$/);
  if (!beforeMatch) throw new Error(`Unexpected slide counter: ${beforeLabel ?? 'missing'}`);
  const destinationLabel = `${Number(beforeMatch[1]) + 1} / ${beforeMatch[2]}`;

  const box = await player.boundingBox();
  if (!box) throw new Error('Unable to measure the slideshow player.');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 });
  await page.mouse.up();

  // A Famous Quote is the slide immediately after The Big Number. Assert the
  // transient entrance state first so waiting on the counter cannot consume
  // the short animation window.
  await expect(
    player.locator(
      '.doc-player__block--active [data-block-id="a-famous-quote"].transition-fade-enter',
    ),
  ).toBeAttached();
  await expect(counter).toHaveText(destinationLabel);
  await expect(player.locator('.doc-player__block--previous')).toHaveCount(0);
  await expect(player.locator('.doc-player__viewport')).not.toContainText('42%');
});
