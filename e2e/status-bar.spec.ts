import { test, expect } from '@playwright/test';
import { readStatusBarInEveryView } from './statusBar';

/**
 * The status bar holds one height in every view, so it does not jump as the
 * views change, and every control in it is a usable target. On a touch
 * screen the bar and its controls are taller: status-bar-touch.spec.ts.
 *
 * Controls are 24px tall; the floor is 22px because a segmented control's
 * buttons (Narrate's Start and Restart) sit inside its 1px border.
 */
test('the status bar is one height in every view, with full-height controls', async ({ page }) => {
  test.setTimeout(120_000);
  const readings = await readStatusBarInEveryView(page, 22);
  expect(readings.length).toBeGreaterThan(8);
  const expected = readings[0]!.height;
  expect(readings.map((r) => `${r.view}: ${r.height}px`)).toEqual(
    readings.map((r) => `${r.view}: ${expected}px`),
  );
  expect(readings.flatMap((r) => r.shortControls.map((c) => `${r.view} — ${c}`))).toEqual([]);
});
