import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { applyVideoDurations, flattenBlocks, markdownToDoc } from '../doc/markdownToDoc.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import type { Block, Doc, VideoLayer } from '../schemas/Doc.js';

/**
 * A video in a slide's body plays as a video layer. Its block's LENGTH has
 * always counted the clip's cuts (videoTiming); these pin that the layer
 * itself carries them, so what plays is what that length was measured for.
 */

function toDoc(md: string, lengths: Record<string, number> = {}): Doc {
  return applyVideoDurations(
    markdownToDoc(parseMarkdown(md), { articleId: 't' }),
    (src) => lengths[src],
  );
}

function videoLayers(doc: Doc, title: string): VideoLayer[] {
  const blocks = flattenBlocks(doc.blocks);
  const index = blocks.findIndex((b) => b.title === title);
  if (index < 0) throw new Error(`no block titled ${title}`);
  return materializeBlockLayers(blocks[index] as Block, {
    blockIndex: index,
    totalBlocks: blocks.length,
    persistentLayers: false,
  }).layers.filter((layer): layer is VideoLayer => layer.type === 'video');
}

describe('a slide’s body video carries its cuts', () => {
  it('skips the cut and reaches far enough into the file to fill the slide', () => {
    // The reported case: a 3:26 screen recording with 0:10.38–1:54.547 cut.
    const doc = toDoc(
      '# Demo {[bottomFeature]}\n\n.\n\n' +
        '<video src="screen.webm" controls width="480" data-squisq-video-cuts="10.38-114.547"></video>\n',
      { 'screen.webm': 206 },
    );
    const block = flattenBlocks(doc.blocks).find((b) => b.title === 'Demo')!;
    expect(block.duration).toBeCloseTo(101.833, 3);

    const [layer] = videoLayers(doc, 'Demo');
    expect(layer.content.clipStart).toBe(0);
    expect(layer.content.cuts).toEqual([{ start: 10.38, end: 114.547 }]);
    // 101.833 s of PLAYED time ends at the end of the 206 s file — not at
    // 101.833 s into it, which is still inside the cut.
    expect(layer.content.clipEnd).toBeCloseTo(206, 3);
  });

  it('leaves an uncut clip exactly as it was', () => {
    const doc = toDoc('# Demo\n\n.\n\n<video src="demo.mp4" controls></video>\n', {
      'demo.mp4': 40,
    });
    const [layer] = videoLayers(doc, 'Demo');
    expect(layer.content).toMatchObject({ clipStart: 0, clipEnd: 40 });
    expect(layer.content.cuts).toBeUndefined();
  });

  it('keeps an authored out-point and only the cuts inside the trim', () => {
    const doc = toDoc(
      '# Demo\n\n.\n\n<video src="demo.mp4" data-squisq-video-clip-start="10"' +
        ' data-squisq-video-clip-end="40" data-squisq-video-cuts="2-4 20-25 60-70"></video>\n',
    );
    const [layer] = videoLayers(doc, 'Demo');
    expect(layer.content.clipStart).toBe(10);
    expect(layer.content.clipEnd).toBe(40);
    expect(layer.content.cuts).toEqual([{ start: 20, end: 25 }]);
  });

  it('carries the cuts into a template that plays the body video itself', () => {
    const doc = toDoc(
      '# Demo {[videoWithCaption]}\n\n' +
        '<video src="demo.mp4" data-squisq-video-cuts="5-15"></video>\n',
      { 'demo.mp4': 60 },
    );
    const [layer] = videoLayers(doc, 'Demo');
    expect(layer.content.cuts).toEqual([{ start: 5, end: 15 }]);
    // 50 s played, with 10 s skipped: the out-point is the end of the file.
    expect(layer.content.clipEnd).toBeCloseTo(60, 3);
  });
});
