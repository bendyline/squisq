import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the Record-media dialog's source selector: three independent
 * toggles (Microphone / Camera / Screen) replace the old tab strip. The
 * microphone composes with either video source or stands alone (narration);
 * Camera and Screen are mutually exclusive (no compositing).
 */

async function openRecorder(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('hello-world');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByRole('button', { name: 'Insert' }).click();
  await page.getByRole('menuitem', { name: 'Record media' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record media' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('recorder source selector uses three toggles, not tabs', async ({ page }) => {
  const dialog = await openRecorder(page);

  const mic = dialog.getByRole('button', { name: 'Microphone' });
  const camera = dialog.getByRole('button', { name: 'Camera' });
  const screen = dialog.getByRole('button', { name: 'Screen' });
  await expect(mic).toBeVisible();
  await expect(camera).toBeVisible();
  await expect(screen).toBeVisible();

  // The old tab strip is gone.
  await expect(dialog.getByRole('tab')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Screen + Mic' })).toHaveCount(0);

  // Default is narration: Microphone on, no video.
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(camera).toHaveAttribute('aria-pressed', 'false');
  await expect(screen).toHaveAttribute('aria-pressed', 'false');
});

test('Microphone toggles independently; Camera and Screen are mutually exclusive', async ({
  page,
}) => {
  const dialog = await openRecorder(page);
  const mic = dialog.getByRole('button', { name: 'Microphone' });
  const camera = dialog.getByRole('button', { name: 'Camera' });
  const screen = dialog.getByRole('button', { name: 'Screen' });

  // Microphone is independent.
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');

  // Selecting Camera then Screen turns Camera off (one video source at a time).
  await camera.click();
  await expect(camera).toHaveAttribute('aria-pressed', 'true');
  await screen.click();
  await expect(screen).toHaveAttribute('aria-pressed', 'true');
  await expect(camera).toHaveAttribute('aria-pressed', 'false');

  // The system-audio option appears only for Screen.
  await expect(dialog.getByText('Include system audio (Chrome only)')).toBeVisible();
  await camera.click();
  await expect(dialog.getByText('Include system audio (Chrome only)')).toHaveCount(0);
});
