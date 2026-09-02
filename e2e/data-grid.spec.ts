import { test, expect } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { switchView } from './view-tabs';

/**
 * E2E for the data-sidecar grid (Phase 2): uploading a CSV lands it as a
 * `{[dataTable src=…]}` sidecar whose Write-view card is the real
 * virtualized grid — sortable, filterable, editable, and saved in place.
 *
 * The unit suites cover the kernel/view-state/save mechanics; this covers
 * what only a real browser shows: the lazy grid module actually loads inside
 * the Tiptap widget, the Blob worker boots under the site's CSP, header
 * interactions drive the view, and Save rewrites the sidecar through the
 * site's media provider.
 */

const CSV_SOURCE = ['Region,Revenue', 'West,100', 'East,2000', 'North,30', 'South,-5'].join('\n');

test.describe('data grid', () => {
  test('uploaded CSV opens as a sortable, editable grid that saves in place', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByTestId('site-upload-input').setInputFiles({
      name: 'sales.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV_SOURCE, 'utf8'),
    });

    await switchView(page, 'Editor');

    // The data card mounts the real grid (not the fallback preview card).
    const grid = page.locator('.squisq-data-card-grid[role="grid"]');
    await expect(grid).toBeVisible({ timeout: 20_000 });

    const status = page.locator('.squisq-grid-status');
    await expect(status).toContainText('4 rows');

    // Sort by Revenue: first click asc, second desc → East (2000) leads.
    const revenueSort = page.locator('.squisq-grid-sortbutton').nth(1);
    await revenueSort.click();
    await revenueSort.click();
    const firstDataRow = page.locator('.squisq-grid-body [role="row"]').first();
    await expect(firstDataRow).toContainText('East');

    // Filter Region ~ "orth" → North only; the footer reports the windowing.
    // Typed with REAL keystrokes (not fill): each key must stay in the
    // filter input rather than bubbling into the grid's type-to-edit path.
    const regionFilter = page.locator('.squisq-grid-filterinput').first();
    await regionFilter.click();
    await regionFilter.pressSequentially('orth');
    await expect(status).toContainText('1 row (of 4)', { timeout: 10_000 });
    await expect(page.locator('.squisq-grid-editor')).toHaveCount(0);
    await expect(page.locator('.squisq-grid-dirtybar')).toHaveCount(0);

    // Clear the filter, edit North's revenue, and save.
    await regionFilter.fill('');
    await expect(status).toContainText('4 rows');

    const northRow = page.locator('.squisq-grid-body [role="row"]', { hasText: 'North' }).first();
    await northRow.locator('[role="gridcell"]').nth(1).dblclick();
    const editor = page.locator('.squisq-grid-editor');
    await expect(editor).toBeVisible();
    await editor.fill('45');
    await editor.press('Enter');

    const dirtyBar = page.locator('.squisq-grid-dirtybar');
    await expect(dirtyBar).toBeVisible();
    await dirtyBar.getByRole('button', { name: 'Save' }).click();
    await expect(dirtyBar).toBeHidden({ timeout: 15_000 });

    // The saved value is what the grid shows after the revision bump.
    await expect(northRow).toContainText('45');
  });

  test('the generated CSV sample loads sorted with the chart alongside', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('select').first().selectOption('data-csv-sales');
    await switchView(page, 'Editor');

    const grid = page.locator('.squisq-data-card-grid[role="grid"]');
    await expect(grid).toBeVisible({ timeout: 20_000 });
    // The sample ships `sort=Revenue:desc` on the heading — the first data
    // row must carry the highest revenue in view.
    const revenueHeader = page.locator('[role="columnheader"]', { hasText: 'Revenue' });
    await expect(revenueHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('.squisq-grid-status')).toContainText('90 rows');

    // Switch Region's operator to "Starts with" and type: only the North
    // rows remain (18 = 3 months × 6 products).
    await page.locator('.squisq-grid-opbutton').first().click();
    await page.locator('.squisq-grid-opoption', { hasText: 'Starts with' }).click();
    const regionFilter = page.locator('.squisq-grid-filterinput').first();
    await regionFilter.click();
    await regionFilter.pressSequentially('No');
    await expect(page.locator('.squisq-grid-status')).toContainText('18 rows (of 90)');
    // The op + value persisted onto the heading annotation (visible in Source).
  });

  test('the XLSX formulas sample boots the calc engine and recalculates live', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('select').first().selectOption('data-xlsx-formulas');
    await switchView(page, 'Editor');

    const grid = page.locator('.squisq-data-card-grid[role="grid"]');
    await expect(grid).toBeVisible({ timeout: 20_000 });

    // Formula cells render with the affordance and their source as tooltip.
    const revenueCell = page.locator('.squisq-grid-cell--formula').first();
    await expect(revenueCell).toBeVisible();
    await expect(revenueCell).toHaveAttribute('title', '=B2*C2');

    // The engine really runs in a Web Worker (dev-harness debug global) —
    // a silent fall back to the main thread would fail here.
    await expect
      .poll(async () =>
        page.evaluate(() => (window as { __squisqCalcEngineKind?: string }).__squisqCalcEngineKind),
      )
      .toBe('worker');

    // Edit Widget's Units (130 → 100): Revenue (24×130=3120) must recalc to
    // 2400 and the SUM total (14161) must follow, live, before any save.
    const widgetRow = page.locator('.squisq-grid-body [role="row"]', { hasText: 'Widget' });
    await widgetRow.locator('[role="gridcell"]').nth(2).dblclick();
    const editor = page.locator('.squisq-grid-editor');
    await expect(editor).toBeVisible();
    await editor.fill('100');
    await editor.press('Enter');
    await expect(widgetRow).toContainText('2400');

    const totalRow = page.locator('.squisq-grid-body [role="row"]', { hasText: 'Total' });
    await expect(totalRow).toContainText('13441'); // 14161 - 3120 + 2400

    // Editing the FORMULA itself recalculates too.
    await widgetRow.locator('[role="gridcell"]').nth(3).dblclick();
    await expect(editor).toHaveValue('=B2*C2');
    await editor.fill('=B2*C2*2');
    await editor.press('Enter');
    await expect(widgetRow).toContainText('4800');
    await expect(page.locator('.squisq-grid-dirtybar')).toBeVisible();
  });

  test('the advanced-options engine switch: LET fails in-house, works on IronCalc', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('select').first().selectOption('data-xlsx-formulas');
    await switchView(page, 'Editor');

    const grid = page.locator('.squisq-data-card-grid[role="grid"]');
    await expect(grid).toBeVisible({ timeout: 20_000 });
    const widgetRow = page.locator('.squisq-grid-body [role="row"]', { hasText: 'Widget' });
    const editor = page.locator('.squisq-grid-editor');

    // In-house tier (the default): LET is honest about being unsupported.
    // (SUMIFS used to be the contrast function — then the in-house tier
    // grew the -IFS family and this test failed by computing correctly.)
    await widgetRow.locator('[role="gridcell"]').nth(3).dblclick();
    await editor.fill('=LET(v,C2,v*2)');
    await editor.press('Enter');
    await expect(widgetRow).toContainText('#NAME?');

    // Switch the engine behind Advanced options — the editor remounts.
    await page.getByTestId('advanced-options-button').click();
    await expect(page.getByTestId('advanced-options-dialog')).toBeVisible();
    await page.getByRole('radio', { name: /IronCalc/ }).check();
    await page.getByTestId('advanced-options-dialog').getByLabel('Close').click();
    await expect(page.getByTestId('advanced-options-dialog')).toBeHidden();

    // Same edit on the wasm engine (downloaded on first use): it computes.
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () =>
        page.evaluate(() => (window as { __squisqCalcEngineKind?: string }).__squisqCalcEngineKind),
      )
      .toBe('ironcalc');
    const freshRow = page.locator('.squisq-grid-body [role="row"]', { hasText: 'Widget' });
    await freshRow.locator('[role="gridcell"]').nth(3).dblclick();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.fill('=LET(v,C2,v*2)');
    await editor.press('Enter');
    await expect(freshRow).toContainText('260', { timeout: 20_000 });

    // Leave the harness back on the default for the other tests.
    await page.getByTestId('advanced-options-button').click();
    await page.getByRole('radio', { name: /In-house/ }).check();
    await page.getByTestId('advanced-options-overlay').click({ position: { x: 5, y: 5 } });
  });
});
