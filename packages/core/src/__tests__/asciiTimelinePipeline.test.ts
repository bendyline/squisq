import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { docToMarkdown } from '../doc/docToMarkdown.js';
import { materializeLayers } from './materializeTestUtils.js';
import { profileBlockContents, recommendTemplatesForBlock } from '../recommend/templates.js';
import type { Block, Layer } from '../schemas/Doc.js';
import type { TimelineBlockInput, TimelineTemplateTrack } from '../schemas/BlockTemplates.js';
import {
  MULTI_TRACK_BRANCH_TIMELINE,
  SINGLE_POINT_ASCII_TIMELINE,
  TICK_INTERPOLATION_TIMELINE,
} from './fixtures/asciiTimelines.js';

const fenced = (art: string, lang = ''): string => '```' + lang + '\n' + art + '\n```';
const AUTO_DOC = [
  '# Timing',
  '',
  '## Tick interpolation',
  '',
  fenced(TICK_INTERPOLATION_TIMELINE),
  '',
].join('\n');

function convert(md: string, options?: Parameters<typeof markdownToDoc>[1]) {
  return markdownToDoc(parseMarkdown(md), { generateCoverBlock: false, ...options });
}

function findBlock(doc: { blocks: Block[] }, title: string): Block | undefined {
  const walk = (blocks: Block[]): Block | undefined => {
    for (const block of blocks) {
      if (block.title === title) return block;
      const nested = block.children ? walk(block.children) : undefined;
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(doc.blocks);
}

describe('auto-template conversion of ASCII timeline fences', () => {
  it('converts the exact sample into an ephemeral timeline block', () => {
    const block = findBlock(convert(AUTO_DOC), 'Tick interpolation');
    expect(block?.template).toBe('timeline');
    expect(block?.autoTemplate).toBe(true);
    const tracks = block?.templateData?.tracks as TimelineTemplateTrack[];
    expect(tracks).toHaveLength(2);
    expect(
      tracks[0].events.filter((event) => event.marker === 'filled').map((event) => event.label),
    ).toEqual(['T28', 'T29', 'T30', 'T31']);
    expect(tracks[1].events.filter((event) => event.callout === false)).toHaveLength(16);
    expect(block?.templateData?.title).toBe('Tick interpolation');
  });

  it('respects both auto-template kill switches', () => {
    expect(
      findBlock(convert(AUTO_DOC, { autoTemplates: false }), 'Tick interpolation')?.template,
    ).not.toBe('timeline');
    const frontmatter = `---\nsquisq-auto-templates: false\n---\n\n${AUTO_DOC}`;
    expect(findBlock(convert(frontmatter), 'Tick interpolation')?.template).not.toBe('timeline');
  });

  it('does not claim the same art when it is tagged as a real programming language', () => {
    const md = [
      '## Tick interpolation',
      '',
      fenced(TICK_INTERPOLATION_TIMELINE, 'typescript'),
      '',
    ].join('\n');
    expect(findBlock(convert(md), 'Tick interpolation')?.template).not.toBe('timeline');
  });

  it('round-trips the exact fence byte content without injecting an annotation', () => {
    const output = stringifyMarkdown(docToMarkdown(convert(AUTO_DOC)));
    expect(output).toContain(TICK_INTERPOLATION_TIMELINE);
    expect(output).not.toContain('{[timeline');
    expect(findBlock(convert(output), 'Tick interpolation')?.template).toBe('timeline');
  });
});

describe('explicit timeline authoring', () => {
  const TAGGED_DOC = ['## Release', '', fenced(SINGLE_POINT_ASCII_TIMELINE, 'timeline'), ''].join(
    '\n',
  );

  it('uses the durable `timeline` language for a sparse one-point track', () => {
    const block = findBlock(convert(TAGGED_DOC), 'Release');
    expect(block?.template).toBe('timeline');
    expect(block?.autoTemplate).toBe(true);
    const tracks = block?.templateData?.tracks as TimelineTemplateTrack[];
    expect(tracks[0].events).toMatchObject([{ id: 'alpha', label: 'Alpha' }]);

    const output = stringifyMarkdown(docToMarkdown(convert(TAGGED_DOC)));
    expect(output).toContain('```timeline');
    expect(output).toContain(SINGLE_POINT_ASCII_TIMELINE);
    expect(output).not.toContain('{[timeline');
  });

  it('derives timeline data from an explicit heading annotation even when auto templates are off', () => {
    const md = [
      '## Release {[timeline]}',
      '',
      fenced(SINGLE_POINT_ASCII_TIMELINE, 'text'),
      '',
    ].join('\n');
    const block = findBlock(convert(md, { autoTemplates: false }), 'Release');
    expect(block?.template).toBe('timeline');
    expect((block?.templateData?.tracks as TimelineTemplateTrack[])[0].events).toMatchObject([
      { id: 'alpha', label: 'Alpha' },
    ]);
  });

  it('round-trips an explicit cadence-only timeline as marker-only events', () => {
    const cadence = 'client frames (120 Hz): f f f f f';
    const md = ['## Frames', '', fenced(cadence, 'timeline'), ''].join('\n');
    const block = findBlock(convert(md), 'Frames');
    expect(block?.template).toBe('timeline');
    const tracks = block?.templateData?.tracks as TimelineTemplateTrack[];
    expect(tracks[0].events).toHaveLength(5);
    expect(tracks[0].events.every((event) => event.callout === false)).toBe(true);
    const output = stringifyMarkdown(docToMarkdown(convert(md)));
    expect(output).toContain('```timeline');
    expect(output).toContain(cadence);
  });

  it('renders an authored callout attached to an otherwise marker-only cadence', () => {
    const cadence = ['Client: f f f f', '        └─ dropped frame'].join('\n');
    const md = ['## Frames', '', fenced(cadence, 'timeline'), ''].join('\n');
    const block = findBlock(convert(md), 'Frames') as Block;
    const layers = materializeLayers(block, {});
    expect(
      layers.some(
        (layer: Layer) => layer.type === 'text' && layer.content.text === 'dropped frame',
      ),
    ).toBe(true);
  });
});

describe('timeline rendering and narration hygiene', () => {
  it('materializes track, marker, callout, and branch primitives', () => {
    const md = ['## Runtime paths', '', fenced(MULTI_TRACK_BRANCH_TIMELINE), ''].join('\n');
    const block = findBlock(convert(md), 'Runtime paths') as Block;
    expect(block.template).toBe('timeline');
    const layers = materializeLayers(block, {});
    const ids = layers.map((layer: Layer) => layer.id);
    expect(ids.filter((id) => /^timeline-track-(?!label-)/.test(id))).toHaveLength(2);
    expect(ids.filter((id) => id.startsWith('timeline-marker-'))).toHaveLength(4);
    expect(ids.some((id) => id.startsWith('timeline-event-label-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('timeline-event-description-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('timeline-link-t29-f29-'))).toBe(true);
  });

  it('renders cadence points without callout spam and keeps opposite-side descriptions', () => {
    const block = findBlock(convert(AUTO_DOC), 'Tick interpolation') as Block;
    const layers = materializeLayers(block, {});
    const markers = layers.filter((layer: Layer) => layer.id.startsWith('timeline-marker-'));
    const calloutText = layers
      .filter((layer: Layer) => layer.type === 'text')
      .map((layer) => (layer.type === 'text' ? layer.content.text : ''));

    // 4 kernel milestones + 16 cadence points + 2 fractional client events.
    expect(markers).toHaveLength(22);
    expect(calloutText).not.toContain('f');
    expect(calloutText).toContain('sim time');

    const t28Label = layers.find((layer: Layer) =>
      layer.id.startsWith('timeline-event-label-t28-'),
    );
    const t28Description = layers.find((layer: Layer) =>
      layer.id.startsWith('timeline-event-description-t28-'),
    );
    const kernelTrack = layers.find(
      (layer: Layer) => layer.id === 'timeline-track-kernel-ticks-30-hz-0',
    );
    expect(t28Label?.position.y).toEqual(expect.any(Number));
    expect(t28Description?.position.y).toEqual(expect.any(Number));
    expect(kernelTrack?.type).toBe('path');
    if (
      typeof t28Label?.position.y === 'number' &&
      typeof t28Description?.position.y === 'number' &&
      kernelTrack?.type === 'path'
    ) {
      const axisY = Number(/^M\s+\S+\s+(\S+)/.exec(kernelTrack.content.d)?.[1]);
      expect(t28Label.position.y).toBeLessThan(axisY);
      expect(t28Description.position.y).toBeGreaterThan(axisY);
    }
  });

  it('surfaces unresolved branch declarations as document diagnostics', () => {
    const art = [
      'Main: ● Start {#start} ─────● Finish {#finish} ─────►',
      'branch: start -> missing : typo',
    ].join('\n');
    const doc = convert(['## Broken branch', '', fenced(art), ''].join('\n'));
    expect(doc.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'timeline-unresolved-link',
          blockId: 'broken-branch',
        }),
      ]),
    );
  });

  it('keeps endpoint callout boxes inside the viewport', () => {
    const endpointBlock: TimelineBlockInput = {
      id: 'endpoint-timeline',
      template: 'timeline',
      duration: 5,
      audioSegment: 0,
      tracks: [
        {
          id: 'edge',
          events: [
            { id: 'left', label: 'Left endpoint', position: 0, side: 'above' },
            { id: 'right', label: 'Right endpoint', position: 1, side: 'below' },
          ],
        },
      ],
    };
    const layers = materializeLayers(endpointBlock, {
      viewport: { name: 'test-landscape', width: 1920, height: 1080 },
    });
    const labels = layers.filter(
      (layer: Layer) => layer.type === 'text' && layer.id.startsWith('timeline-event-label-'),
    );
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      const x = label.position.x;
      const width = label.position.width;
      expect(typeof x).toBe('number');
      expect(typeof width).toBe('number');
      if (typeof x === 'number' && typeof width === 'number') {
        expect(x - width / 2).toBeGreaterThanOrEqual(0);
        expect(x + width / 2).toBeLessThanOrEqual(1920);
      }
    }
  });

  it('does not repeat the title in an empty timeline hint', () => {
    const empty: TimelineBlockInput = {
      id: 'empty-timeline',
      template: 'timeline',
      duration: 5,
      audioSegment: 0,
      title: 'Release history',
      tracks: [],
    };
    const text = materializeLayers(empty, {})
      .filter((layer: Layer) => layer.type === 'text')
      .map((layer) => (layer.type === 'text' ? layer.content.text : ''));
    expect(text.filter((value) => value === 'Release history')).toHaveLength(1);
    expect(text).toContain('No timeline events');
  });

  it('renders every public input event even when ids are duplicated across tracks', () => {
    const duplicateIds: TimelineBlockInput = {
      id: 'duplicate-event-ids',
      template: 'timeline',
      duration: 5,
      audioSegment: 0,
      tracks: [
        { id: 'a', events: [{ id: 'start', label: 'A starts', position: 0.2 }] },
        { id: 'b', events: [{ id: 'start', label: 'B starts', position: 0.8 }] },
      ],
    };

    const layers = materializeLayers(duplicateIds, {});
    expect(
      layers.filter((layer: Layer) => layer.id.startsWith('timeline-marker-start-')),
    ).toHaveLength(2);
    expect(
      layers
        .filter(
          (layer: Layer) =>
            layer.type === 'text' && layer.id.startsWith('timeline-event-label-start-'),
        )
        .map((layer) => (layer.type === 'text' ? layer.content.text : '')),
    ).toEqual(['A starts', 'B starts']);
  });

  it('routes a same-track branch opposite the source callout', () => {
    const sameTrack: TimelineBlockInput = {
      id: 'same-track-branch',
      template: 'timeline',
      duration: 5,
      audioSegment: 0,
      tracks: [
        {
          id: 'main',
          events: [
            { id: 'a', label: 'A', position: 0.2, side: 'above' },
            { id: 'b', label: 'B', position: 0.8, side: 'below' },
          ],
        },
      ],
      links: [{ source: 'a', target: 'b' }],
    };
    const link = materializeLayers(sameTrack, {}).find(
      (layer: Layer) => layer.type === 'path' && layer.id.startsWith('timeline-link-a-b-'),
    );
    expect(link?.type).toBe('path');
    if (link?.type === 'path') {
      const match = /^M\s+\S+\s+([-\d.]+)\s+C\s+\S+\s+([-\d.]+)/.exec(link.content.d);
      expect(match).not.toBeNull();
      if (match) expect(Number(match[2])).toBeGreaterThan(Number(match[1]));
    }
  });

  it('excludes consumed ASCII art and callouts from captions', () => {
    const doc = convert(AUTO_DOC);
    const captionText = (doc.captions?.phrases ?? []).map((phrase) => phrase.text).join(' ');
    expect(captionText).not.toContain('T28');
    expect(captionText).not.toContain('Δ28');
    expect(captionText).not.toContain('interpolate between snapshot');
    expect(captionText).not.toContain('●');
  });
});

describe('timeline recommendation', () => {
  it('profiles the exact sample as timeline content, not tree content', () => {
    const markdown = parseMarkdown(fenced(TICK_INTERPOLATION_TIMELINE));
    const profile = profileBlockContents(
      markdown.children as Parameters<typeof profileBlockContents>[0],
    );
    expect(profile.hasTimeline).toBe(true);
    expect(profile.hasTree).toBe(false);
    const { recommended } = recommendTemplatesForBlock(profile, [
      'timeline',
      'tree',
      'diagram',
      'title',
    ]);
    expect(recommended).toContain('timeline');
    expect(recommended).not.toContain('tree');
  });
});
