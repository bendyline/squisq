import { test, expect, type Page } from '@playwright/test';
import { DIAGRAM_GALLERY_HEADINGS } from '../packages/site/src/diagramGallerySample';

/**
 * Screenshot spec: loads the curated diagram gallery (nine AI-style ASCII
 * diagrams, one per fence) and captures each rendered canvas to
 * test-results/diagram-gallery/. Each fence in the doc mounts its own
 * AsciiDiagramWidget canvas; we screenshot them in document order.
 *
 * This is a visual-validation aid, not a pixel-diff gate — it asserts the
 * expected number of canvases render with node cards, then writes the PNGs.
 */

async function loadGallery(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('diagram-gallery');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  // All nine canvases mount.
  await expect(page.locator('.squisq-ascii-diagram-widget-host')).toHaveCount(
    DIAGRAM_GALLERY_HEADINGS.length,
    { timeout: 10_000 },
  );
  await page
    .locator('.squisq-scene-viewport [data-layer-id^="node-card-"]')
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 });
}

test.describe('ASCII diagram gallery screenshots', () => {
  test.use({ viewport: { width: 1400, height: 1000 } });

  test('renders every gallery diagram as a canvas with node cards', async ({ page }) => {
    await loadGallery(page);
    const hosts = page.locator('.squisq-ascii-diagram-widget-host');
    const count = await hosts.count();
    expect(count).toBe(DIAGRAM_GALLERY_HEADINGS.length);
    // Every canvas has at least two node cards (a real diagram).
    for (let i = 0; i < count; i++) {
      const cards = hosts.nth(i).locator('[data-layer-id^="node-card-"]');
      expect(await cards.count()).toBeGreaterThanOrEqual(2);
    }
  });

  test('captures a screenshot of each diagram canvas', async ({ page }) => {
    await loadGallery(page);
    const hosts = page.locator('.squisq-ascii-diagram-widget-host');
    const count = await hosts.count();
    for (let i = 0; i < count; i++) {
      const host = hosts.nth(i);
      await host.scrollIntoViewIfNeeded();
      // Let the Scene fit-on-mount settle before capture.
      await page.waitForTimeout(400);
      const slug = DIAGRAM_GALLERY_HEADINGS[i]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      await host
        .screenshot({
          path: `test-results/diagram-gallery/${String(i + 1).padStart(2, '0')}-${slug}.png`,
          // The Scene runs a fit-on-mount transition; freeze animations and
          // don't block on pixel-stability (the canvas has ambient motion).
          animations: 'disabled',
          caret: 'hide',
          timeout: 15_000,
        })
        .catch(async () => {
          // Fall back to a bounding-box clip if the element never settles.
          const box = await host.boundingBox();
          if (box) {
            await page.screenshot({
              path: `test-results/diagram-gallery/${String(i + 1).padStart(2, '0')}-${slug}.png`,
              clip: box,
              animations: 'disabled',
            });
          }
        });
    }
    // A full-document capture too, for the whole gallery at a glance.
    await page
      .locator('.tiptap.ProseMirror')
      .screenshot({
        path: 'test-results/diagram-gallery/00-gallery-full.png',
        animations: 'disabled',
      })
      .catch(() => {});
  });
});
