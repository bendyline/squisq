import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSquisqDiagramPicture } from '../export/diagramPictures';

const ASCII_DIAGRAM = [
  '```diagram',
  '+------------+',
  '|  Markdown  |',
  '+-----+------+',
  '      |',
  '      v',
  '+------------+',
  '|   Pages    |',
  '+------------+',
  '```',
].join('\n');

// jsdom has no layout, canvas or image decoding; stand in for the browser.
const BROWSER_STAND_INS: ReadonlyArray<[object, string, unknown]> = [
  [window.SVGElement.prototype, 'getBBox', () => ({ x: 0, y: 0, width: 400, height: 200 })],
  [HTMLImageElement.prototype, 'decode', () => Promise.resolve()],
  [
    HTMLCanvasElement.prototype,
    'getContext',
    () => ({ fillStyle: '', fillRect: () => undefined, drawImage: () => undefined }),
  ],
  [
    HTMLCanvasElement.prototype,
    'toBlob',
    (callback: (blob: { arrayBuffer: () => Promise<ArrayBuffer> }) => void) =>
      callback({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }),
  ],
];

describe('renderSquisqDiagramPicture', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    for (const [target, name, value] of BROWSER_STAND_INS) {
      originals.set(name, Object.getOwnPropertyDescriptor(target, name));
      Object.defineProperty(target, name, { configurable: true, writable: true, value });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [target, name] of BROWSER_STAND_INS) {
      const original = originals.get(name);
      if (original) Object.defineProperty(target, name, original);
      else delete (target as Record<string, unknown>)[name];
    }
  });

  it('draws the diagram even when animation frames fire before React would commit', async () => {
    // A busy host app can deliver frames back to back, ahead of React's
    // scheduler; the picture used to be taken from an empty host then.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 0;
    });

    const picture = await renderSquisqDiagramPicture(ASCII_DIAGRAM);

    expect(picture).not.toBeNull();
    expect(picture?.width).toBeGreaterThan(0);
    expect(Array.from(picture?.data ?? [])).toEqual([137, 80, 78, 71]);
    // The off-screen host never outlives the call.
    expect(document.body.querySelector('svg.block-svg')).toBeNull();
  });
});
