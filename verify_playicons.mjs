import { chromium } from 'playwright';
const OUT =
  '/private/tmp/claude-501/-Users-mike-gh-squisq/43335268-323d-4534-a771-874fc20558b2/scratchpad';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5210/?sample=about-squisq', { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: 'Play' }).click();
await page.waitForTimeout(1200);
const next = page.locator('button[aria-label="Next slide"]');
for (let i = 0; i < 22; i++) {
  await page.waitForTimeout(650);
  const info = await page.evaluate(() => {
    const txt = (document.querySelector('[data-testid="preview-panel"]')?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim();
    const icons = Array.from(
      document.querySelectorAll('[data-testid="preview-panel"] foreignObject i[class*="fa-"]'),
    );
    return {
      isIconSlide: /becomes an icon/i.test(txt),
      icons: icons.map((el) => ({
        cls: el.getAttribute('class'),
        disp: getComputedStyle(el).display,
        x: Math.round(el.getBoundingClientRect().left),
        y: Math.round(el.getBoundingClientRect().top),
      })),
    };
  });
  if (info.isIconSlide) {
    console.log('icons on slide:');
    info.icons.forEach((ic) =>
      console.log('  ', ic.cls, 'display=' + ic.disp, 'at(' + ic.x + ',' + ic.y + ')'),
    );
    await page.screenshot({ path: `${OUT}/about_icons_fixed.png` });
    break;
  }
  if (
    await next
      .first()
      .isDisabled()
      .catch(() => true)
  )
    break;
  await next.first().click();
}
console.log('errors:', errors.length ? errors.join('|') : '(none)');
await browser.close();
