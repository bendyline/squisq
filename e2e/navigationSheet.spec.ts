import { test, expect, devices, type CDPSession, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * E2E tests for the navigation sheet: the outline and block previews that a
 * phone-width editor opens from its right edge.
 *
 * Touches go through Chromium's own input pipeline (CDP) rather than as
 * synthetic DOM events, so the browser's touch-action decisions — which hand a
 * sideways drag either to the page or to its own scrolling — are part of what
 * is tested.
 */

const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

async function loadFeaturesSample(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption('features-demo');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
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

async function editorBody(page: Page) {
  const box = await page.locator('.squisq-editor-with-gutter').boundingBox();
  if (!box) throw new Error('editor body not laid out');
  return box;
}

const sheet = (page: Page) => page.getByTestId('navigation-sheet');

test.describe('Navigation sheet on a phone', () => {
  test('follows a swipe from the right edge, opens the outline, and jumps to a section', async ({
    page,
  }) => {
    await loadFeaturesSample(page);
    const body = await editorBody(page);
    const right = body.x + body.width - 2;
    const y = body.y + body.height / 2;
    const finger = await Finger.on(page);

    await finger.down(right, y);
    await finger.move({ x: right, y }, { x: right - 120, y });
    // Mid-drag, the sheet sits part way in, under the finger.
    await expect(sheet(page)).toHaveAttribute('data-state', 'dragging');
    const progress = await sheet(page).evaluate((node) =>
      Number(node.style.getPropertyValue('--squisq-navigation-sheet-progress')),
    );
    expect(progress).toBeGreaterThan(0.2);
    expect(progress).toBeLessThan(0.8);
    await finger.move({ x: right - 120, y }, { x: body.x + 100, y });
    await finger.up();

    await expect(sheet(page)).toHaveAttribute('data-state', 'open');
    await expect(page.getByRole('tab', { name: 'Outline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // A popover, not a takeover: a strip of the document stays in view.
    const panel = page.locator('.squisq-navigation-sheet-panel');
    await expect
      .poll(async () => Math.round((await panel.boundingBox())?.x ?? 0))
      .toBeGreaterThanOrEqual(Math.round(body.x + 56));

    const row = page.locator('.squisq-navigation-sheet .squisq-outline-row', {
      hasText: 'Lists',
    });
    await row.first().tap();
    await expect(sheet(page)).toHaveAttribute('data-state', 'closed');
    const heading = page.locator('.tiptap.ProseMirror :is(h1, h2, h3)', { hasText: 'Lists' });
    await expect(heading.first()).toBeInViewport();
  });

  test('opens block previews when the swipe turns downward', async ({ page }) => {
    await loadFeaturesSample(page);
    const body = await editorBody(page);
    const right = body.x + body.width - 2;
    const y = body.y + 80;
    const finger = await Finger.on(page);

    await finger.down(right, y);
    await finger.move({ x: right, y }, { x: right - 60, y: y + 4 });
    await finger.move({ x: right - 60, y: y + 4 }, { x: right - 70, y: y + 120 });
    await finger.up();

    await expect(sheet(page)).toHaveAttribute('data-state', 'open');
    await expect(page.getByRole('tab', { name: 'Previews' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const cards = page.getByRole('list', { name: 'Block previews' }).getByRole('button');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(1);

    await cards.nth(1).tap();
    await expect(sheet(page)).toHaveAttribute('data-state', 'closed');
  });

  test('swipes back closed, and closes from the strip of document beside it', async ({ page }) => {
    await loadFeaturesSample(page);
    const body = await editorBody(page);
    const right = body.x + body.width - 2;
    const y = body.y + body.height / 2;
    const finger = await Finger.on(page);

    await finger.down(right, y);
    await finger.move({ x: right, y }, { x: body.x + 80, y });
    await finger.up();
    await expect(sheet(page)).toHaveAttribute('data-state', 'open');

    // Measure once the slide-in has finished, not part way across.
    const panelLocator = page.locator('.squisq-navigation-sheet-panel');
    let settledX = Number.NaN;
    await expect
      .poll(async () => {
        const x = Math.round((await panelLocator.boundingBox())?.x ?? -1);
        const settled = x === settledX;
        settledX = x;
        return settled;
      })
      .toBe(true);
    const panel = await panelLocator.boundingBox();
    if (!panel) throw new Error('panel not laid out');
    const start = { x: panel.x + 40, y };
    await finger.down(start.x, start.y);
    await finger.move(start, { x: right, y });
    await finger.up();
    await expect(sheet(page)).toHaveAttribute('data-state', 'closed');

    await finger.down(right, y);
    await finger.move({ x: right, y }, { x: body.x + 80, y });
    await finger.up();
    await expect(sheet(page)).toHaveAttribute('data-state', 'open');
    await page.touchscreen.tap(body.x + 20, y);
    await expect(sheet(page)).toHaveAttribute('data-state', 'closed');
  });

  test('leaves vertical scrolling from the edge to the document', async ({ page }) => {
    await loadFeaturesSample(page);
    const body = await editorBody(page);
    const right = body.x + body.width - 4;
    const scroller = page.locator('.squisq-wysiwyg-container');
    const before = await scroller.evaluate((node) => node.scrollTop);
    const finger = await Finger.on(page);

    await finger.down(right, body.y + body.height - 60);
    await finger.move(
      { x: right, y: body.y + body.height - 60 },
      { x: right - 4, y: body.y + 120 },
    );
    await finger.up();

    await expect(sheet(page)).toHaveAttribute('data-state', 'closed');
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(before);
  });
});

test.describe('Navigation sheet on a wide editor', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false });

  test('stays out of the way when the outline has room as a pane', async ({ page }) => {
    await loadFeaturesSample(page);
    await expect(sheet(page)).toBeHidden();
  });
});
