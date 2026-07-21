import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

const AXE_PATH = resolve(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  targets: string[];
}

async function assertNoSeriousAxeViolations(page: Page, selector = 'body'): Promise<void> {
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
              nodes: Array<{ target: string[] }>;
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
      }));
  }, selector);
  expect(violations satisfies AxeViolation[]).toEqual([]);
}

test.describe('automated accessibility audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
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
