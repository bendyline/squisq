/**
 * Media-led templates — `topFeature`, `bottomFeature`, `mediaOnly`: the
 * body's media takes the slide's full width (or the whole slide), and the
 * heading and complete body are re-fitted into the band that is left.
 */

import { describe, expect, it } from 'vitest';
import { markdownToDoc, materializeBlockLayers } from '../doc/index';
import { buildPreviewDoc } from '../doc/buildPreviewDoc';
import { profileBlockContents, recommendTemplatesForBlock } from '../recommend/index';
import { parseMarkdown } from '../markdown/index';
import { VIEWPORT_PRESETS, type ViewportConfig } from '../schemas/Viewport';
import type { Layer, TextLayer } from '../schemas/Doc';

const CLIP = '<video src="clips/Screen Recording 1.mp4" controls width="480"></video>';
const STEPS = '1. Seed the bullets\n2. Expand them into prose\n3. Review the draft';

function slideLayers(
  markdown: string,
  viewport: ViewportConfig = VIEWPORT_PRESETS.landscape,
  mediaAspectRatios?: Record<string, number>,
) {
  const doc = markdownToDoc(parseMarkdown(markdown), {
    articleId: 'media-led',
    generateCoverBlock: false,
  });
  const slide = buildPreviewDoc(doc).blocks[0]!;
  return materializeBlockLayers(slide, { persistentLayers: false, viewport, mediaAspectRatios })
    .layers;
}

const media = (layers: Layer[]) =>
  layers.filter((layer) => ['video', 'videoEmbed', 'image'].includes(layer.type));
const text = (layers: Layer[], id: string) =>
  layers.find((layer): layer is TextLayer => layer.type === 'text' && layer.id === id);
const num = (value: number | string | undefined) => Number(value);

function rectOf(layer: Layer) {
  const { x, y, width, height } = layer.position;
  return { x: num(x), y: num(y), width: num(width), height: num(height) };
}

describe('topFeature', () => {
  it('spans the clip across the top and keeps the complete body below it', () => {
    const { width } = VIEWPORT_PRESETS.landscape;
    const layers = slideLayers(
      `## How it looks {[topFeature]}\n\nThe process is as follows:\n\n${STEPS}\n\n${CLIP}`,
    );
    const [clip] = media(layers);
    expect(clip?.type).toBe('video');
    const clipRect = rectOf(clip!);
    expect(clipRect).toMatchObject({ x: 0, y: 0, width });

    const title = text(layers, 'title')!;
    const body = text(layers, 'body')!;
    expect(num(title.position.y)).toBeGreaterThan(clipRect.height);
    expect(num(body.position.y)).toBeGreaterThan(num(title.position.y));
    expect(body.content.html).toContain('<ol');
    expect(body.content.html).not.toMatch(/video|&lt;/);
    // No frame panel around the media: it is the slide's lead, not an inset.
    expect(layers.some((layer) => layer.id.endsWith('rich-media-frame'))).toBe(false);
  });

  it('gives a heading-only slide nearly all of its height to the media', () => {
    const { height } = VIEWPORT_PRESETS.landscape;
    const layers = slideLayers(`## Demo {[topFeature]}\n\n${CLIP}`);
    expect(rectOf(media(layers)[0]!).height).toBeGreaterThan(height * 0.75);
    expect(text(layers, 'body')).toBeUndefined();
  });

  it('caps a long body so the media keeps most of the slide', () => {
    const { height } = VIEWPORT_PRESETS.landscape;
    const prose = Array.from({ length: 8 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`);
    const layers = slideLayers(`## Notes {[topFeature]}\n\n${prose.join('\n\n')}\n\n${CLIP}`);
    expect(rectOf(media(layers)[0]!).height).toBeGreaterThan(height * 0.5);
    const body = text(layers, 'body')!;
    expect(num(body.position.y) + num(body.position.height)).toBeLessThanOrEqual(height);
  });

  it('shows a picture in the band without repeating its alt text as body copy', () => {
    const layers = slideLayers(
      '## Field notes {[topFeature]}\n\n![Harbor sketch](harbor.png)\n\nNotes from the walk.',
    );
    expect(media(layers).map((layer) => layer.type)).toEqual(['image']);
    expect(text(layers, 'body')?.content.html).not.toContain('Harbor sketch');
    // `content` shows the picture beside its body, so it does not caption it
    // twice either — a pasted picture's alt text is only its file name.
    const content = slideLayers(
      '## Field notes {[content]}\n\n![pasted 05fcd684](notes_files/pasted-05fcd684.png)\n\nNotes from the walk.',
    );
    expect(media(content).map((layer) => layer.type)).toEqual(['image']);
    expect(text(content, 'body')?.content.html).not.toContain('pasted');
    expect(text(content, 'body')?.content.text).toBe('Notes from the walk.');
  });

  it('plays a hosted video in the band', () => {
    const layers = slideLayers('## Keynote {[topFeature]}\n\nhttps://youtu.be/dQw4w9WgXcQ');
    expect(media(layers).map((layer) => layer.type)).toEqual(['videoEmbed']);
  });

  it('is a plain content slide when the block has no media', () => {
    const markdown = (template: string) => `## Notes {[${template}]}\n\n${STEPS}`;
    const strip = (layers: Layer[]) =>
      layers.map(({ id, type, position }) => ({ id, type, position }));
    expect(strip(slideLayers(markdown('topFeature')))).toEqual(
      strip(slideLayers(markdown('content'))),
    );
  });

  it('stays inside a portrait slide', () => {
    const viewport = VIEWPORT_PRESETS.portrait;
    const layers = slideLayers(`## Demo {[topFeature]}\n\n${STEPS}\n\n${CLIP}`, viewport);
    const clipRect = rectOf(media(layers)[0]!);
    expect(clipRect.width).toBe(viewport.width);
    const body = text(layers, 'body')!;
    expect(num(body.position.y)).toBeGreaterThan(clipRect.height);
    expect(num(body.position.y) + num(body.position.height)).toBeLessThanOrEqual(viewport.height);
    // Portrait scales titles down and body copy up; the heading still leads.
    expect(text(layers, 'title')!.content.style.fontSize).toBeGreaterThan(
      body.content.style.fontSize,
    );
  });

  it('fits a measured wide clip on a portrait slide and centers the group', () => {
    const viewport = VIEWPORT_PRESETS.portrait;
    const markdown = `## Demo {[topFeature]}\n\n${STEPS}\n\n${CLIP}`;
    const measured = slideLayers(markdown, viewport, {
      'clips/Screen Recording 1.mp4': 16 / 9,
    });
    const clipRect = rectOf(media(measured)[0]!);
    expect(clipRect.height).toBeCloseTo(viewport.width / (16 / 9));
    expect(clipRect.y).toBeGreaterThan(0);
    const titleY = num(text(measured, 'title')!.position.y);
    expect(titleY - (clipRect.y + clipRect.height)).toBeLessThan(viewport.height * 0.05);

    // An unmeasured clip's 16:9 is only a guess, so it keeps the whole band.
    expect(rectOf(media(slideLayers(markdown, viewport))[0]!).y).toBe(0);
  });
});

describe('bottomFeature', () => {
  it('keeps the text above and runs the clip to the bottom edge', () => {
    const { width, height } = VIEWPORT_PRESETS.landscape;
    const layers = slideLayers(`## How it looks {[bottomFeature]}\n\n${STEPS}\n\n${CLIP}`);
    const clipRect = rectOf(media(layers)[0]!);
    expect(clipRect).toMatchObject({ x: 0, width });
    expect(clipRect.y + clipRect.height).toBeCloseTo(height);

    const body = text(layers, 'body')!;
    expect(num(text(layers, 'title')!.position.y)).toBeLessThan(height * 0.1);
    expect(num(body.position.y) + num(body.position.height)).toBeLessThan(clipRect.y);
  });
});

describe('mediaOnly', () => {
  it('fills the slide with the clip and drops every line of text', () => {
    const { width, height } = VIEWPORT_PRESETS.landscape;
    const layers = slideLayers(`## How it looks {[mediaOnly]}\n\n${STEPS}\n\n${CLIP}`);
    expect(rectOf(media(layers)[0]!)).toEqual({ x: 0, y: 0, width, height });
    expect(layers.filter((layer) => layer.type === 'text')).toEqual([]);
  });

  it('falls back to the heading and body when there is nothing to show', () => {
    const layers = slideLayers(`## Notes {[mediaOnly]}\n\n${STEPS}`);
    expect(text(layers, 'title')?.content.text).toBe('Notes');
    expect(text(layers, 'body')?.content.text).toContain('Review the draft');
  });
});

describe('media-led recommendations', () => {
  const profile = (body: string) => profileBlockContents(parseMarkdown(body).children);
  const ALL = ['content', 'topFeature', 'bottomFeature', 'mediaOnly', 'videoWithCaption'];

  it('offers the full-body features beside content for a compound body with media', () => {
    const compound = profile(`Intro.\n\n${STEPS}\n\nMore prose.\n\n- a\n- b\n\n${CLIP}`);
    expect(compound.hasCompoundBody).toBe(true);
    const { recommended } = recommendTemplatesForBlock(compound, ALL);
    expect(recommended).toEqual(['content', 'topFeature', 'bottomFeature']);
  });

  it('offers every media-led template for a section that is only a clip', () => {
    const { recommended } = recommendTemplatesForBlock(profile(CLIP), ALL);
    expect(recommended).toEqual(
      expect.arrayContaining(['topFeature', 'bottomFeature', 'mediaOnly']),
    );
  });
});
