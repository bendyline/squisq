import { expect, test } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { switchView } from './view-tabs';

test.describe('presentation mode', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('fills the app canvas with a themed, bottom-centered exit control', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await switchView(page, 'Play');

    const shell = page.locator('.squisq-editor-shell[data-host-mode="document"]');
    await page.getByRole('button', { name: 'Present: Fill canvas', exact: true }).click();
    await expect(shell).toHaveAttribute('data-presentation-mode', 'control');

    const shellBox = await shell.boundingBox();
    expect(shellBox).toEqual({ x: 0, y: 0, width: 1280, height: 720 });

    const exit = page.getByRole('button', { name: 'Exit presentation mode', exact: true });
    const exitBox = await exit.boundingBox();
    expect(exitBox).not.toBeNull();
    expect(exitBox!.x + exitBox!.width / 2).toBeCloseTo(640, 0);
    expect(720 - (exitBox!.y + exitBox!.height)).toBeCloseTo(16, 0);

    await expect(page.locator('.squisq-editor-header')).toBeHidden();
    const themeTokens = await exit.evaluate((element) => ({
      background: element.style.getPropertyValue('--squisq-presentation-control-bg'),
      text: element.style.getPropertyValue('--squisq-presentation-control-text'),
      border: element.style.getPropertyValue('--squisq-presentation-control-border'),
    }));
    expect(themeTokens.background).toMatch(/^#/);
    expect(themeTokens.text).toMatch(/^#/);
    expect(themeTokens.border).toMatch(/^#/);

    await exit.click();
    await expect(shell).not.toHaveAttribute('data-presentation-mode');
  });

  test('takes over the native screen with the same exit control', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await switchView(page, 'Play');

    const shell = page.locator('.squisq-editor-shell[data-host-mode="document"]');
    await page.getByRole('button', { name: 'Presentation options' }).click();
    await page.getByRole('menuitemradio', { name: /^Full screen/ }).click();
    await page.getByRole('button', { name: 'Present: Full screen', exact: true }).click();

    await expect(shell).toHaveAttribute('data-presentation-mode', 'fullscreen');
    await expect
      .poll(() =>
        page.evaluate(() => document.fullscreenElement?.matches('.squisq-editor-shell') ?? false),
      )
      .toBe(true);

    const shellBox = await shell.boundingBox();
    const display = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(shellBox).toEqual({ x: 0, y: 0, ...display });

    const exit = page.getByRole('button', { name: 'Exit presentation mode', exact: true });
    await expect(exit).toBeVisible();
    const exitBox = await exit.boundingBox();
    expect(exitBox).not.toBeNull();
    expect(exitBox!.x + exitBox!.width / 2).toBeCloseTo(display.width / 2, 0);
    expect(display.height - (exitBox!.y + exitBox!.height)).toBeCloseTo(16, 0);

    await exit.click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(shell).not.toHaveAttribute('data-presentation-mode');
  });
});
