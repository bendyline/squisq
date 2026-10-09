/**
 * Hosted videos (YouTube, Vimeo, …) on slides and pages: a top-level paragraph
 * that is only a link to a video page becomes a `videoEmbed` layer through the
 * rich-media path every template shares, drops out of the body text it would
 * otherwise repeat, and `{[videoWithCaption]}` plays it in its own slot.
 */

import { describe, expect, it } from 'vitest';
import { getBlockBodyText, markdownToDoc, materializeBlockLayers } from '../doc/index';
import { buildPreviewDoc } from '../doc/buildPreviewDoc';
import { materializePageSections } from '../doc/page/materializePageSection.js';
import { parseMarkdown } from '../markdown/index';
import { validateDocSchema } from '../schemas/validateDoc';
import type { DocBlock, Layer, TextLayer, VideoEmbedLayer } from '../schemas/index';

const YT = 'dQw4w9WgXcQ';
const WATCH = `https://www.youtube.com/watch?v=${YT}`;

function slideLayers(markdown: string, index = 0): Layer[] {
  const doc = markdownToDoc(parseMarkdown(markdown), {
    articleId: 'video-slides',
    generateCoverBlock: false,
  });
  const slide = buildPreviewDoc(doc).blocks[index] as DocBlock;
  return materializeBlockLayers(slide, { persistentLayers: false }).layers;
}

function embeds(layers: Layer[]): VideoEmbedLayer[] {
  return layers.filter((layer): layer is VideoEmbedLayer => layer.type === 'videoEmbed');
}

function text(layers: Layer[]): string {
  return layers
    .filter((layer): layer is TextLayer => layer.type === 'text')
    .map((layer) => `${layer.content.text}\n${layer.content.html ?? ''}`)
    .join('\n');
}

describe('hosted videos on slides', () => {
  it('turns a video-only section into a slide with the player and its title', () => {
    const layers = slideLayers(`## Launch keynote\n\n[The keynote](https://youtu.be/${YT}?t=42)`);
    const [video] = embeds(layers);
    expect(video).toMatchObject({
      type: 'videoEmbed',
      content: { url: `${WATCH}&t=42s`, title: 'The keynote' },
    });
    // The link is the player now — not also a line of body text.
    expect(text(layers)).toContain('Launch keynote');
    expect(text(layers)).not.toContain('The keynote');
  });

  it('keeps the prose beside the player and titles a bare URL from the heading', () => {
    const layers = slideLayers(
      `## Demo\n\nWatch the walkthrough before the review.\n\nhttps://vimeo.com/76979871`,
    );
    expect(embeds(layers)).toEqual([
      expect.objectContaining({ content: { url: 'https://vimeo.com/76979871', title: 'Demo' } }),
    ]);
    expect(text(layers)).toContain('Watch the walkthrough');
    expect(text(layers)).not.toContain('vimeo.com');
  });

  it('gives a section that is only a video the full-slide video template', () => {
    const slideTemplate = (markdown: string) =>
      buildPreviewDoc(
        markdownToDoc(parseMarkdown(markdown), { articleId: 'auto', generateCoverBlock: false }),
      ).blocks[0]?.template;
    expect(slideTemplate(`## Keynote\n\nhttps://youtu.be/${YT}`)).toBe('videoWithCaption');
    expect(slideTemplate(`## Keynote\n\n[The keynote](https://vimeo.com/76979871)`)).toBe(
      'videoWithCaption',
    );
    // Prose beside it, or a second video, keeps the loss-averse content slide.
    expect(slideTemplate(`## Keynote\n\nWatch it.\n\nhttps://youtu.be/${YT}`)).toBe('content');
    expect(slideTemplate(`## Two\n\nhttps://youtu.be/${YT}\n\nhttps://vimeo.com/76979871`)).toBe(
      'content',
    );
  });

  it('leaves video links in lists and prose as links', () => {
    const layers = slideLayers(
      `## Links\n\n- https://youtu.be/${YT}\n\nSee [the keynote](https://youtu.be/${YT}) first.`,
    );
    expect(embeds(layers)).toHaveLength(0);
    expect(text(layers)).toContain('youtu.be');
  });

  it('plays one player per distinct video', () => {
    const layers = slideLayers(
      `## Two\n\nhttps://youtu.be/${YT}\n\n${WATCH}\n\nhttps://vimeo.com/76979871`,
    );
    expect(embeds(layers).map((layer) => layer.content.url)).toEqual([
      WATCH,
      'https://vimeo.com/76979871',
    ]);
  });

  it('plays a hosted video in the videoWithCaption slot, captioned below it', () => {
    const layers = slideLayers(`## Big Buck Bunny {[videoWithCaption]}\n\nhttps://youtu.be/${YT}`);
    const players = embeds(layers);
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ id: 'bg-video', content: { url: WATCH } });
    expect(layers.some((layer) => layer.type === 'video')).toBe(false);
    const caption = layers.find((layer) => layer.id === 'caption') as TextLayer;
    expect(caption.content.text).toBe('Big Buck Bunny');
    expect(caption.position.y).toBe('90%');
  });

  it('keeps local video files on the clip path, in the template slot only', () => {
    const layers = slideLayers(
      '## Clip {[videoWithCaption]}\n\n<video src="media/clip.mp4"></video>',
    );
    const clips = layers.filter((layer) => layer.type === 'video');
    expect(clips).toEqual([
      expect.objectContaining({
        id: 'bg-video',
        content: expect.objectContaining({ src: 'media/clip.mp4' }),
      }),
    ]);
    expect(embeds(layers)).toHaveLength(0);
  });
});

describe('hosted videos in spoken text', () => {
  it('neither captions nor narrates the video link', () => {
    const doc = markdownToDoc(
      parseMarkdown(`## Demo\n\nWatch this first.\n\n[The keynote](https://youtu.be/${YT})`),
    );
    const block = doc.blocks[0]!;
    expect(getBlockBodyText(block)).toBe('Watch this first.');
    const captionText = (doc.captions?.phrases ?? []).map((phrase) => phrase.text).join(' ');
    expect(captionText).toContain('Watch this first');
    expect(captionText).not.toMatch(/keynote|youtu/);
  });
});

describe('videoEmbed layers in authored docs', () => {
  it('validates the url', () => {
    const doc = (content: unknown) => ({
      articleId: 'a',
      duration: 1,
      blocks: [
        {
          id: 'b',
          startTime: 0,
          duration: 1,
          audioSegment: 0,
          layers: [{ id: 'v', type: 'videoEmbed', position: { x: 0, y: 0 }, content }],
        },
      ],
      audio: { segments: [] },
    });
    const issuesFor = (content: unknown) =>
      validateDocSchema(doc(content)).filter((issue) => issue.path.includes('layers'));
    expect(issuesFor({ url: WATCH })).toEqual([]);
    expect(issuesFor({ title: 'no url' }).map((issue) => issue.path)).toContain(
      'blocks[0].layers[0].content.url',
    );
  });
});

describe('hosted videos on pages', () => {
  function sections(markdown: string) {
    return materializePageSections(markdownToDoc(parseMarkdown(markdown))).map(
      (entry) => entry.section,
    );
  }

  it('carries a video a typed template does not play into its rich content', () => {
    const [card] = sections(
      `## 42 percent {[factCard]}\n\nOf viewers finish the video.\n\nhttps://youtu.be/${YT}`,
    );
    expect(card?.slots.body?.text ?? '').not.toContain('youtu.be');
    const rich = card?.slots.richContent?.markdown ?? [];
    expect(rich).toHaveLength(1);
    expect(rich[0]?.type).toBe('paragraph');
  });

  it('gives videoWithCaption a videoEmbed media slot and no duplicate', () => {
    const [figure] = sections(`## Big Buck Bunny {[videoWithCaption]}\n\nhttps://youtu.be/${YT}`);
    expect(figure?.slots.media).toEqual({
      type: 'videoEmbed',
      url: WATCH,
      title: 'Big Buck Bunny',
    });
    expect(figure?.slots.richContent).toBeUndefined();
  });
});
