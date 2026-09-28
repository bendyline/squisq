/**
 * Motion profiles: resolution precedence, the calm-identity guarantee, and
 * the effects each profile switches on across the templates that opt in.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  MOTION_PROFILES,
  VIEWPORT_PRESETS,
  createTemplateContext,
  isMotionProfileName,
  readFrontmatterMotion,
  resolveMotionForDoc,
  resolveMotionProfile,
  resolveTheme,
} from '../schemas/index.js';
import type { Animation, Layer } from '../schemas/Doc.js';
import type { Theme } from '../schemas/Theme.js';
import type { DocBlock } from '../schemas/BlockTemplates.js';
import {
  expandDocBlocks,
  isGeometryBoundTemplate,
  motionEntrance,
  motionDelay,
} from '../doc/index.js';

const NEW_TYPES = new Set([
  'fadeInUp',
  'slideIn',
  'wordReveal',
  'countUp',
  'drawOn',
  'grow',
  'reveal',
  'drift',
  'tween',
]);

/** One block of every template that opts into motion. */
function motionBlocks(): DocBlock[] {
  return [
    {
      template: 'barChart',
      id: 'bars',
      duration: 8,
      audioSegment: 0,
      title: 'Rainfall',
      headers: ['Month', 'mm'],
      rows: [
        ['Jan', '120'],
        ['Feb', '80'],
        ['Mar', '-20'],
      ],
      showValues: true,
    },
    {
      template: 'columnChart',
      id: 'columns',
      duration: 8,
      audioSegment: 0,
      headers: ['Year', 'Visitors'],
      rows: [
        ['2019', '100'],
        ['2020', '40'],
      ],
    },
    {
      template: 'lineChart',
      id: 'line',
      duration: 8,
      audioSegment: 0,
      headers: ['Year', 'Visitors'],
      rows: [
        ['2019', '100'],
        ['2020', '40'],
        ['2021', '70'],
      ],
      showValues: true,
    },
    {
      template: 'pieChart',
      id: 'pie',
      duration: 8,
      audioSegment: 0,
      headers: ['Kind', 'Share'],
      rows: [
        ['Forest', '60'],
        ['Farm', '40'],
      ],
      showValues: true,
    },
    {
      template: 'statHighlight',
      id: 'stat',
      duration: 8,
      audioSegment: 0,
      stat: '73%',
      description: 'of the island is forest',
      detail: 'according to the 2021 survey',
    },
    {
      template: 'statHighlight',
      id: 'stat-year',
      duration: 8,
      audioSegment: 0,
      stat: '1889',
      description: 'the year the fire struck',
    },
    {
      template: 'comparisonBar',
      id: 'compare',
      duration: 8,
      audioSegment: 0,
      leftLabel: 'Tonga',
      leftValue: 100000,
      rightLabel: 'Samoa',
      rightValue: 200000,
      unit: 'people',
    },
    {
      template: 'timeline',
      id: 'timeline',
      duration: 8,
      audioSegment: 0,
      title: 'Milestones',
      tracks: [
        {
          id: 'main',
          label: 'Main',
          events: [
            { id: 'a', label: '1773', position: 0.1, description: 'Cook arrives' },
            { id: 'b', label: '1900', position: 0.5, description: 'Protectorate' },
            { id: 'c', label: '1970', position: 0.9, description: 'Independence' },
          ],
        },
      ],
    },
    {
      template: 'photoGrid',
      id: 'grid',
      duration: 8,
      audioSegment: 0,
      images: [
        { src: 'a.jpg', alt: 'A' },
        { src: 'b.jpg', alt: 'B' },
        { src: 'c.jpg', alt: 'C' },
      ],
      caption: 'Three views',
    },
    {
      template: 'list',
      id: 'list',
      duration: 8,
      audioSegment: 0,
      title: 'Islands',
      items: ['Tongatapu', "Vava'u", "Ha'apai"],
    },
    {
      template: 'diagram',
      id: 'diagram',
      duration: 8,
      audioSegment: 0,
      nodes: [
        { id: 'sun', label: 'Sun', x: 0, y: 0 },
        { id: 'rain', label: 'Rain', x: 2, y: 0 },
        { id: 'crop', label: 'Crop', x: 1, y: 1 },
      ],
      edges: [
        { source: 'sun', target: 'crop' },
        { source: 'rain', target: 'crop' },
      ],
    },
  ] as unknown as DocBlock[];
}

function themeWithMotion(profile: Theme['renderStyle']['motionProfile']): Theme {
  return {
    ...DEFAULT_THEME,
    renderStyle: { ...DEFAULT_THEME.renderStyle, motionProfile: profile },
  };
}

function layersOf(blocks: ReturnType<typeof expandDocBlocks>, id: string): Layer[] {
  const block = blocks.find((b) => b.id === id);
  if (!block?.layers) throw new Error(`no layers for ${id}`);
  return block.layers;
}

function animationOf(layers: Layer[], id: string): Animation | undefined {
  const layer = layers.find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id} among ${layers.map((l) => l.id).join(', ')}`);
  return layer.animation;
}

function allAnimations(blocks: ReturnType<typeof expandDocBlocks>): Animation[] {
  return blocks
    .flatMap((b) => (b.layers ?? []).map((l) => l.animation))
    .filter((a): a is Animation => !!a);
}

describe('resolveMotionProfile', () => {
  it('resolves names and falls back to calm for unknown input', () => {
    expect(resolveMotionProfile('vibrant')).toBe(MOTION_PROFILES.vibrant);
    expect(resolveMotionProfile(undefined)).toBe(MOTION_PROFILES.calm);
    expect(resolveMotionProfile('bogus' as never)).toBe(MOTION_PROFILES.calm);
    expect(resolveMotionProfile('bogus' as never, 'documentary')).toBe(MOTION_PROFILES.documentary);
    expect(isMotionProfileName('documentary')).toBe(true);
    expect(isMotionProfileName('Documentary')).toBe(false);
  });

  it('merges overrides onto a named or fallback base', () => {
    const custom = resolveMotionProfile({ profile: 'documentary', countUp: false });
    expect(custom.name).toBe('documentary');
    expect(custom.countUp).toBe(false);
    expect(custom.chartGrowth).toBe(true);
    const onFallback = resolveMotionProfile({ photoGridStagger: 0.5 }, 'vibrant');
    expect(onFallback.name).toBe('vibrant');
    expect(onFallback.photoGridStagger).toBe(0.5);
    const entrance = resolveMotionProfile({ textEntrance: { duration: 2 } }, 'documentary');
    expect(entrance.textEntrance).toMatchObject({ type: 'fadeInUp', duration: 2 });
    // Wrong-typed overrides are ignored rather than corrupting the profile.
    const wrong = resolveMotionProfile({ chartGrowth: 'yes' as never }, 'documentary');
    expect(wrong.chartGrowth).toBe(true);
  });

  it('accepts an already-resolved profile as its own base', () => {
    expect(resolveMotionProfile(MOTION_PROFILES.vibrant, 'calm')).toEqual(MOTION_PROFILES.vibrant);
  });
});

describe('resolveMotionForDoc precedence', () => {
  const docTheme = themeWithMotion('documentary');
  it('explicit > doc.motion > frontmatter > theme > calm', () => {
    expect(resolveMotionForDoc(null, DEFAULT_THEME).name).toBe('calm');
    expect(resolveMotionForDoc(null, docTheme).name).toBe('documentary');
    expect(
      resolveMotionForDoc({ frontmatter: { 'squisq-motion': 'vibrant' } }, docTheme).name,
    ).toBe('vibrant');
    expect(
      resolveMotionForDoc({ motion: 'calm', frontmatter: { 'squisq-motion': 'vibrant' } }, docTheme)
        .name,
    ).toBe('calm');
    expect(resolveMotionForDoc({ motion: 'calm' }, docTheme, 'vibrant').name).toBe('vibrant');
  });

  it('lets a partial doc spec inherit the theme profile as its base', () => {
    const profile = resolveMotionForDoc({ motion: { countUp: false } }, docTheme);
    expect(profile.name).toBe('documentary');
    expect(profile.countUp).toBe(false);
    expect(profile.chartGrowth).toBe(true);
  });

  it('reads frontmatter names and objects, ignoring junk', () => {
    expect(readFrontmatterMotion({ 'squisq-motion': ' vibrant ' })).toBe('vibrant');
    expect(readFrontmatterMotion({ motion: 'calm' })).toBe('calm');
    expect(readFrontmatterMotion({ 'squisq-motion': 'loud' })).toBeUndefined();
    expect(readFrontmatterMotion({ 'squisq-motion': { profile: 'vibrant' } })).toEqual({
      profile: 'vibrant',
    });
    expect(readFrontmatterMotion(undefined)).toBeUndefined();
  });

  it('built-in themes declare their profiles', () => {
    expect(resolveTheme('warm-earth').renderStyle.motionProfile).toBe('documentary');
    expect(resolveTheme('bold').renderStyle.motionProfile).toBe('vibrant');
    expect(resolveTheme('standard').renderStyle.motionProfile).toBeUndefined();
  });
});

describe('calm is byte-identical to pre-profile output', () => {
  it('createTemplateContext defaults to the theme profile, else calm', () => {
    expect(createTemplateContext(DEFAULT_THEME, 0, 1).motion?.name).toBe('calm');
    expect(createTemplateContext(themeWithMotion('vibrant'), 0, 1).motion?.name).toBe('vibrant');
    expect(
      createTemplateContext(themeWithMotion('vibrant'), 0, 1, VIEWPORT_PRESETS.landscape, {
        motion: 'calm',
      }).motion?.name,
    ).toBe('calm');
  });

  it('emits none of the new animation types and matches a theme without a profile', () => {
    const plain = expandDocBlocks(motionBlocks(), { theme: DEFAULT_THEME });
    const explicitCalm = expandDocBlocks(motionBlocks(), { theme: DEFAULT_THEME, motion: 'calm' });
    const calmOnMotionTheme = expandDocBlocks(motionBlocks(), {
      theme: themeWithMotion('documentary'),
      motion: 'calm',
    });
    expect(JSON.stringify(explicitCalm)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(calmOnMotionTheme)).toBe(JSON.stringify(plain));
    for (const animation of allAnimations(plain)) {
      expect(NEW_TYPES.has(animation.type)).toBe(false);
    }
    // Calm diagrams have no animations at all, exactly as before.
    expect(allAnimations(plain.filter((b) => b.id === 'diagram'))).toEqual([]);
  });

  it('motionEntrance returns the very same fallback object under calm', () => {
    const context = createTemplateContext(DEFAULT_THEME, 0, 1);
    const fallback: Animation = { type: 'fadeIn', duration: 1, delay: 0.3 };
    expect(motionEntrance(context, fallback)).toBe(fallback);
    expect(motionDelay(context, 0.3)).toBe(0.3);
  });
});

describe('documentary profile effects', () => {
  const blocks = expandDocBlocks(motionBlocks(), { theme: DEFAULT_THEME, motion: 'documentary' });
  const profile = MOTION_PROFILES.documentary;

  it('grows bars from their base and lets value labels follow', () => {
    const bars = layersOf(blocks, 'bars');
    expect(animationOf(bars, 'mark-0-0')).toMatchObject({
      type: 'grow',
      origin: 'left',
      duration: profile.chartGrowthDuration,
    });
    // A negative bar grows from the zero line on its right.
    expect(animationOf(bars, 'mark-0-2')).toMatchObject({ type: 'grow', origin: 'right' });
    const label = animationOf(bars, 'val-0-0');
    expect(label?.type).toBe('fadeIn');
    expect(label!.delay!).toBeGreaterThanOrEqual(profile.chartGrowthDuration);
    expect(animationOf(bars, 'title')?.type).toBe('fadeInUp');
    const columns = layersOf(blocks, 'columns');
    expect(animationOf(columns, 'mark-0-0')).toMatchObject({ type: 'grow', origin: 'bottom' });
  });

  it('draws lines on, wipes areas in and pops points as the line reaches them', () => {
    const line = layersOf(blocks, 'line');
    expect(animationOf(line, 'line-0-0')?.type).toBe('drawOn');
    const first = animationOf(line, 'pt-0-0')!;
    const last = animationOf(line, 'pt-0-2')!;
    expect(first.type).toBe('grow');
    expect(last.delay!).toBeGreaterThan(first.delay!);
    const pie = layersOf(blocks, 'pie');
    expect(animationOf(pie, 'mark-0')).toMatchObject({ type: 'grow', origin: 'center' });
    expect(animationOf(pie, 'val-0')?.type).toBe('fadeIn');
  });

  it('counts statistics up but leaves years alone', () => {
    const stat = layersOf(blocks, 'stat');
    expect(animationOf(stat, 'stat')).toMatchObject({
      type: 'countUp',
      duration: profile.countUpDuration,
      count: { from: 0, to: 73, decimals: 0, prefix: '', suffix: '%' },
    });
    expect(animationOf(stat, 'description')).toMatchObject({ type: 'fadeInUp', delay: 0.3 });
    const year = layersOf(blocks, 'stat-year');
    expect(animationOf(year, 'stat')?.type).toBe('zoomIn');
  });

  it('grows comparison bars and counts their values', () => {
    const compare = layersOf(blocks, 'compare');
    expect(animationOf(compare, 'left-bar')).toMatchObject({ type: 'grow', origin: 'left' });
    expect(animationOf(compare, 'right-bar')).toMatchObject({ type: 'grow', delay: 0.3 });
    expect(animationOf(compare, 'left-value')).toMatchObject({
      type: 'countUp',
      count: { to: 100, decimals: 0, prefix: '', suffix: 'K people' },
    });
    expect(animationOf(compare, 'left-label')?.type).toBe('fadeInUp');
  });

  it('builds timelines and diagrams in', () => {
    const timeline = layersOf(blocks, 'timeline');
    const track = timeline.find((l) => l.id.startsWith('timeline-track-main'));
    expect(track?.animation?.type).toBe('drawOn');
    const stem = timeline.find((l) => l.id.startsWith('timeline-stem-'));
    expect(stem?.animation?.type).toBe('drawOn');
    const marker = timeline.find((l) => l.id.startsWith('timeline-marker-'));
    expect(marker?.animation).toMatchObject({ type: 'grow', origin: 'center' });

    const diagram = layersOf(blocks, 'diagram');
    const sun = animationOf(diagram, 'node-card-sun')!;
    const crop = animationOf(diagram, 'node-card-crop')!;
    expect(sun).toMatchObject({ type: 'grow', origin: 'center' });
    const edgeLayer = diagram.find((l) => l.id.startsWith('edge-'));
    const edge = edgeLayer?.animation;
    if (!edge) throw new Error(`no edge among ${diagram.map((l) => l.id).join(', ')}`);
    expect(edge.type).toBe('drawOn');
    // The edge waits for both of its endpoints.
    expect(edge.delay!).toBeGreaterThan(Math.max(sun.delay!, crop.delay!));
    expect(animationOf(diagram, 'node-label-sun')?.delay).toBeGreaterThan(sun.delay!);
  });

  it('staggers photo-grid tiles as wipes and keeps list staggers', () => {
    const grid = layersOf(blocks, 'grid');
    expect(animationOf(grid, 'grid-img-0')).toMatchObject({ type: 'reveal', delay: 0.15 });
    expect(animationOf(grid, 'grid-img-1')!.delay).toBeCloseTo(0.15 + profile.photoGridStagger, 5);
    const list = layersOf(blocks, 'list');
    expect(animationOf(list, 'item-0')).toMatchObject({ type: 'fadeInUp', delay: 0.3 });
    expect(animationOf(list, 'item-1')).toMatchObject({ type: 'fadeInUp', delay: 0.6 });
  });
});

describe('vibrant profile and theme interplay', () => {
  it('compresses authored delays and keeps a typewriter theme typing', () => {
    const vibrant = expandDocBlocks(motionBlocks(), { theme: DEFAULT_THEME, motion: 'vibrant' });
    const list = layersOf(vibrant, 'list');
    expect(animationOf(list, 'item-1')!.delay).toBeCloseTo(0.6 * 0.8, 5);
    expect(animationOf(list, 'item-1')!.easing).toBe(MOTION_PROFILES.vibrant.textEntrance.easing);

    const typewriterTheme: Theme = {
      ...DEFAULT_THEME,
      renderStyle: { ...DEFAULT_THEME.renderStyle, defaultTextAnimation: 'typewriter' },
    };
    const typed = expandDocBlocks(motionBlocks(), { theme: typewriterTheme, motion: 'vibrant' });
    expect(animationOf(layersOf(typed, 'list'), 'item-0')?.type).toBe('typewriter');
  });

  it('honours a doc-level override object that switches one effect off', () => {
    const blocks = expandDocBlocks(motionBlocks(), {
      theme: DEFAULT_THEME,
      motion: { profile: 'vibrant', countUp: false },
    });
    expect(animationOf(layersOf(blocks, 'stat'), 'stat')?.type).toBe('zoomIn');
    expect(animationOf(layersOf(blocks, 'bars'), 'mark-0-0')?.type).toBe('grow');
  });
});

describe('geometry-bound templates', () => {
  it('names the templates whose text must not grow to fit', () => {
    for (const name of ['barChart', 'pieChart', 'comparisonBar', 'timeline', 'diagram', 'map']) {
      expect(isGeometryBoundTemplate(name)).toBe(true);
    }
    for (const name of ['title', 'statHighlight', 'list', 'imageWithCaption', undefined]) {
      expect(isGeometryBoundTemplate(name)).toBe(false);
    }
  });
});
