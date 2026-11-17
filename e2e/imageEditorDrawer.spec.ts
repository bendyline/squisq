import { test, expect, devices, type CDPSession, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * E2E tests for the image editor's layers and properties drawer: the side
 * pane that a phone-width image editor tucks past the right edge, leaving a
 * tab showing.
 *
 * Touches go through Chromium's own input pipeline (CDP) rather than as
 * synthetic DOM events, so the browser's touch-action decisions are part of
 * what is tested, as in navigationSheet.spec.ts.
 */

const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];

async function openImageEditor(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.getByRole('button', { name: 'Image Editor' }).click();
  await page.getByTestId('image-editor').waitFor({ state: 'visible', timeout: 8000 });
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

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} not laid out`);
  return box;
}

const drawer = (page: Page) => page.getByTestId('image-editor-drawer');
const tab = (page: Page) => page.locator('.squisq-image-editor-drawer-tab');

test.describe('Image editor drawer on a phone', () => {
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('gives the canvas the full width, with only the tab showing at the edge', async ({
    page,
  }) => {
    await openImageEditor(page);
    const body = await boxOf(page, '.squisq-image-editor-body');
    const center = await boxOf(page, '.squisq-image-editor-center');
    expect(center.width).toBeCloseTo(body.width, 0);

    await expect(drawer(page)).toHaveAttribute('data-state', 'closed');
    await expect(page.getByTestId('image-editor-layers')).toBeHidden();
    await expect(tab(page)).toBeVisible();
    const tabBox = await boxOf(page, '.squisq-image-editor-drawer-tab');
    expect(tabBox.x + tabBox.width).toBeGreaterThan(body.x + body.width - 2);
    expect(tabBox.x).toBeGreaterThan(body.x + body.width - 48);

    // Every toolbar control is on screen, the save button included.
    const save = page.getByTestId('image-editor-toolbar').getByRole('button', { name: 'Save' });
    await expect(save).toBeInViewport({ ratio: 1 });
  });

  test('opens from a tap on the tab and closes from a tap beside it', async ({ page }) => {
    await openImageEditor(page);
    await tab(page).tap();

    await expect(drawer(page)).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('image-editor-layers')).toBeVisible();
    await expect(tab(page)).toHaveAttribute('aria-expanded', 'true');
    // A strip of the canvas stays in view, and a tap there puts the drawer away.
    const body = await boxOf(page, '.squisq-image-editor-body');
    const panel = await boxOf(page, '.squisq-image-editor-side');
    expect(panel.x).toBeGreaterThan(body.x + 40);
    await page.touchscreen.tap(body.x + 12, body.y + 12);

    await expect(drawer(page)).toHaveAttribute('data-state', 'closed');
    await expect(page.getByTestId('image-editor-layers')).toBeHidden();
  });

  test('follows a swipe in from the right edge, and swipes back out', async ({ page }) => {
    await openImageEditor(page);
    const body = await boxOf(page, '.squisq-image-editor-body');
    const right = body.x + body.width - 4;
    // Below the tab, so the edge strip rather than the tab takes the touch.
    const y = body.y + body.height - 60;
    const finger = await Finger.on(page);

    await finger.down(right, y);
    await finger.move({ x: right, y }, { x: right - 120, y });
    await expect(drawer(page)).toHaveAttribute('data-state', 'dragging');
    const progress = await drawer(page).evaluate((node) =>
      Number(node.style.getPropertyValue('--squisq-image-editor-drawer-progress')),
    );
    expect(progress).toBeGreaterThan(0.2);
    expect(progress).toBeLessThan(0.8);
    await finger.move({ x: right - 120, y }, { x: body.x + 80, y });
    await finger.up();

    await expect(drawer(page)).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('image-editor-layers')).toBeVisible();

    // Back out: a sideways drag across the properties closes it.
    const props = await boxOf(page, '[data-testid="image-editor-properties"]');
    const from = { x: props.x + 40, y: props.y + 20 };
    await finger.down(from.x, from.y);
    await finger.move(from, { x: body.x + body.width - 10, y: from.y + 4 });
    await finger.up();

    await expect(drawer(page)).toHaveAttribute('data-state', 'closed');
  });

  test('leaves the canvas its own touches near the edge', async ({ page }) => {
    await openImageEditor(page);
    const body = await boxOf(page, '.squisq-image-editor-body');
    // Inside the canvas, clear of the edge strip.
    const x = body.x + body.width - 60;
    const y = body.y + body.height - 60;
    const finger = await Finger.on(page);

    await finger.down(x, y);
    await finger.move({ x, y }, { x: x - 150, y });
    await finger.up();

    await expect(drawer(page)).toHaveAttribute('data-state', 'closed');
  });
});

test.describe('Image editor drawer on a wide editor', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false });

  test('keeps layers and properties as a column beside the canvas', async ({ page }) => {
    await openImageEditor(page);

    await expect(page.getByTestId('image-editor-layers')).toBeVisible();
    await expect(tab(page)).toBeHidden();
    const body = await boxOf(page, '.squisq-image-editor-body');
    const panel = await boxOf(page, '.squisq-image-editor-side');
    expect(panel.width).toBeCloseTo(280, 0);
    expect(panel.x + panel.width).toBeCloseTo(body.x + body.width, 0);
  });
});
