import { test, expect, type Locator, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

/**
 * Mermaid paints every flowchart label in one color, chosen to read on the
 * node fill. An edge label sits on the page instead, where that color is often
 * the page's own — white on white in the default theme — so Squisq sends
 * Mermaid theme CSS for those labels (`buildMermaidThemeCss`). Only a real
 * browser resolves Mermaid's stylesheet, that CSS and the editor's own rules
 * into the color a label is finally drawn in.
 */

const EDITOR_LABEL = '.squisq-mermaid-diagram-widget-host span.edgeLabel';
const PAGE_LABEL = '.squisq-page .squisq-mermaid-rendered span.edgeLabel';

async function openSample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption(id);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function openMarkdown(page: Page, lines: string[]): Promise<void> {
  await page.goto('/');
  await waitForAppReady(page);
  await page.getByTestId('site-upload-input').setInputFiles({
    name: 'flow.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(lines.join('\n'), 'utf8'),
  });
  await switchView(page, 'Editor');
}

async function enterPageMode(page: Page): Promise<void> {
  await switchView(page, 'Play');
  await selectUseMode(page, 'Page');
  await page.locator('.squisq-page').waitFor({ state: 'visible', timeout: 5_000 });
}

async function pickTheme(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page
    .getByRole('listbox', { name: 'Theme' })
    .getByRole('option', { name, exact: true })
    .click();
}

/**
 * WCAG contrast between a label's text and what is painted behind it: every
 * background from the label out to the page, composited in order.
 */
function contrast(label: Locator): Promise<number> {
  return label.evaluate((element) => {
    type Rgba = [number, number, number, number];
    const parse = (value: string): Rgba => {
      const parts = (/rgba?\(([^)]+)\)/.exec(value)?.[1] ?? '0 0 0 0')
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const over = (top: Rgba, under: Rgba): Rgba => [
      top[0] * top[3] + under[0] * (1 - top[3]),
      top[1] * top[3] + under[1] * (1 - top[3]),
      top[2] * top[3] + under[2] * (1 - top[3]),
      1,
    ];
    const luminance = (color: Rgba): number => {
      const [r, g, b] = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };

    const layers: Rgba[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const background = parse(getComputedStyle(node).backgroundColor);
      if (background[3] > 0) layers.push(background);
      if (background[3] === 1) break;
    }
    let behind: Rgba = [255, 255, 255, 1];
    for (const layer of layers.reverse()) behind = over(layer, behind);
    // The text itself is the paragraph Mermaid puts inside the label's span.
    const text = over(parse(getComputedStyle(element.querySelector('p') ?? element).color), behind);
    const [lighter, darker] = [luminance(text), luminance(behind)].sort((a, b) => b - a);
    return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
  });
}

test.describe('Mermaid edge labels read on the page', () => {
  test('in the editor', async ({ page }) => {
    await openSample(page, 'e2e-diagrams');
    const label = page.locator(EDITOR_LABEL, { hasText: 'Yes' });
    await expect(label).toBeVisible({ timeout: 20_000 });
    expect(await contrast(label)).toBeGreaterThan(4.5);
  });

  test('in Page view, on a light theme and a dark one', async ({ page }) => {
    await openSample(page, 'e2e-diagrams');
    await enterPageMode(page);
    const label = page.locator(PAGE_LABEL, { hasText: 'Yes' });

    // The default theme, Standard: its node text is white, and so is its page.
    await expect(label.locator('p')).toHaveCSS('color', 'rgb(15, 23, 42)', { timeout: 20_000 });
    expect(await contrast(label)).toBeGreaterThan(4.5);

    // Tech Dark: its node text is near-black, and so is its page. Waiting for
    // the theme's own text color is waiting for the diagram to be redrawn.
    await pickTheme(page, 'Tech Dark');
    await expect(label.locator('p')).toHaveCSS('color', 'rgb(224, 224, 224)', { timeout: 20_000 });
    expect(await contrast(label)).toBeGreaterThan(4.5);
  });

  test('keep a color the author gave the link', async ({ page }) => {
    await openMarkdown(page, [
      '# Flow',
      '',
      '```mermaid',
      'flowchart LR',
      '  a[Draft] -->|Go| b[Done]',
      '  b -->|Back| a',
      '  linkStyle 0 color:#ff00ff',
      '```',
      '',
    ]);
    const authored = page.locator(EDITOR_LABEL, { hasText: 'Go' });
    await expect(authored).toBeVisible({ timeout: 20_000 });
    await expect(authored.locator('p')).toHaveCSS('color', 'rgb(255, 0, 255)');
    expect(await contrast(page.locator(EDITOR_LABEL, { hasText: 'Back' }))).toBeGreaterThan(4.5);
  });
});
