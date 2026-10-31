import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { switchView } from './view-tabs';

/**
 * Cut, Copy and Paste on an image in the Write view (mediaClipboard). Inside
 * its document a copy pastes as the same reference, so the file is not stored
 * twice; anywhere else the clipboard holds the picture itself.
 */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
// Headless Chromium can share the machine's clipboard, so these must not overlap.
test.describe.configure({ mode: 'serial' });

/** A 200×120 red PNG, big enough that the click lands clear of its Edit button and resize handle. */
const RED_SQUARE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAYAAAC3kr3rAAABCUlEQVR42u3TMQ0AAAjAMOQgAv8q8AIG+Hl61MCSRVcOcAsRwCBgEDAIGAQMAgYBg4BBwCCAQcAgYBAwCBgEDAIGAYOAQcAgQoBBwCBgEDAIGAQMAgYBg4BBAIOAQcAgYBAwCBgEDAIGAYOAQQCDgEHAIGAQMAgYBAwCBgGDAAYBg4BBwCBgEDAIGAQMAgYBgwAGAYOAQcAgYBAwCBgEDAIGAQwCBgGDgEHAIGAQMAgYBAwCBgEMAgYBg4BBwCBgEDAIGAQMAgYRAQwCBgGDgEHAIGAQMAgYBAwCGAQMAgYBg4BBwCBgEDAIGAQMIgQYBAwCBgGDgEHAIGAQMAgYBDAIGAQMAgaBDwvhAp6P9VZpPQAAAABJRU5ErkJggg==',
  'base64',
);

const editor = (page: Page) => page.locator('.tiptap.ProseMirror');
const caption = (page: Page) => editor(page).locator('p', { hasText: 'Caption line.' });
const readyImages = (page: Page) => page.locator('.tiptap figure[data-image-state="ready"] img');

/** The part of ProseMirror's view read here, from the editor Tiptap keeps on its element. */
type TiptapElement = HTMLElement & {
  editor: {
    view: { state: { selection: { head: number } }; posAtDOM(node: Node, offset: number): number };
  };
};

/**
 * Wait until ProseMirror's caret is where the browser's is. A click or a caret
 * key moves the DOM selection at once, but ProseMirror adopts it only on a later
 * `selectionchange`, and a key pressed within a few milliseconds acts at the old
 * caret: in a just-loaded editor that is the start, where Enter split "Tiny"
 * and the caption landed above it as a heading.
 */
async function waitForCaret(page: Page) {
  await expect
    .poll(() =>
      editor(page).evaluate((element) => {
        const { view } = (element as TiptapElement).editor;
        const selection = window.getSelection();
        if (!selection?.focusNode) return false;
        return (
          view.posAtDOM(selection.focusNode, selection.focusOffset) === view.state.selection.head
        );
      }),
    )
    .toBe(true);
}

async function loadTinySample(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption('e2e-tiny');
  await editor(page).waitFor({ state: 'visible', timeout: 5_000 });
  // Type only once the sample is in, or the text lands in the editor it replaces.
  await expect(editor(page)).toContainText('Tiny');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await waitForCaret(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Caption line.');
}

/** A document whose body is a line of text and then the red square. */
async function loadWithImage(page: Page) {
  await loadTinySample(page);
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Image/Media', exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: 'red-square.png', mimeType: 'image/png', buffer: RED_SQUARE });
  await expect(readyImages(page)).toHaveCount(1);
}

/** The destinations of the document's `count` images, from the Markdown source. */
async function imageReferences(page: Page, count: number): Promise<string[]> {
  await switchView(page, 'Markdown');
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  let references: string[] = [];
  await expect(async () => {
    const source = await page.locator('.monaco-editor .view-lines').first().innerText();
    references = [...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]!);
    expect(references).toHaveLength(count);
  }).toPass({ timeout: 5_000 });
  await switchView(page, 'Editor');
  await editor(page).waitFor({ state: 'visible' });
  return references;
}

async function chooseFromContextMenu(
  page: Page,
  target: ReturnType<Page['locator']>,
  item: string,
) {
  await target.click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Editor actions' })
    .getByRole('menuitem', { name: item })
    .click();
}

async function clickEndOfCaption(page: Page) {
  await caption(page).click();
  await page.keyboard.press('End');
  // Until then the paste would replace the image the Copy left selected.
  await waitForCaret(page);
}

test('right-click Copy puts the picture on the clipboard, and a paste in the document reuses its file', async ({
  page,
}) => {
  await loadWithImage(page);
  const [original] = await imageReferences(page, 1);
  expect(original).toMatch(/red-square\.png$/);

  await chooseFromContextMenu(page, readyImages(page).first(), 'Copy');

  // Other applications get the PNG itself and an <img> of its data.
  await expect(async () => {
    const clip = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      if (!item?.types.includes('image/png')) return null;
      // The browser re-encodes a clipboard PNG, so compare the picture, not its bytes.
      const bitmap = await createImageBitmap(await item.getType('image/png'));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return {
        html: await (await item.getType('text/html')).text(),
        size: [bitmap.width, bitmap.height],
        pixel: [...context.getImageData(100, 60, 1, 1).data],
      };
    });
    expect(clip?.size).toEqual([200, 120]);
    expect(clip?.pixel).toEqual([220, 60, 40, 255]);
    expect(clip?.html).toMatch(/<img[^>]+src="data:image\/png;base64,/);
  }).toPass({ timeout: 5_000 });

  await clickEndOfCaption(page);
  await page.keyboard.press('ControlOrMeta+V');
  await expect(readyImages(page)).toHaveCount(2);
  expect(await imageReferences(page, 2)).toEqual([original, original]);
});

test('right-click Cut removes the image, and right-click Paste brings back the same reference', async ({
  page,
}) => {
  await loadWithImage(page);
  const [original] = await imageReferences(page, 1);

  await chooseFromContextMenu(page, readyImages(page).first(), 'Cut');
  await expect(page.locator('.tiptap figure')).toHaveCount(0);

  await chooseFromContextMenu(page, caption(page), 'Paste');
  await expect(readyImages(page)).toHaveCount(1);
  expect(await imageReferences(page, 1)).toEqual([original]);
});

test('a copied image pasted into another session arrives as its own stored picture', async ({
  page,
}) => {
  await loadWithImage(page);
  const [original] = await imageReferences(page, 1);
  await readyImages(page).first().click();
  await page.keyboard.press('ControlOrMeta+C');
  await expect(async () => {
    const types = await page.evaluate(async () => (await navigator.clipboard.read())[0]!.types);
    expect(types).toContain('image/png');
  }).toPass({ timeout: 5_000 });

  // A fresh page holds neither the copy's memory nor its file.
  await loadTinySample(page);
  await page.keyboard.press('ControlOrMeta+V');

  await expect(readyImages(page)).toHaveCount(1);
  const [pasted] = await imageReferences(page, 1);
  expect(pasted).toMatch(/\.png$/);
  expect(pasted).not.toBe(original);
});
