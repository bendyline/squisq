import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { switchView } from './view-tabs';

/**
 * Insert → Image/Media: one picker for images, video and audio. Video and
 * audio land as inline players (the recorder's `<video>` / `<audio>` tags);
 * an animated GIF stays an image in the markdown but renders with play/pause
 * controls, and loses the image editor's Edit affordance (which would save a
 * single still frame back over the animation).
 *
 * Insert → File takes any file: a data file (csv/tsv/xlsx/parquet) becomes a
 * sidecar reference the Write view shows as a live grid, and anything else
 * (a .zip, a .dat) is stored beside the document and linked by name.
 */

async function loadSample(page: Page, sample: string) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption(sample);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

type PickedFile = { name: string; mimeType: string; buffer: Buffer };

/** Pick `file` through an Insert-menu item's native file chooser. */
async function pickThroughInsert(page: Page, item: 'Image/Media' | 'File', file: PickedFile) {
  await page.locator('.tiptap.ProseMirror').click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await (await chooser).setFiles(file);
}

const insertMedia = (page: Page, file: PickedFile) => pickThroughInsert(page, 'Image/Media', file);

/**
 * A 16×16, 4-color GIF whose frames are each one solid color, looping forever.
 * Image data is written "uncompressed" — a clear code every two pixels keeps
 * every LZW code at 3 bits — which any decoder accepts.
 */
function animatedGif(frameColors: number[]): Buffer {
  const size = 16;
  const out: number[] = [...Buffer.from('GIF89a')];
  out.push(size, 0, size, 0, 0x81, 0, 0); // global color table, 4 entries
  out.push(0x1e, 0x90, 0xff, 0xff, 0x8c, 0x00, 0x2e, 0x8b, 0x57, 0xff, 0xff, 0xff);
  out.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  for (const color of frameColors) {
    out.push(0x21, 0xf9, 4, 0, 20, 0, 0, 0); // 200 ms
    out.push(0x2c, 0, 0, 0, 0, size, 0, size, 0, 0, 2);
    const codes: number[] = [];
    for (let pixel = 0; pixel < size * size; pixel++) {
      if (pixel % 2 === 0) codes.push(4); // clear
      codes.push(color);
    }
    codes.push(5); // end of information
    const data: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const code of codes) {
      acc |= code << bits;
      bits += 3;
      while (bits >= 8) {
        data.push(acc & 0xff);
        acc >>= 8;
        bits -= 8;
      }
    }
    if (bits > 0) data.push(acc & 0xff);
    for (let at = 0; at < data.length; at += 255) {
      const chunk = data.slice(at, at + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}

async function markdownSource(page: Page): Promise<string> {
  await switchView(page, 'Markdown');
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  return (await page.locator('.monaco-editor .view-lines').first().innerText()).replace(
    /\s+/g,
    ' ',
  );
}

test('the Insert menu offers Image/Media and File', async ({ page }) => {
  await loadSample(page, 'e2e-tiny');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Image/Media', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
});

test('a video inserts as an inline player', async ({ page }) => {
  await loadSample(page, 'e2e-tiny');
  await insertMedia(page, {
    name: 'demo-clip.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('not really an mp4'),
  });
  const video = page.locator('.tiptap .squisq-video-node video');
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute('controls', '');

  await expect(async () => {
    expect(await markdownSource(page)).toMatch(
      /<video src="[^"]*demo-clip\.mp4" controls width="480">/,
    );
  }).toPass({ timeout: 5_000 });
});

test('an audio file inserts as an inline player', async ({ page }) => {
  await loadSample(page, 'e2e-tiny');
  await insertMedia(page, {
    name: 'take.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('not really an mp3'),
  });
  await expect(page.locator('.tiptap .squisq-inline-audio-player audio')).toHaveCount(1);

  await expect(async () => {
    expect(await markdownSource(page)).toMatch(/<audio src="[^"]*take\.mp3" controls>/);
  }).toPass({ timeout: 5_000 });
});

test('an animated GIF stays an image and gains play/pause controls', async ({ page }) => {
  await loadSample(page, 'e2e-tiny');
  await insertMedia(page, {
    name: 'spinner.gif',
    mimeType: 'image/gif',
    buffer: animatedGif([0, 1, 2, 3]),
  });

  const figure = page.locator('.tiptap figure').filter({ has: page.locator('img[alt="spinner"]') });
  const pause = figure.getByRole('button', { name: 'Pause animation' });
  await expect(pause).toBeVisible();
  await expect(pause).toContainText('GIF');

  // No Edit affordance: the raster editor would flatten the animation.
  await figure.hover();
  await expect(figure.getByTestId('image-edit-affordance')).toHaveCount(0);

  await pause.click();
  await expect(figure.locator('canvas.squisq-animated-image-still')).toBeVisible();
  const play = figure.getByRole('button', { name: 'Play animation' });
  await play.click();
  await expect(figure.getByRole('button', { name: 'Pause animation' })).toBeVisible();
  await expect(figure.locator('canvas')).toHaveCount(0);

  await expect(async () => {
    expect(await markdownSource(page)).toMatch(/!\[spinner\]\([^)]*spinner\.gif\)/);
  }).toPass({ timeout: 5_000 });
});

test('a CSV added as a file becomes a data sidecar with a live grid', async ({ page }) => {
  await loadSample(page, 'e2e-tiny');
  await pickThroughInsert(page, 'File', {
    name: 'q3.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Region,Revenue\nWest,100\nEast,2000\n', 'utf8'),
  });
  const card = page.locator('.squisq-data-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.locator('.squisq-data-card-name')).toHaveText('q3.csv');
  await expect(page.locator('.squisq-grid-body [role="row"]').first()).toContainText('West');

  await expect(async () => {
    expect(await markdownSource(page)).toMatch(
      /## q3 \{\[dataTable src=[^\]]*_files\/data\/q3\.csv\]\}/,
    );
  }).toPass({ timeout: 5_000 });
});

test('any other file is stored and linked by name', async ({ page }) => {
  await loadSample(page, 'e2e-tiny');
  await pickThroughInsert(page, 'File', {
    name: 'readings.dat',
    mimeType: '',
    buffer: Buffer.from([1, 2, 3]),
  });
  await pickThroughInsert(page, 'File', {
    name: 'Q3 Report.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from([0x50, 0x4b, 5, 6]),
  });
  const editor = page.locator('.tiptap.ProseMirror');
  await expect(editor.locator('a', { hasText: 'readings.dat' })).toHaveAttribute(
    'href',
    /readings\.dat$/,
  );
  await expect(editor.locator('a', { hasText: 'Q3 Report.zip' })).toHaveAttribute(
    'href',
    /Q3 Report\.zip$/,
  );

  await expect(async () => {
    const source = await markdownSource(page);
    expect(source).toMatch(/\[readings\.dat\]\([^)]*readings\.dat\)/);
    // A name with spaces stays ONE link: CommonMark's angle-bracket form.
    expect(source).toMatch(/\[Q3 Report\.zip\]\(<[^>]*Q3 Report\.zip>\)/);
  }).toPass({ timeout: 5_000 });
});
