import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectWriteMode, switchView } from './view-tabs';

/**
 * E2E for FillAvailableExtension: a data grid or diagram that ends the
 * document takes the window's spare height instead of stopping at its 420px
 * default. The unit suite covers the measurement against stubbed geometry;
 * only a real browser shows the flex chain turning that height into grid rows
 * and canvas.
 */

test.use({ viewport: { width: 1280, height: 1100 } });

async function upload(page: Page, name: string, mimeType: string, text: string): Promise<void> {
  await page.goto('/');
  await waitForAppReady(page);
  await page.getByTestId('site-upload-input').setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from(text, 'utf8'),
  });
  await switchView(page, 'Editor');
}

function csv(rows: number): string {
  return ['Item,Count', ...Array.from({ length: rows }, (_, i) => `Item ${i + 1},${i + 1}`)].join(
    '\n',
  );
}

interface PageEnd {
  /** Whether everything after the host is blank: hidden source or empty paragraphs. */
  blankAfter: boolean;
  /** Pixels between the bottom of the document's last visible block and the bottom of the visible page. */
  gap: number;
  /** How far the page scrolls. */
  overflow: number;
}

/**
 * How the page ends below the fill host `selector`. The host is not the last
 * thing on the page: the editor keeps an empty paragraph after a widget that
 * ends the document (TrailingParagraphExtension), and the host fills down to
 * just above it. So the gap is measured from the document's last visible
 * block, which must sit at the page's bottom padding.
 */
async function pageEnd(page: Page, selector: string): Promise<PageEnd> {
  return page.evaluate((target) => {
    const container = document.querySelector<HTMLElement>('.squisq-wysiwyg-container');
    const editor = container?.querySelector<HTMLElement>('.ProseMirror');
    const host = document.querySelector(target);
    if (!container || !editor || !host) throw new Error(`missing ${target}`);
    if (host.parentElement !== editor) throw new Error(`${target} is not a top-level block`);

    const visible = (el: Element) => getComputedStyle(el).display !== 'none';
    let last: Element = host;
    let blankAfter = true;
    for (let el = host.nextElementSibling; el; el = el.nextElementSibling) {
      if (!visible(el)) continue;
      last = el;
      if (el.tagName !== 'P' || el.textContent !== '') blankAfter = false;
    }
    return {
      blankAfter,
      gap: container.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
      overflow: container.scrollHeight - container.clientHeight,
    };
  }, selector);
}

function heightOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().height);
}

const SCROLLER = '.squisq-data-card-grid .squisq-grid-scroller';

test.describe('a block at the end of the page fills the window', () => {
  for (const mode of ['Write', 'Blocks'] as const) {
    test(`a long table grows to the bottom of the page (${mode})`, async ({ page }) => {
      await upload(page, 'inventory.csv', 'text/csv', csv(80));
      await selectWriteMode(page, mode);
      await expect(page.locator(SCROLLER)).toBeVisible({ timeout: 20_000 });

      await expect.poll(() => heightOf(page, SCROLLER)).toBeGreaterThan(520);
      // The card stops just above the empty paragraph left to type in after
      // it, which ends at the page's bottom padding: no scrollbar, no gap.
      const end = await pageEnd(page, '.squisq-data-card-host');
      expect(end.blankAfter).toBe(true);
      expect(end.overflow).toBe(0);
      expect(end.gap).toBeGreaterThanOrEqual(0);
      expect(end.gap).toBeLessThan(48);
    });
  }

  test('a short table keeps its natural height', async ({ page }) => {
    await upload(page, 'short.csv', 'text/csv', csv(4));
    await expect(page.locator(SCROLLER)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.squisq-grid-status')).toContainText('4 rows');

    const height = await heightOf(page, SCROLLER);
    expect(height).toBeGreaterThan(410);
    expect(height).toBeLessThan(430);
  });

  test('a diagram grows, and keeps a height someone dragged', async ({ page }) => {
    await upload(
      page,
      'flow.md',
      'text/markdown',
      ['# Flow', '', '```mermaid', 'flowchart TD', '  A[Start] --> B[Finish]', '```', ''].join(
        '\n',
      ),
    );
    const canvasSelector = '.squisq-mermaid-diagram-widget-host .squisq-diagram-inline';
    await expect(page.locator(canvasSelector)).toBeVisible({ timeout: 20_000 });

    await expect.poll(() => heightOf(page, canvasSelector)).toBeGreaterThan(520);
    const filled = await heightOf(page, canvasSelector);
    const end = await pageEnd(page, '.squisq-mermaid-diagram-widget-host');
    expect(end.blankAfter).toBe(true);
    expect(end.overflow).toBe(0);
    expect(end.gap).toBeGreaterThanOrEqual(0);
    expect(end.gap).toBeLessThan(64);

    const handle = page.locator(`${canvasSelector} .squisq-diagram-resize-handle`);
    const box = await handle.boundingBox();
    if (!box) throw new Error('resize handle not laid out');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 100, { steps: 4 });
    await page.mouse.move(x, y - 200, { steps: 4 });
    await page.mouse.up();

    await expect(page.locator(canvasSelector)).toHaveAttribute('data-height-pinned', 'true');
    const pinned = await heightOf(page, canvasSelector);
    expect(pinned).toBeLessThan(filled - 150);
    expect(pinned).toBeGreaterThan(filled - 250);
  });
});
