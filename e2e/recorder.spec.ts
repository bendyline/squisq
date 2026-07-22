import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * E2E for the Record-media dialog's source selector: capture pills grouped
 * [Microphone / Camera] and [System audio / Screen] replace the old tab strip.
 * The microphone composes with either video source or stands alone (narration);
 * Camera and Screen can be armed together for a dual (screen + camera
 * picture-in-picture) recording. System audio is a pill in the Screen group,
 * offered only on platforms that can capture it (desktop Chromium); it needs a
 * companion source (mic/camera/screen) but no longer requires Screen — without
 * Screen it mixes into the mic/camera file.
 */

async function openRecorder(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
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

test('Microphone toggles independently; Camera and Screen compose for dual capture', async ({
  page,
}) => {
  const dialog = await openRecorder(page);
  const mic = dialog.getByRole('button', { name: 'Microphone' });
  const camera = dialog.getByRole('button', { name: 'Camera' });
  const screen = dialog.getByRole('button', { name: 'Screen' });
  const systemAudio = dialog.getByRole('button', { name: 'System audio' });

  // Microphone is independent.
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');

  // Camera and Screen are NOT mutually exclusive — both can be armed at once
  // for a dual (screen + camera picture-in-picture) recording.
  await camera.click();
  await expect(camera).toHaveAttribute('aria-pressed', 'true');
  await screen.click();
  await expect(screen).toHaveAttribute('aria-pressed', 'true');
  await expect(camera).toHaveAttribute('aria-pressed', 'true');

  // System audio (Chromium runs this spec) no longer requires Screen — it's
  // enabled whenever any source is armed, and only disabled when none are.
  await expect(systemAudio).toBeVisible();
  await expect(systemAudio).toBeEnabled();
  // Turn every source off → system audio has nothing to attach to.
  await mic.click();
  await camera.click();
  await screen.click();
  await expect(systemAudio).toBeDisabled();
  // Arming any single source re-enables it.
  await camera.click();
  await expect(systemAudio).toBeEnabled();
});
