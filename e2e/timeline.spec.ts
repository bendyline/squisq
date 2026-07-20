import { test, expect, type Page } from '@playwright/test';
import { switchView } from './view-tabs';

/**
 * E2E tests for the Timeline view: block bars render, selecting a block in the
 * track moves the card editor, and dragging a block's right edge rewrites its
 * `duration` in the markdown source.
 */

async function loadFeaturesSample(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('features-demo');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function enterTimelineMode(page: Page) {
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitemradio', { name: 'Timeline' }).click();
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="timeline-track"]').waitFor({ state: 'visible' });
}

test.describe('Timeline view', () => {
  test('renders a bar per block and scopes the editor to one block', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);

    const blocks = page.locator('.squisq-timeline-block');
    expect(await blocks.count()).toBeGreaterThan(1);
    // The card above shows a single block.
    await expect(page.locator('[data-testid="block-card-view"]')).toBeVisible();
    expect(await page.locator('.tiptap.ProseMirror :is(h1,h2,h3,h4,h5,h6)').count()).toBe(1);
  });

  test('selecting a block in the track moves the card', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);

    await expect(page.locator('.squisq-block-card-position')).toContainText('Block 1 of');
    await page.locator('.squisq-timeline-block').nth(2).click();
    await expect(page.locator('.squisq-block-card-position')).not.toContainText('Block 1 of');
  });

  test('renders a slideshow thumbnail inside every block bar', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);
    const bars = page.locator('.squisq-timeline-block');
    const count = await bars.count();
    expect(count).toBeGreaterThan(1);
    // Each bar carries a thumbnail that renders an SVG.
    const thumbs = page.locator('.squisq-timeline-block-thumb svg');
    await expect(thumbs.first()).toBeVisible();
    expect(await thumbs.count()).toBe(count);
  });

  test('embedded media shows on the track and can move to another block', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('select').first().selectOption('timeline-media');
    await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
    await enterTimelineMode(page);

    // The embedded <video> in block One appears as a clip on the media track.
    const embedded = page.locator('.squisq-timeline-clip--embedded');
    await expect(embedded).toHaveCount(1);

    // Drag it far left (well before block One) — it should relocate/convert.
    const box = await embedded.boundingBox();
    if (!box) throw new Error('no embedded clip box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    // It is now an authored video clip annotation in the markdown.
    await switchView(page, 'Markdown');
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
    await expect(page.locator('.monaco-editor').first()).toContainText('{[video');
    await expect(page.locator('.monaco-editor').first()).not.toContainText('<video');
  });

  test('returning to document view preserves embedded video', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('select').first().selectOption('timeline-media');
    await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
    await expect(page.locator('.tiptap.ProseMirror video')).toHaveCount(1);

    await enterTimelineMode(page);
    await expect(page.locator('.tiptap.ProseMirror video')).toHaveCount(1);

    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemradio', { name: 'Document' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(0);
    await expect(page.locator('.tiptap.ProseMirror video')).toHaveCount(1);

    // The durable markdown is the source of truth; the view transition must
    // not merely leave a stale player node behind after dropping its tag.
    await switchView(page, 'Markdown');
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
    await expect(page.locator('.monaco-editor').first()).toContainText('<video');
  });

  test('returning to document view preserves a newly recorded video', async ({ page }) => {
    await page.addInitScript(() => {
      class FakeMediaRecorder {
        static isTypeSupported() {
          return true;
        }

        state: 'inactive' | 'recording' = 'inactive';
        mimeType: string;
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;

        constructor(
          public stream: MediaStream,
          options?: { mimeType?: string },
        ) {
          this.mimeType = options?.mimeType ?? 'video/webm';
        }

        start() {
          this.state = 'recording';
        }

        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({ data: new Blob(['take'], { type: this.mimeType }) });
          this.onstop?.();
        }
      }

      Object.defineProperty(window, 'MediaRecorder', {
        configurable: true,
        value: FakeMediaRecorder,
      });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => new MediaStream(),
          getDisplayMedia: async () => new MediaStream(),
        },
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('select').first().selectOption('about-squisq');
    const editor = page.locator('.tiptap.ProseMirror');
    await editor.waitFor({ state: 'visible', timeout: 5_000 });
    const firstParagraph = editor.locator('p').first();
    await firstParagraph.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');

    await page.getByRole('button', { name: 'Insert' }).click();
    await page.getByRole('menuitem', { name: 'Record media' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record media' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Camera' }).click();
    await dialog.getByRole('button', { name: 'Start preview' }).click();
    await dialog.getByRole('button', { name: 'Record' }).click();
    await dialog.getByRole('button', { name: 'Stop' }).click();
    await dialog.getByRole('button', { name: 'Save to document' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(editor.locator('video')).toHaveCount(1);
    await editor.locator('video').evaluate((video) => {
      video.setAttribute('data-e2e-recording-instance', 'preserved');
    });

    await enterTimelineMode(page);
    await expect(page.locator('.tiptap.ProseMirror video')).toHaveCount(1);
    await expect(page.locator('.tiptap.ProseMirror video')).toHaveAttribute(
      'data-e2e-recording-instance',
      'preserved',
    );

    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemradio', { name: 'Document' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="timeline-track"]')).toHaveCount(0);
    await expect(page.locator('.tiptap.ProseMirror video')).toHaveCount(1);
    await expect(page.locator('.tiptap.ProseMirror video')).toHaveAttribute(
      'data-e2e-recording-instance',
      'preserved',
    );

    await switchView(page, 'Markdown');
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
    await expect(page.locator('.monaco-editor').first()).toContainText('<video');
  });

  test('typing in block mode keeps the caret in place (no jump to end)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('select').first().selectOption('hello-world');
    await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });

    // Switch to Block-at-a-time mode.
    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemradio', { name: 'Block-at-a-time' }).click();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="block-card-view"]').waitFor({ state: 'visible' });

    // Put the caret at the very start of the body paragraph and type.
    const para = page.locator('.tiptap.ProseMirror p').first();
    await para.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
    await page.keyboard.type('ZZZ');

    // If the caret had jumped to the end after each keystroke, "ZZZ" would land
    // at the end. It should be at the start.
    await expect(para).toHaveText(/^ZZZ/);
  });

  test('Play advances a playhead and Pause halts it; the ruler seeks', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);

    const playhead = page.locator('[data-testid="timeline-playhead"]');
    await expect(playhead).toBeVisible();
    const leftOf = async () =>
      (await playhead.evaluate((el) => parseFloat((el as HTMLElement).style.left))) || 0;

    expect(await leftOf()).toBe(0);

    await page.getByTestId('timeline-play').click();
    await expect(page.getByTestId('timeline-play')).toHaveAttribute('aria-label', 'Pause');
    await expect.poll(leftOf).toBeGreaterThan(0);
    await page.getByTestId('timeline-play').click(); // pause
    await expect(page.getByTestId('timeline-play')).toHaveAttribute('aria-label', 'Play');
    const afterPlay = await leftOf();
    expect(afterPlay).toBeGreaterThan(0);

    // Clicking the ruler seeks the playhead to that position.
    const ruler = page.locator('.squisq-timeline-row--ruler');
    const box = await ruler.boundingBox();
    if (!box) throw new Error('no ruler box');
    await page.mouse.click(box.x + 200, box.y + box.height / 2);
    expect(await leftOf()).toBeGreaterThan(150);

    // The playhead itself is draggable: grab it and drag right to scrub.
    const head = await playhead.boundingBox();
    if (!head) throw new Error('no playhead box');
    await page.mouse.move(head.x + head.width / 2, head.y + 4);
    await page.mouse.down();
    await page.mouse.move(head.x + 120, head.y + 4, { steps: 6 });
    await page.mouse.up();
    expect(await leftOf()).toBeGreaterThan(280);
  });

  test('dragging a block right edge updates its duration in markdown', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);

    const firstBlock = page.locator('.squisq-timeline-block').first();
    const edge = firstBlock.locator('.squisq-timeline-edge--right');
    const box = await edge.boundingBox();
    if (!box) throw new Error('no edge box');

    // Drag the right edge ~90px to the right (~5s at 18px/s).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    // Switch to Markdown and confirm the duration was written in the
    // squisq-native squiggly form (`{[duration=…]}`), not the Pandoc block.
    await switchView(page, 'Markdown');
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
    await expect(page.locator('.monaco-editor').first()).toContainText('{[duration=');
  });
});
