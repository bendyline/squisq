import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { flattenBlocks, markdownToDoc } from '../doc/markdownToDoc.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import type { Block, VideoLayer } from '../schemas/Doc.js';

/**
 * A video laid out in a slide is not a scheduled clip, so its layer carries
 * the clip's recipe for the renderer to apply.
 */

function videoLayer(attributes: string, template = ''): VideoLayer {
  const doc = markdownToDoc(
    parseMarkdown(
      `# Demo${template}\n\n.\n\n<video src="demo.mp4" data-squisq-video-clip-end="30" ${attributes}></video>\n`,
    ),
    { articleId: 't' },
  );
  const blocks = flattenBlocks(doc.blocks);
  const index = blocks.findIndex((b) => b.title === 'Demo');
  const layers = materializeBlockLayers(blocks[index] as Block, {
    blockIndex: index,
    totalBlocks: blocks.length,
    persistentLayers: false,
  }).layers.filter((layer): layer is VideoLayer => layer.type === 'video');
  expect(layers).toHaveLength(1);
  return layers[0];
}

describe('a slide’s body video carries its recipe', () => {
  it('hands the renderer the signal chain, gain, fades and crop', () => {
    const layer = videoLayer(
      'data-squisq-video-fx="loudness:-16" data-squisq-video-gain="-3"' +
        ' data-squisq-video-fade-in="0.5" data-squisq-video-fade-out="1"' +
        ' data-squisq-video-crop="0.1 0 0.8 1" data-squisq-video-group="rec-a"',
    );
    expect(layer.content.edits).toEqual({
      fx: { ops: [{ id: 'loudness', value: -16 }], unknown: [] },
      gain: -3,
      fadeIn: 0.5,
      fadeOut: 1,
      crop: { x: 0.1, y: 0, w: 0.8, h: 1 },
    });
    // No cuts: the window is untouched.
    expect(layer.content.cuts).toBeUndefined();
    expect(layer.content.clipEnd).toBe(30);
  });

  it('carries cuts and the rest of the recipe together', () => {
    const layer = videoLayer('data-squisq-video-cuts="10-20" data-squisq-video-gain="-3"');
    expect(layer.content.cuts).toEqual([{ start: 10, end: 20 }]);
    expect(layer.content.edits).toEqual({ gain: -3 });
  });

  it('adds nothing to an unedited clip', () => {
    const layer = videoLayer('controls');
    expect(layer.content.edits).toBeUndefined();
    expect(layer.content.cuts).toBeUndefined();
  });

  it('reaches a template that plays the body video itself', () => {
    const layer = videoLayer('data-squisq-video-crop="0 0 0.5 1"', ' {[videoWithCaption]}');
    expect(layer.content.edits).toEqual({ crop: { x: 0, y: 0, w: 0.5, h: 1 } });
  });
});
