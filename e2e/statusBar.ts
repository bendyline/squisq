import { type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, selectWriteMode, type UseMode, type WriteMode } from './view-tabs';

/**
 * The status bar in every view the View menu offers, measured the same way
 * for the desktop spec (status-bar.spec.ts) and the touch one
 * (status-bar-touch.spec.ts).
 */

const WRITE_MODES: WriteMode[] = ['Write', 'Source', 'Blocks', 'Timeline', 'Summaries'];
const USE_MODES: UseMode[] = [
  'Slideshow',
  'Video',
  'Page',
  'Document',
  'Dashboard',
  'Narrate',
  'Flashcards',
];

/** What each view puts in the bar, waited for so its controls are measured. */
const VIEW_CONTROLS: Partial<Record<WriteMode | UseMode, string>> = {
  Blocks: '.squisq-block-card-nav',
  Timeline: '.squisq-block-card-nav',
  Slideshow: '.squisq-status-slides',
  Video: '[data-testid="playback-controls-compact"]',
  Narrate: '.squisq-teleprompter-statusbar .squisq-teleprompter-bar',
  Flashcards: '[data-testid="flashcard-controls"]',
};

export interface StatusBarReading {
  view: string;
  /** The bar's height, its border included. */
  height: number;
  /** Controls shorter than the minimum, as `name: width×height`. */
  shortControls: string[];
}

/**
 * Open the default sample and read the status bar in each view. A view that
 * hides the bar (Document's print preview, on a desktop) is left out.
 * `minControlHeight` is what every button, select and the playback
 * timeline's clickable strip must reach.
 */
export async function readStatusBarInEveryView(
  page: Page,
  minControlHeight: number,
): Promise<StatusBarReading[]> {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible' });
  const bar = page.locator('.squisq-status-bar');
  const readings: StatusBarReading[] = [];
  const views = [
    ...WRITE_MODES.map((view) => ({ view, select: () => selectWriteMode(page, view) })),
    ...USE_MODES.map((view) => ({ view, select: () => selectUseMode(page, view) })),
  ];
  for (const { view, select } of views) {
    await select();
    const controls = VIEW_CONTROLS[view];
    if (controls) await bar.locator(`.squisq-status-view ${controls}`).waitFor();
    if (!(await bar.isVisible())) continue;
    const reading = await bar.evaluate((element, min) => {
      const named = (el: Element) => {
        const box = el.getBoundingClientRect();
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName;
        return `${name}: ${Math.round(box.width)}×${Math.round(box.height)}`;
      };
      const shown = (el: Element) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      };
      // The timeline's slide markers are aids within its strip, which is the
      // target, so the strip is measured instead of them.
      const timeline = element.querySelector('[aria-label="Playback timeline"]');
      const targets = [...element.querySelectorAll('button, select')]
        .filter((el) => !timeline?.contains(el))
        .concat(timeline ? [timeline] : [])
        .filter(shown);
      return {
        height: element.getBoundingClientRect().height,
        shortControls: targets.filter((el) => el.getBoundingClientRect().height < min).map(named),
      };
    }, minControlHeight);
    readings.push({ view, ...reading });
  }
  return readings;
}
