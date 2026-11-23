import { test, expect } from '@playwright/test';
import { readStatusBarInEveryView } from './statusBar';

/**
 * The status bar under a finger, on a phone (the android-touch and
 * iphone-touch projects supply the device). It is taller than on a desktop
 * so its controls are targets a finger can hit, and still one height in
 * every view — Narrate's tools included, which collapse to their icons to
 * stay on one row instead of wrapping onto a second.
 *
 * Controls are 40px tall; the floor is 38px because a segmented control's
 * buttons sit inside its 1px border.
 */
test('the status bar is one height in every view, with finger-sized controls', async ({ page }) => {
  test.setTimeout(120_000);
  const readings = await readStatusBarInEveryView(page, 38);
  expect(readings.length).toBeGreaterThan(8);
  const expected = readings[0]!.height;
  expect(expected).toBeGreaterThanOrEqual(44);
  expect(readings.map((r) => `${r.view}: ${r.height}px`)).toEqual(
    readings.map((r) => `${r.view}: ${expected}px`),
  );
  expect(readings.flatMap((r) => r.shortControls.map((c) => `${r.view} — ${c}`))).toEqual([]);
});
