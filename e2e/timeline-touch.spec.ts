import { test, expect, type CDPSession, type Locator, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectWriteMode } from './view-tabs';

/**
 * The Timeline view under a finger, on a phone (the android-touch and
 * iphone-touch projects supply the device).
 *
 * Drags go through Chromium's own input pipeline (CDP) rather than as
 * synthetic DOM events, so the browser's touch-action decisions — whether a
 * drag is handed to the page or to the track's own scrolling, and the
 * `pointercancel` that follows — are part of what is tested. A swipe across
 * the bars must scroll the track; only the playhead, the ruler, the knob lane,
 * the selected block's grips and a long-pressed clip may take the gesture.
 * WebKit offers no touch drags to automation, so there it covers taps.
 */

/** A 30-second, three-block document whose first block embeds a video. */
async function openTimeline(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption('timeline-media');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  await selectWriteMode(page, 'Timeline');
  await page.getByTestId('timeline-track').waitFor({ state: 'visible' });
}

class Finger {
  private constructor(private readonly cdp: CDPSession) {}

  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }

  async down(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
  }

  /** Glide in even steps, as a finger reports its way across the glass. */
  async move(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    const STEPS = 10;
    for (let step = 1; step <= STEPS; step++) {
      const t = step / STEPS;
      await this.cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1 }],
      });
    }
  }

  async up(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not laid out');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const playhead = (page: Page) => page.getByTestId('timeline-playhead');
const scroller = (page: Page) => page.locator('.squisq-timeline-scroll');
const playheadLeft = (page: Page) =>
  playhead(page).evaluate((node) => parseFloat((node as HTMLElement).style.left) || 0);
const scrollLeft = (page: Page) => scroller(page).evaluate((node) => node.scrollLeft);

test.describe('Timeline taps', () => {
  test('tapping the knob lane moves the playhead there', async ({ page }) => {
    await openTimeline(page);
    const lane = await page.getByTestId('timeline-scrub-lane').boundingBox();
    await page.touchscreen.tap(lane!.x + 150, lane!.y + lane!.height / 2);
    await expect.poll(() => playheadLeft(page)).toBeGreaterThan(100);
  });

  test('tapping a bar selects its block and leaves the grips to the selection', async ({
    page,
  }) => {
    await openTimeline(page);
    const blocks = page.locator('.squisq-timeline-block');
    await expect(blocks.nth(1).locator('.squisq-timeline-edge--right')).toBeHidden();
    await blocks.nth(1).tap({ position: { x: 20, y: 10 } });
    await expect(blocks.nth(1)).toHaveClass(/squisq-timeline-block--active/);
    await expect(page.locator('.squisq-block-card-position')).toContainText('Block 2 of');
    await expect(blocks.nth(1).locator('.squisq-timeline-edge--right')).toBeVisible();
    await expect(blocks.nth(0).locator('.squisq-timeline-edge--right')).toBeHidden();
  });
});

test.describe('Timeline under a finger', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch input is Chromium-only');

  test('the playhead parked at 0s has a finger-sized knob that drags it', async ({ page }) => {
    await openTimeline(page);
    const knob = page.locator('.squisq-timeline-playhead-knob');
    const knobBox = await knob.boundingBox();
    expect(knobBox!.width).toBeGreaterThanOrEqual(18);
    // The gutter keeps time 0 clear of the viewport edge, so the whole knob shows.
    const viewportBox = await scroller(page).boundingBox();
    expect(knobBox!.x).toBeGreaterThan(viewportBox!.x);
    expect(await playheadLeft(page)).toBe(0);

    const finger = await Finger.on(page);
    const start = await centerOf(knob);
    await finger.down(start.x, start.y);
    await finger.move(start, { x: start.x + 120, y: start.y });
    await finger.up();

    await expect.poll(() => playheadLeft(page)).toBeGreaterThan(100);
    await expect(playhead(page)).not.toHaveClass(/squisq-timeline-playhead--scrubbing/);
  });

  test('a finger landing just beside the knob still catches the playhead', async ({ page }) => {
    await openTimeline(page);
    const start = await centerOf(page.locator('.squisq-timeline-playhead-knob'));
    const finger = await Finger.on(page);
    // 14px off the knob's center — wider than a mouse-sized grab column.
    await finger.down(start.x + 14, start.y);
    await finger.move({ x: start.x + 14, y: start.y }, { x: start.x + 104, y: start.y });
    await finger.up();
    await expect.poll(() => playheadLeft(page)).toBeGreaterThan(80);
  });

  test('dragging along the ruler scrubs', async ({ page }) => {
    await openTimeline(page);
    const ruler = page.getByTestId('timeline-ruler');
    const box = await ruler.boundingBox();
    const y = box!.y + box!.height / 2;
    const finger = await Finger.on(page);
    await finger.down(box!.x + 40, y);
    await finger.move({ x: box!.x + 40, y }, { x: box!.x + 200, y });
    await finger.up();
    const left = await playheadLeft(page);
    expect(left).toBeGreaterThan(150);
    // The ruler took the gesture, so the track did not scroll under it.
    expect(await scrollLeft(page)).toBe(0);
  });

  test('scrubbing against the right edge scrolls the track onward', async ({ page }) => {
    await openTimeline(page);
    const view = await scroller(page).boundingBox();
    const start = await centerOf(page.locator('.squisq-timeline-playhead-knob'));
    const finger = await Finger.on(page);
    const edge = { x: view!.x + view!.width - 6, y: start.y };
    await finger.down(start.x, start.y);
    await finger.move(start, edge);
    // Holding still at the edge keeps the track sliding.
    await expect.poll(() => scrollLeft(page)).toBeGreaterThan(40);
    await finger.up();
    expect(await playheadLeft(page)).toBeGreaterThan(view!.width);
  });

  test('a swipe across the bars scrolls the track and edits nothing', async ({ page }) => {
    await openTimeline(page);
    const clip = page.locator('.squisq-timeline-clip--embedded');
    const clipLeft = () => clip.evaluate((node) => (node as HTMLElement).style.left);
    const before = await clipLeft();
    const start = await centerOf(clip);
    const finger = await Finger.on(page);
    await finger.down(start.x + 60, start.y);
    await finger.move({ x: start.x + 60, y: start.y }, { x: start.x - 100, y: start.y });
    await finger.up();

    await expect.poll(() => scrollLeft(page)).toBeGreaterThan(40);
    expect(await clipLeft()).toBe(before);
    await expect(clip).not.toHaveClass(/squisq-timeline-clip--lifted/);
    await expect(page.locator('.squisq-block-card-position')).toContainText('Block 1 of');
  });

  test('a long press lifts a clip, and the finger then moves it', async ({ page }) => {
    await openTimeline(page);
    const clip = page.locator('.squisq-timeline-clip--embedded');
    const beforeBox = await clip.boundingBox();
    const start = await centerOf(clip);
    const finger = await Finger.on(page);
    await finger.down(start.x, start.y);
    await expect(clip).toHaveClass(/squisq-timeline-clip--lifted/);
    await finger.move(start, { x: start.x + 90, y: start.y });
    await finger.up();

    await expect
      .poll(async () => (await clip.boundingBox())?.x ?? 0)
      .toBeGreaterThan(beforeBox!.x + 40);
    await expect(clip).not.toHaveClass(/squisq-timeline-clip--lifted/);

    // Back to the left — the direction a pan would scroll the track. Once the
    // clip is lifted the finger's travel belongs to the clip: no scroll.
    const movedBox = await clip.boundingBox();
    const again = await centerOf(clip);
    await finger.down(again.x, again.y);
    await expect(clip).toHaveClass(/squisq-timeline-clip--lifted/);
    await finger.move(again, { x: again.x - 60, y: again.y });
    expect(await scrollLeft(page)).toBe(0);
    await finger.up();
    await expect
      .poll(async () => (await clip.boundingBox())?.x ?? 0)
      .toBeLessThan(movedBox!.x - 30);
    expect(await scrollLeft(page)).toBe(0);
  });

  test('resize grips show only on the selected block, and a finger drags them', async ({
    page,
  }) => {
    await openTimeline(page);
    const blocks = page.locator('.squisq-timeline-block');
    await expect(blocks.nth(0)).toHaveClass(/squisq-timeline-block--active/);
    await expect(blocks.nth(1).locator('.squisq-timeline-edge--right')).toBeHidden();
    const grip = blocks.nth(0).locator('.squisq-timeline-edge--right');
    await expect(grip).toBeVisible();
    const gripBox = await grip.boundingBox();
    expect(gripBox!.width).toBeGreaterThanOrEqual(18);

    const widthBefore = (await blocks.nth(0).boundingBox())!.width;
    const start = await centerOf(grip);
    const finger = await Finger.on(page);
    await finger.down(start.x, start.y);
    await finger.move(start, { x: start.x + 54, y: start.y });
    await finger.up();
    await expect
      .poll(async () => (await blocks.nth(0).boundingBox())?.width ?? 0)
      .toBeGreaterThan(widthBefore + 30);
    expect(await scrollLeft(page)).toBe(0);
  });
});
