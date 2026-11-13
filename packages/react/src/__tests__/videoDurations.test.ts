import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { probeVideoDurations, resolveVideoDurations } from '../hooks/useMediaClipDurations';

/**
 * jsdom cannot decode media, so stand in for the browser: a `<video>` whose
 * `src` is one of `lengths` reports that duration on `loadedmetadata`; any
 * other file fails to load.
 */
function stubVideoMetadata(lengths: Record<string, number>): void {
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = create(tag);
    if (tag !== 'video') return el;
    let current = '';
    Object.defineProperty(el, 'duration', { get: () => lengths[current] ?? Number.NaN });
    Object.defineProperty(el, 'src', {
      get: () => current,
      set: (value: string) => {
        current = value;
        queueMicrotask(() =>
          el.dispatchEvent(new Event(value in lengths ? 'loadedmetadata' : 'error')),
        );
      },
    });
    (el as HTMLVideoElement).load = () => {};
    return el;
  }) as typeof document.createElement);
}

const DOC = '# Demo\n\n.\n\n<video src="%SRC%"></video>\n\n# Next\n\nA sentence of its own.\n';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveVideoDurations', () => {
  it('holds a block open for the measured length of its video', async () => {
    stubVideoMetadata({ '/media/held-open.mp4': 95 });
    const doc = markdownToDoc(parseMarkdown(DOC.replace('%SRC%', 'held-open.mp4')));
    expect(doc.blocks[0].duration).toBe(3);

    const timed = await resolveVideoDurations(doc, { basePath: '/media' });
    expect(timed.blocks[0].duration).toBe(95);
    expect(timed.blocks[1].startTime).toBe(95);
  });

  it('leaves the doc as it was when the file cannot be read', async () => {
    stubVideoMetadata({});
    const doc = markdownToDoc(parseMarkdown(DOC.replace('%SRC%', 'missing.mp4')));
    expect(await resolveVideoDurations(doc, { basePath: '/media' })).toBe(doc);
  });
});

describe('probeVideoDurations', () => {
  it('resolves relative sources against the base path and keys by src', async () => {
    stubVideoMetadata({ '/clips/a-probe.webm': 12.5 });
    const durations = await probeVideoDurations(['a-probe.webm', 'b-unreadable.webm'], {
      basePath: '/clips/',
    });
    expect([...durations]).toEqual([['a-probe.webm', 12.5]]);
  });
});
