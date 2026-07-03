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
let done = false;
for (let i = 0; i < 22 && !done; i++) {
  await page.waitForTimeout(650);
  const info = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="preview-panel"] svg');
    const txt = (document.querySelector('[data-testid="preview-panel"]')?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim();
    // icons rendered INSIDE the slide svg foreignObject
    const slideIcons = Array.from(
      document.querySelectorAll('[data-testid="preview-panel"] foreignObject i[class*="fa-"]'),
    ).map((el) => el.getAttribute('class'));
    return { isIconSlide: /becomes an icon/i.test(txt), slideIcons };
  });
  if (info.isIconSlide) {
    console.log(
      'ON ICON SLIDE. Icons rendered in slide:',
      info.slideIcons.length ? info.slideIcons.join(', ') : 'NONE',
    );
    await page.screenshot({ path: `${OUT}/about_icons_rendered.png` });
    done = true;
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
console.log('page errors:', errors.length ? errors.join('|') : '(none)');
await browser.close();
