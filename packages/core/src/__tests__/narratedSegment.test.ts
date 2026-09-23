import { describe, expect, it } from 'vitest';
import { transformNarratedSegment } from '../transform/narratedSegment.js';
import { expandDocBlocks } from '../doc/templates/index.js';
import type { TemplateBlock } from '../schemas/BlockTemplates.js';

const LONG_TEXT =
  'The Gulf is enormous and strangely flat. At its mouth it spans 590 kilometres, widening to ' +
  '675 further south, and it runs more than 700 kilometres from north to south, covering roughly ' +
  '300,000 square kilometres of sea. Yet it is barely a puddle by ocean standards: most of it is ' +
  'only 55 to 70 metres deep. The land that frames it is low and unbroken, with no mountain range ' +
  'to catch the rain. Because of that, the lush tropical growth of the coast fades into the dry ' +
  'scrub of central Australia not as a sharp line but as a slow drying-out of the country. Twice ' +
  'a day the tide moves across this huge shallow basin, rising and falling by two to three metres.';

const IMAGES = Array.from({ length: 8 }, (_, index) => ({
  src: `gulf-${index}.webp`,
  alt: `Gulf view ${index}`,
}));

const CLIPS = [
  { src: 'cyclone.mp4', clipStart: 0, clipEnd: 3.2, sourceDuration: 20, alt: 'Cyclone' },
  { src: 'cyclone.mp4', clipStart: 8, clipEnd: 11.2, sourceDuration: 20, alt: 'Cyclone' },
  { src: 'invest.mp4', clipStart: 0, clipEnd: 4.7, sourceDuration: 30, alt: 'Invest 93S' },
  { src: 'invest.mp4', clipStart: 12, clipEnd: 16.7, sourceDuration: 30, alt: 'Invest 93S' },
];

function segment(
  segmentId: string,
  extra: Partial<Parameters<typeof transformNarratedSegment>[0]> = {},
) {
  return transformNarratedSegment({
    articleId: 'gulf',
    segmentId,
    title: 'The Scale of the Water',
    text: LONG_TEXT,
    duration: 60,
    audioSrc: `${segmentId}.mp3`,
    images: IMAGES,
    videos: CLIPS,
    ...extra,
  });
}

describe('transformNarratedSegment', () => {
  it('creates a deterministic, audio-timed Doc from narration text', () => {
    const input = {
      articleId: 'volcano',
      segmentId: 'intro',
      title: 'Volcano',
      text: 'The crater rises 4,000 feet above the coast. It last erupted in 1984.',
      duration: 24,
      audioSrc: 'intro.mp3',
      includeTitleBlock: true,
      images: [{ src: 'crater.jpg', alt: 'The volcanic crater' }],
    };
    const first = transformNarratedSegment(input, { seed: 7 });
    const second = transformNarratedSegment(input, { seed: 7 });

    expect(first.seed).toBe(7);
    expect(first.doc.blocks).toEqual(second.doc.blocks);
    expect(first.doc.audio.segments[0].src).toBe('intro.mp3');
    expect(first.doc.blocks[0].startTime).toBe(0);
    const end = first.doc.blocks[first.doc.blocks.length - 1]!;
    expect(end.startTime + end.duration).toBeCloseTo(24);
  });

  it('interleaves generic video clips into the transformed sequence', () => {
    const result = transformNarratedSegment({
      articleId: 'harbor',
      segmentId: 'history',
      title: 'History',
      text: 'The harbor grew rapidly after the railway arrived in 1901.',
      duration: 16,
      audioSrc: 'history.mp3',
      videos: [{ src: 'harbor.mp4', clipStart: 10, clipEnd: 18, alt: 'Historic harbor' }],
    });
    expect(result.doc.blocks.some((block) => block.template === 'videoWithCaption')).toBe(true);
  });

  it('paces a long single-paragraph segment into distinct slides no player needs to split', () => {
    const { doc } = segment('section-0');
    const blocks = doc.blocks as unknown as Array<TemplateBlock & { startTime: number }>;

    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) {
      expect(block.duration).toBeLessThanOrEqual(15.0001);
      expect(block.duration).toBeGreaterThanOrEqual(5);
    }
    const images = blocks.filter((block) => block.template === 'imageWithCaption');
    const srcs = images.map((block) => (block as { imageSrc: string }).imageSrc);
    expect(new Set(srcs).size).toBe(srcs.length);

    // Sequential, gap-free timeline covering the narration.
    expect(blocks[0].startTime).toBe(0);
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1];
      expect(blocks[i].startTime).toBeCloseTo(prev.startTime + prev.duration);
    }
    const last = blocks[blocks.length - 1];
    expect(last.startTime + last.duration).toBeCloseTo(60);

    // Players re-time the segment without repeating any slide.
    const expanded = expandDocBlocks(blocks, { audioSegments: [{ startTime: 0, duration: 60 }] });
    expect(expanded.some((block) => block.id.includes('-split-'))).toBe(false);
    expect(expanded).toHaveLength(blocks.length);
  });

  it('emits an unanchored sequence so a host-added section header keeps its slot', () => {
    const { doc } = segment('section-1');
    const blocks = doc.blocks as unknown as TemplateBlock[];
    expect(blocks.some((block) => typeof block.sourceStartTime === 'number')).toBe(false);

    const header: TemplateBlock = {
      template: 'sectionHeader',
      id: 'section-1-header',
      duration: 3,
      audioSegment: 0,
      title: 'The Scale of the Water',
    };
    const expanded = expandDocBlocks([header, ...blocks], {
      audioSegments: [{ startTime: 0, duration: 60 }],
    });
    expect(expanded[0].id).toBe('section-1-header');
    expect(expanded[0].duration).toBeCloseTo(3);
    expect(expanded.map((block) => block.id)).toEqual([
      'section-1-header',
      ...blocks.map((block) => block.id),
    ]);
  });

  it('prefixes every block id with the segment id so composed segments never collide', () => {
    const ids = [segment('intro', { includeTitleBlock: true }), segment('section-0')].flatMap(
      (result) => result.doc.blocks.map((block) => block.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of segment('section-0').doc.blocks.map((block) => block.id)) {
      expect(id.startsWith('section-0-')).toBe(true);
    }
  });

  it('caps clips per segment and prefers different source videos', () => {
    const blocks = segment('section-0').doc.blocks as unknown as TemplateBlock[];
    const clips = blocks.filter((block) => block.template === 'videoWithCaption') as Array<
      TemplateBlock & { videoSrc: string; sourceDuration?: number }
    >;
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.length).toBeLessThanOrEqual(2);
    expect(new Set(clips.map((clip) => clip.videoSrc)).size).toBe(clips.length);
    // sourceDuration on a clip stays the file length, not a timing hint.
    expect(clips.every((clip) => clip.sourceDuration === 20 || clip.sourceDuration === 30)).toBe(
      true,
    );
  });

  it('leans on more text slides when a segment has no media', () => {
    // The transform promotes one extraction per type from a block, so give it
    // a stat, a date and a quote to choose from.
    const text =
      'The Dutch navigator Willem Janszoon charted this coast in 1606, the first recorded ' +
      'European landing in Australia. The gulf covers roughly 300,000 square kilometres of sea. ' +
      '"Fewer people have surfed the Morning Glory than have climbed Mount Everest," one glider ' +
      'pilot said. Each spring pilots gather at Burketown to ride the wave along its leading edge.';
    const withMedia = segment('section-0', { text }).doc.blocks as unknown as TemplateBlock[];
    const textOnly = segment('section-0', { text, images: [], videos: [] }).doc
      .blocks as unknown as TemplateBlock[];
    const textSlides = (blocks: TemplateBlock[]) =>
      blocks.filter(
        (block) => block.template !== 'imageWithCaption' && block.template !== 'videoWithCaption',
      ).length;

    expect(textSlides(textOnly)).toBeGreaterThan(textSlides(withMedia));
    // Unpromoted narration chunks must not resurface as copies of the
    // segment title (markdownToDoc's default sectionHeader).
    expect(textOnly.some((block) => block.template === 'sectionHeader')).toBe(false);
  });
});
