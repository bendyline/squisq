import { describe, expect, it } from 'vitest';
import {
  detectAsciiTimeline,
  isAsciiTimelineFence,
  isEligibleAsciiTimelineFenceLang,
  isExplicitTimelineLang,
  renderAsciiTimeline,
  type AsciiTimeline,
} from '../doc/asciiTimeline/index.js';
import { detectAsciiDiagram } from '../doc/asciiDiagram/index.js';
import { detectTree } from '../doc/treeview/index.js';
import type { MarkdownCodeBlock } from '../markdown/types.js';
import {
  MULTI_TRACK_BRANCH_TIMELINE,
  SINGLE_POINT_ASCII_TIMELINE,
  TICK_INTERPOLATION_TIMELINE,
  WRAPPED_CLIENT_KERNEL_TIMELINE,
} from './fixtures/asciiTimelines.js';

describe('detectAsciiTimeline', () => {
  it('recognizes the exact tick/interpolation example as an untagged timeline', () => {
    const detection = detectAsciiTimeline(TICK_INTERPOLATION_TIMELINE);
    expect(detection.isTimeline).toBe(true);
    expect(detection.timeline?.tracks).toHaveLength(2);
    expect(detection.reasons).toContain('strong-markers');
  });

  it('recognizes multiple tracks and an explicit branch declaration', () => {
    const detection = detectAsciiTimeline(MULTI_TRACK_BRANCH_TIMELINE);
    expect(detection.isTimeline).toBe(true);
    expect(detection.timeline?.tracks).toHaveLength(2);
    expect(detection.timeline?.links).toEqual([
      { source: 't29', target: 'f29', label: 'interpolation path' },
    ]);
  });

  it('conservatively recognizes a multi-lane flow with a wrapped return edge', () => {
    const detection = detectAsciiTimeline(WRAPPED_CLIENT_KERNEL_TIMELINE);
    expect(detection.isTimeline).toBe(true);
    expect(detection.reasons).toContain('wrapped-flow');
    expect(detection.timeline?.tracks).toHaveLength(2);
    expect(detectAsciiDiagram(WRAPPED_CLIENT_KERNEL_TIMELINE).isDiagram).toBe(false);

    const withoutReturn = WRAPPED_CLIENT_KERNEL_TIMELINE.replace(/┐/gu, '│').replace(/┘/gu, '│');
    expect(detectAsciiTimeline(withoutReturn).isTimeline).toBe(false);
  });

  it('only accepts a sparse ASCII track when author intent is explicit', () => {
    expect(detectAsciiTimeline(SINGLE_POINT_ASCII_TIMELINE).isTimeline).toBe(false);
    const explicit = detectAsciiTimeline(SINGLE_POINT_ASCII_TIMELINE, { explicit: true });
    expect(explicit.isTimeline).toBe(true);
    expect(explicit.timeline?.tracks[0].events).toMatchObject([
      { id: 'alpha', label: 'Alpha', marker: 'filled' },
    ]);
  });

  it('accepts a cadence-only track through an explicit timeline fence', () => {
    const cadence = 'client frames (120 Hz): f f f f f';
    expect(detectAsciiTimeline(cadence).isTimeline).toBe(false);
    expect(detectAsciiTimeline(cadence, { explicit: true }).isTimeline).toBe(true);
    const fence: MarkdownCodeBlock = { type: 'code', lang: 'timeline', value: cadence };
    expect(isAsciiTimelineFence(fence)).toBe(true);
  });

  it('keeps the exact sample mutually exclusive with tree and box-diagram codecs', () => {
    expect(detectTree(TICK_INTERPOLATION_TIMELINE).isTree).toBe(false);
    expect(detectAsciiDiagram(TICK_INTERPOLATION_TIMELINE).isDiagram).toBe(false);
  });

  it('does not steal a tree item whose label happens to contain a marker rail', () => {
    const tree = ['root/', '├── ●────────● benchmark.txt', '└── notes.md'].join('\n');
    expect(detectAsciiTimeline(tree).isTimeline).toBe(false);
    expect(detectTree(tree).isTree).toBe(true);
  });

  it('does not steal marker rails inside deeply nested tree items', () => {
    const tree = [
      'root/',
      '│   └── child/',
      '│       └── grandchild/',
      '│           └── ●────────● benchmark.txt',
    ].join('\n');
    expect(detectAsciiTimeline(tree).isTimeline).toBe(false);
    expect(detectTree(tree).isTree).toBe(true);
  });

  it('leaves a single closed box as authored code instead of treating its top as an axis', () => {
    const box = ['┌──●────●──┐', '│ content  │', '└──────────┘'].join('\n');
    expect(detectAsciiTimeline(box).isTimeline).toBe(false);
  });

  it('allows a lone top elbow to act as an above-axis callout', () => {
    const callout = ['     ┌─ warmup', '────●────●────►'].join('\n');
    expect(detectAsciiTimeline(callout).isTimeline).toBe(true);
  });

  it('uses an inert-language allowlist and a durable explicit tag', () => {
    for (const lang of [undefined, null, '', 'text', 'txt', 'plain', 'ascii', 'timeline']) {
      expect(isEligibleAsciiTimelineFenceLang(lang)).toBe(true);
    }
    for (const lang of ['js', 'typescript', 'python', 'yaml', 'json', 'bash']) {
      expect(isEligibleAsciiTimelineFenceLang(lang)).toBe(false);
    }
    for (const lang of ['timeline', ' Timeline ', 'TIMELINE']) {
      expect(isExplicitTimelineLang(lang)).toBe(true);
    }
    expect(isExplicitTimelineLang('text')).toBe(false);
  });

  it('combines the language gate with explicit detection for code fences', () => {
    const fence = (lang?: string): MarkdownCodeBlock => ({
      type: 'code',
      ...(lang !== undefined ? { lang } : {}),
      value: SINGLE_POINT_ASCII_TIMELINE,
    });
    expect(isAsciiTimelineFence(fence())).toBe(false);
    expect(isAsciiTimelineFence(fence('timeline'))).toBe(true);
    expect(isAsciiTimelineFence(fence('js'))).toBe(false);
  });

  it('rejects over-wide art before running the grid parsers', () => {
    const tooWide = `●${'─'.repeat(401)}●`;
    expect(detectAsciiTimeline(tooWide)).toMatchObject({
      isTimeline: false,
      reasons: [expect.stringMatching(/^too-wide\(/)],
    });
  });

  it('allows long canonical callout form while retaining the ordinary line cap', () => {
    const timeline: AsciiTimeline = {
      tracks: Array.from({ length: 150 }, (_, index) => ({
        id: `track-${index}`,
        label: `Track ${index}`,
        row: index,
        startColumn: 0,
        endColumn: 10,
        events: [
          { id: `start-${index}`, label: 'Start', column: 0, side: 'above' as const },
          { id: `end-${index}`, label: 'End', column: 10, side: 'below' as const },
        ],
      })),
      links: [],
      width: 11,
      height: 150,
      style: 'unicode',
      warnings: [],
    };
    const canonical = renderAsciiTimeline(timeline);
    expect(canonical.split('\n').length).toBeGreaterThan(400);
    expect(detectAsciiTimeline(canonical, { explicit: true }).isTimeline).toBe(true);

    const arbitrary = Array.from({ length: 401 }, () => '●────────●').join('\n');
    expect(detectAsciiTimeline(arbitrary, { explicit: true }).reasons[0]).toMatch(
      /^too-many-lines\(/,
    );
  });
});
