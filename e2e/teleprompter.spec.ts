import { test, expect, type Page } from '@playwright/test';
import { TELEPROMPTER_FAKE_MIC_PATH } from './fakeMicFixture';
import { switchView, viewTab } from './view-tabs';

/**
 * E2E for the Narrate (teleprompter) display mode — Phase A surface:
 * mode registration under the Use tab, script rendering, manual
 * constant-rate scrolling, mirror/font controls, fake-mic voice pacing,
 * and the popup float tier. Document-PiP and real-mic behavior are
 * covered by the manual test script (docs/teleprompter-manual-tests.md).
 */

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${TELEPROMPTER_FAKE_MIC_PATH}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  permissions: ['microphone'],
});

/** Load the narrate demo sample and land in the teleprompter surface. */
async function openTeleprompter(page: Page) {
  await page.goto('/?sample=teleprompter-demo');
  await page.waitForLoadState('networkidle');
  await switchView(page, 'Play');
  await page.getByTestId('teleprompter-view').waitFor({ state: 'visible', timeout: 5_000 });
}

function scrollColumn(page: Page) {
  return page.locator('.squisq-teleprompter-scroll');
}

async function translateY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.squisq-teleprompter-scroll');
    if (!el) return NaN;
    const transform = getComputedStyle(el).transform;
    if (!transform || transform === 'none') return 0;
    const matrix = new DOMMatrixReadOnly(transform);
    return matrix.m42;
  });
}

test('narrate mode renders the script with block markers and controls', async ({ page }) => {
  await openTeleprompter(page);

  // The frontmatter `display-mode: narrate` preselects the Use mode.
  await expect(viewTab(page, 'Play')).toHaveAccessibleName('Narrate');

  await expect(page.getByTestId('teleprompter-surface')).toBeVisible();
  await expect(page.getByTestId('teleprompter-controls')).toBeVisible();
  // Block markers show the headings.
  await expect(page.locator('.squisq-teleprompter-block-marker').first()).toHaveText(
    'Welcome to the Teleprompter',
  );
  const tokenCount = await page.locator('[data-token-idx]').count();
  expect(tokenCount).toBeGreaterThan(100);
});

test('manual constant-rate mode scrolls without a mic', async ({ page }) => {
  await openTeleprompter(page);

  // Turn voice pacing OFF (manual mode) and skip the countdown.
  await page.getByRole('button', { name: '🎙 Voice pace' }).click();
  await page.locator('#squisq-prompter-countdown').selectOption('0');
  await page.getByRole('button', { name: 'Start prompter', exact: true }).click();

  await expect(scrollColumn(page)).toBeVisible();
  await expect(page.getByTestId('teleprompter-controls')).toHaveAttribute(
    'data-transport',
    'rolling',
  );
  const before = await translateY(page);
  // Column translates upward (negative Y) as the prompter advances.
  await expect.poll(() => translateY(page), { timeout: 5_000 }).toBeLessThan(before - 4);

  // Pausing transitions the controller to its non-advancing state.
  await page.getByRole('button', { name: 'Pause prompter' }).click();
  await expect(page.getByTestId('teleprompter-controls')).toHaveAttribute(
    'data-transport',
    'paused',
  );
});

test('mirror and font-size controls restyle the surface', async ({ page }) => {
  await openTeleprompter(page);

  const surface = page.getByTestId('teleprompter-surface');
  await expect(surface).not.toHaveClass(/--mirrored/);
  await page.getByRole('button', { name: '⇋ Mirror' }).click();
  await expect(surface).toHaveClass(/--mirrored/);
  await page.getByRole('button', { name: '⇋ Mirror' }).click();

  const sizeBefore = await surface.evaluate((el) => getComputedStyle(el).fontSize);
  await page.locator('#squisq-prompter-fontsize').fill('96');
  const sizeAfter = await surface.evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(sizeAfter)).toBeGreaterThan(parseFloat(sizeBefore));
});

test('direct inputs nudge words and control automatic advancement', async ({ page }) => {
  await openTeleprompter(page);

  const surface = page.getByTestId('teleprompter-surface');
  const activeWord = page.locator('.squisq-teleprompter-word--active');
  // Focus stays on an ordinary control outside the script surface; Narrate's
  // document-level shortcut still owns left/right navigation.
  await page.getByRole('button', { name: 'Restart prompter' }).focus();
  await expect(activeWord).toHaveAttribute('data-token-idx', '0');

  await page.keyboard.press('ArrowRight');
  await expect(activeWord).toHaveAttribute('data-token-idx', '1');
  await page.keyboard.press('ArrowRight');
  await expect(activeWord).toHaveAttribute('data-token-idx', '2');
  await page.keyboard.press('ArrowLeft');
  await expect(activeWord).toHaveAttribute('data-token-idx', '1');

  await surface.hover();
  await page.mouse.wheel(0, 1);
  await expect(activeWord).toHaveAttribute('data-token-idx', '2');
  await page.mouse.wheel(0, -1);
  await expect(activeWord).toHaveAttribute('data-token-idx', '1');

  await page.locator('#squisq-prompter-countdown').selectOption('0');
  const controls = page.getByTestId('teleprompter-controls');
  await surface.click({ button: 'middle' });
  await expect(controls).toHaveAttribute('data-transport', 'rolling');
  await surface.click({ button: 'middle' });
  await expect(controls).toHaveAttribute('data-transport', 'paused');

  // Up/down work globally even while an ordinary transport button has focus.
  await page.getByRole('button', { name: 'Restart prompter' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(controls).toHaveAttribute('data-transport', 'rolling');
  await page.keyboard.press('ArrowDown');
  await expect(controls).toHaveAttribute('data-transport', 'paused');

  // Space is intentionally left to the browser/control that owns focus.
  await surface.focus();
  await page.keyboard.press('Space');
  await expect(controls).toHaveAttribute('data-transport', 'paused');
});

test('fake mic drives the level meter and voice pacing advances the prompter', async ({ page }) => {
  await openTeleprompter(page);

  // Voice pacing is on by default; starting requests the (fake) mic.
  await page.locator('#squisq-prompter-countdown').selectOption('0');
  await page.getByRole('button', { name: 'Start prompter', exact: true }).click();
  await expect(page.locator('.squisq-teleprompter-meter')).toBeVisible();

  const meter = page.locator('.squisq-teleprompter-meter');
  await expect
    .poll(async () => Number((await meter.getAttribute('aria-valuenow')) ?? 0), {
      timeout: 8_000,
    })
    .toBeGreaterThan(0);
  await expect(meter).toHaveClass(/--voice/, { timeout: 8_000 });

  const startIdx = Number(
    (await page.locator('.squisq-teleprompter-word--active').getAttribute('data-token-idx')) ?? 0,
  );
  await expect
    .poll(
      async () =>
        Number(
          (await page
            .locator('.squisq-teleprompter-word--active')
            .getAttribute('data-token-idx')) ?? 0,
        ),
      { timeout: 8_000 },
    )
    .toBeGreaterThan(startIdx + 1);
});

test('popup float tier opens a window hosting the surface and comes back', async ({
  page,
  context,
}) => {
  await openTeleprompter(page);

  // Force the popup tier via the float-mode select (Chromium also offers
  // document-pip, which Playwright can't inspect).
  const tierSelect = page.getByTestId('teleprompter-float-tier');
  if (await tierSelect.isVisible()) {
    await tierSelect.selectOption('popup');
  }
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: '⇱ Pop out' }).click();
  const popup = await popupPromise;

  // The surface now lives in the popup; the docked area shows the note.
  await popup.locator('.squisq-teleprompter-surface').waitFor({ state: 'visible', timeout: 5_000 });
  await expect(page.getByText('The prompter is floating in its own window.')).toBeVisible();

  await page.getByRole('button', { name: '⇤ Bring back' }).click();
  await expect(page.getByTestId('teleprompter-surface')).toBeVisible();
  expect(popup.isClosed()).toBe(true);
});

test('recording a take saves the narration and rewrites the markdown preamble', async ({
  page,
}) => {
  await openTeleprompter(page);
  await page.locator('#squisq-prompter-countdown').selectOption('0');

  await page.getByRole('button', { name: '⏺ Record' }).click();
  // Capture is live: recording dot on the surface, prompter rolling.
  await expect(page.locator('.squisq-teleprompter-recdot')).toBeVisible({ timeout: 5_000 });
  const recordingStartIdx = Number(
    (await page.locator('.squisq-teleprompter-word--active').getAttribute('data-token-idx')) ?? 0,
  );
  await expect
    .poll(
      async () =>
        Number(
          (await page
            .locator('.squisq-teleprompter-word--active')
            .getAttribute('data-token-idx')) ?? 0,
        ),
      { timeout: 8_000 },
    )
    .toBeGreaterThan(recordingStartIdx + 1);
  await page.getByRole('button', { name: '⏹ Stop' }).click();

  // Decode + DTW alignment runs on the take, then the review strip appears.
  await page.getByTestId('teleprompter-review').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: '✓ Save narration' }).click();
  await page.getByTestId('teleprompter-save-notice').waitFor({ state: 'visible', timeout: 15_000 });

  // The markdown now references the take at the very top (preamble
  // annotation → doc.documentMedia on reparse).
  await switchView(page, 'Markdown');
  await expect(page.locator('.monaco-editor').first()).toContainText(
    '{[audio src=audio/narration-',
  );
  await expect(page.locator('.monaco-editor').first()).toContainText('anchor=document');
});
