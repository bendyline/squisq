import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getAvailableThemes, resolveTheme } from '@bendyline/squisq/schemas';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

const AXE_PATH = resolve(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  targets: string[];
  details: string[];
}

async function assertNoSeriousAxeViolations(page: Page, selector = 'body'): Promise<void> {
  // Audit the settled interface, not an intermediate opacity during entrance.
  await page
    .locator(selector)
    .first()
    .evaluate(async (root) => {
      const animations = root
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    });
  await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async (rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (!root) throw new Error(`Accessibility audit root not found: ${rootSelector}`);
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Element,
            options: unknown,
          ) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              help: string;
              nodes: Array<{ target: string[]; failureSummary?: string }>;
            }>;
          }>;
        };
      }
    ).axe;
    const result = await axe.run(root, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return result.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.flatMap((node) => node.target),
        details: violation.nodes.map((node) => node.failureSummary ?? ''),
      }));
  }, selector);
  expect(violations satisfies AxeViolation[]).toEqual([]);
}

/** Every built-in theme's primary: the outline tints its chrome with it. */
const THEME_PRIMARIES = getAvailableThemes().flatMap((entry) => {
  const theme = typeof entry === 'string' ? resolveTheme(entry) : entry;
  return theme.colors?.primary ? [[theme.id, theme.colors.primary] as const] : [];
});

/**
 * WCAG contrast of the outline's accent-tinted text (the current row and the
 * template chips) for each accent, against the backgrounds actually painted
 * behind it. The colors are `color-mix()` results, which axe cannot resolve,
 * so each one is painted onto a canvas and read back as sRGB.
 */
async function outlineAccentContrast(
  page: Page,
  primaries: ReadonlyArray<readonly [string, string]>,
): Promise<Array<{ theme: string; target: string; ratio: number }>> {
  return page.locator('.squisq-outline').evaluate((outline, accents) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas unavailable');
    const paint = (layers: string[]): number[] => {
      context.clearRect(0, 0, 1, 1);
      for (const layer of layers) {
        context.fillStyle = layer;
        context.fillRect(0, 0, 1, 1);
      }
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const luminance = (rgb: number[]): number => {
      const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // Backgrounds from the outline pane down to the element, outermost first.
    const backdrop = (element: Element): string[] => {
      const layers: string[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        layers.unshift(getComputedStyle(node).backgroundColor);
        if (node === outline) break;
      }
      return layers;
    };
    const targets = [
      ...outline.querySelectorAll('.squisq-outline-row--current'),
      ...outline.querySelectorAll('.squisq-outline-template-chip'),
    ];
    const results: Array<{ theme: string; target: string; ratio: number }> = [];
    for (const [theme, primary] of accents) {
      (outline as HTMLElement).style.setProperty('--squisq-outline-accent', primary);
      for (const target of targets) {
        const background = luminance(paint(backdrop(target)));
        const text = luminance(paint([getComputedStyle(target).color]));
        const [lighter, darker] = [background, text].sort((a, b) => b - a);
        results.push({
          theme,
          target: `${target.className.split(' ')[0]} "${target.textContent?.trim().slice(0, 24)}"`,
          ratio: Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100,
        });
      }
    }
    return results;
  }, primaries);
}

test.describe('automated accessibility audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('dark menus and settings retain readable contrast', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('.squisq-editor-shell[data-host-mode]')).toHaveAttribute(
      'data-theme',
      'dark',
    );
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await assertNoSeriousAxeViolations(page, '.squisq-view-menu-popover');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Document settings', exact: true }).click();
    await assertNoSeriousAxeViolations(page, '.squisq-doc-settings-dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Export…', exact: true }).click();
    await assertNoSeriousAxeViolations(page, '[role="dialog"]');
  });

  test('outline highlights stay readable under every theme accent', async ({ page }) => {
    // The default sample tags its headings, so the outline shows template chips.
    await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show outline' }).click();
    await page.keyboard.press('Escape');
    // The caret's section is the outline's current row.
    await page.locator('.tiptap.ProseMirror :is(h1, h2)').first().click();
    await expect(page.locator('.squisq-outline-row--current')).toHaveCount(1);
    await expect(page.locator('.squisq-outline-template-chip').first()).toBeVisible();

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('.squisq-editor-shell[data-host-mode]')).toHaveAttribute(
        'data-theme',
        colorScheme,
      );
      const results = await outlineAccentContrast(page, THEME_PRIMARIES);
      expect(results.length).toBeGreaterThan(THEME_PRIMARIES.length);
      const unreadable = results.filter((result) => result.ratio < 4.5);
      expect(unreadable, `${colorScheme}: below 4.5:1`).toEqual([]);
    }
  });

  test('failed imports focus their error dialog and can be dismissed with Escape', async ({
    page,
  }) => {
    await page.getByTestId('site-upload-input').setInputFiles({
      name: 'broken.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('invalid archive'),
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Import failed');
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await assertNoSeriousAxeViolations(page, '[role="dialog"]');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.tiptap.ProseMirror')).toBeVisible();
  });

  test('export settings are labeled, keyboard-contained, and fit a narrow screen', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Export…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export with Options', exact: true });
    await expect(dialog.getByRole('combobox', { name: 'Format', exact: true })).toBeFocused();
    await assertNoSeriousAxeViolations(page, '[role="dialog"]');
    await page.setViewportSize({ width: 390, height: 568 });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await dialog.getByRole('button', { name: 'Export', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('combobox', { name: 'Format', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export…', exact: true })).toBeFocused();
  });

  test('view tabs use one tab stop and arrow/Home/End navigation', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Editor view' });
    await assertNoSeriousAxeViolations(page, '.squisq-toolbar-view-tabs');
    await expect(tabs.getByRole('button')).toHaveCount(0);
    const write = tabs.getByRole('tab', { name: 'Write', exact: true });
    await write.focus();
    await expect(tabs.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Source', exact: true })).toBeFocused();
    // Manual activation keeps lazy editor loading from stealing arrow focus.
    await expect(write).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.locator('[data-view="preview"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(write).toBeFocused();
    await expect(write).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="raw-editor"]')).toBeVisible();
  });

  test('settings and view options remain usable on short narrow screens', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 568 });
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'View options', exact: true });
    await page.keyboard.press('End');
    const last = menu.getByRole('menuitemradio', { name: 'Fonts & colors', exact: true });
    await expect(last).toBeInViewport();
    const bounds = await menu.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('button', { name: 'Document settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Document settings', exact: true });
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    await dialog.getByRole('button', { name: 'Save', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    const screenshot = testInfo.outputPath('narrow-screen-settings.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('narrow-screen-settings', { path: screenshot, contentType: 'image/png' });
  });

  test('view options support keyboard navigation with coherent menu roles', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'View options', exact: true });
    await trigger.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'View options', exact: true });
    await expect(menu.getByRole('menuitemradio', { name: 'Document', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      menu.getByRole('menuitemradio', { name: 'Block-at-a-time', exact: true }),
    ).toBeFocused();
    await assertNoSeriousAxeViolations(page, '.squisq-view-menu-popover');
    await page.keyboard.press('End');
    await expect(
      menu.getByRole('menuitemradio', { name: 'Fonts & colors', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(menu).toHaveCount(0);
    await trigger.press('ArrowUp');
    await expect(
      menu.getByRole('menuitemradio', { name: 'Fonts & colors', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(trigger).not.toBeFocused();
  });

  test('theme picker closes before its settings dialog and preserves the draft', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Document settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Document settings', exact: true });
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved review title');
    const theme = dialog.getByRole('button', { name: 'Theme', exact: true });
    await theme.press('ArrowDown');
    const list = dialog.getByRole('listbox', { name: 'Theme', exact: true });
    await expect(list.getByRole('option', { name: 'Default', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(list.getByRole('option', { name: 'Standard Light', exact: true })).toBeFocused();
    await assertNoSeriousAxeViolations(page, '.squisq-doc-settings-dialog');
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(theme).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Unsaved review title',
    );
    await theme.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(list).toHaveCount(0);
    await expect(theme).toBeFocused();
    await theme.press('Tab');
    await expect(dialog.getByRole('combobox', { name: 'Transform', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('grid cells and filter menus work entirely from the keyboard', async ({ page }) => {
    await page.locator('select').first().selectOption('data-csv-sales');
    const grid = page.locator('.squisq-data-card-grid');
    await expect(grid).toBeVisible();
    const entry = grid.locator('[role="gridcell"][tabindex="0"]');
    await expect(entry).toHaveCount(1);
    await grid.getByRole('button', { name: 'Filter Revenue by value', exact: true }).press('Tab');
    await expect(entry).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(entry).toBeFocused();
    await expect(entry).toHaveAttribute('aria-colindex', '2');
    const trigger = grid.getByRole('button', { name: 'Filter operator for Region', exact: true });
    await trigger.press('Enter');
    const menu = grid.getByRole('menu', { name: 'Filter operator for Region', exact: true });
    await expect(
      menu.getByRole('menuitemradio', { name: '~ Contains', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      menu.getByRole('menuitemradio', { name: "!~ Doesn't contain", exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(grid.locator('.squisq-grid-editor')).toHaveCount(0);
    await entry.press('F2');
    await expect(grid.getByRole('textbox', { name: /Edit Product, row 1/ })).toBeFocused();
    await assertNoSeriousAxeViolations(page, '.squisq-data-card');
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
  });

  test('editor, template dialog, page view, and player have no serious axe violations', async ({
    page,
  }) => {
    await assertNoSeriousAxeViolations(page, '.squisq-editor-shell');

    const heading = page.locator('.tiptap.ProseMirror h1, .tiptap.ProseMirror h2').first();
    await heading.click({ position: { x: 8, y: 8 } });
    await heading.locator('.squisq-template-badge').first().click();
    await expect(page.getByRole('dialog', { name: /Block Type/i })).toBeVisible();
    await assertNoSeriousAxeViolations(page, '[role="dialog"]');
    await page.keyboard.press('Escape');

    await switchView(page, 'Play');
    await selectUseMode(page, 'Page');
    await expect(page.locator('.squisq-page')).toBeVisible();
    await assertNoSeriousAxeViolations(page, '[data-testid="preview-panel"]');

    await selectUseMode(page, 'Video');
    await expect(page.locator('.doc-player')).toBeVisible();
    await assertNoSeriousAxeViolations(page, '[data-testid="preview-panel"]');
  });
});
