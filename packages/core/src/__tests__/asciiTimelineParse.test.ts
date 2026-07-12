import { describe, expect, it } from 'vitest';
import { asciiTimelineToTemplateData, parseAsciiTimeline } from '../doc/asciiTimeline/index.js';
import {
  MULTI_TRACK_BRANCH_TIMELINE,
  TICK_INTERPOLATION_TIMELINE,
} from './fixtures/asciiTimelines.js';

describe('parseAsciiTimeline', () => {
  it('extracts tick labels, delta callouts, and fractional pointer events from the exact sample', () => {
    const timeline = parseAsciiTimeline(TICK_INTERPOLATION_TIMELINE);
    expect(timeline.tracks).toHaveLength(2);

    const [kernel, client] = timeline.tracks;
    expect(kernel.label).toBe('kernel ticks (30 Hz)');
    expect(kernel.endLabel).toBe('sim time');
    expect(client.label).toBe('client frames (e.g. 120 Hz)');

    const events = kernel.events;
    const milestones = events.filter((event) => event.marker === 'filled');
    expect(milestones.map((event) => event.label)).toEqual(['T28', 'T29', 'T30', 'T31']);
    expect(milestones.map((event) => event.description)).toEqual([
      'deltas sent: Δ28',
      'Δ29',
      'Δ30',
      'Δ31',
    ]);
    expect(milestones.map((event) => event.side)).toEqual(['above', 'above', 'above', 'above']);
    expect(milestones.map((event) => event.descriptionSide)).toEqual([
      'below',
      'below',
      'below',
      'below',
    ]);

    const cadence = client.events.filter((event) => event.callout === false);
    expect(cadence).toHaveLength(16);
    expect(cadence.every((event) => event.marker === 'hollow')).toBe(true);
    expect(client.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'estimated kernel clock',
          description: 'estTick ≈ 30.4',
          marker: 'hollow',
        }),
        expect.objectContaining({
          label: 'render position',
          description: expect.stringContaining('interpolate between snapshot T28 and T29'),
          marker: 'hollow',
        }),
      ]),
    );
  });

  it('parses multiple tracks and resolves explicit branch declarations by stable event id', () => {
    const timeline = parseAsciiTimeline(MULTI_TRACK_BRANCH_TIMELINE);
    expect(timeline.tracks.map((track) => track.label)).toEqual(['Kernel', 'Client']);
    expect(timeline.tracks.map((track) => track.events.map((event) => event.id))).toEqual([
      ['t28', 't29'],
      ['f28', 'f29'],
    ]);
    expect(timeline.links).toEqual([{ source: 't29', target: 'f29', label: 'interpolation path' }]);
    expect(timeline.warnings).toEqual([]);
  });

  it('normalizes every track against one shared horizontal scale', () => {
    const timeline = parseAsciiTimeline(MULTI_TRACK_BRANCH_TIMELINE);
    const { tracks, links } = asciiTimelineToTemplateData(timeline);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].events.map((event) => event.position)).toEqual(
      tracks[1].events.map((event) => event.position),
    );
    for (const event of tracks.flatMap((track) => track.events)) {
      expect(event.position).toBeGreaterThanOrEqual(0);
      expect(event.position).toBeLessThanOrEqual(1);
    }
    expect(links).toEqual(timeline.links);
  });

  it('is deterministic and never throws on empty or malformed input', () => {
    expect(parseAsciiTimeline('')).toMatchObject({ tracks: [], links: [], warnings: [] });
    expect(() => parseAsciiTimeline('not a timeline\nfunction x() {}')).not.toThrow();
    expect(parseAsciiTimeline(MULTI_TRACK_BRANCH_TIMELINE)).toEqual(
      parseAsciiTimeline(MULTI_TRACK_BRANCH_TIMELINE.replace(/\n/g, '\r\n')),
    );
  });

  it('keeps prose arrows and double hyphens inside inline event descriptions', () => {
    const timeline = parseAsciiTimeline(
      'Flow: ● Compare :: A > B; release--candidate {#compare side=above} ───►',
    );

    expect(timeline.tracks[0].events[0]).toMatchObject({
      id: 'compare',
      label: 'Compare',
      description: 'A > B; release--candidate',
    });
  });

  it('keeps leading CLI flags, negative values, and rail-like prose in authored labels', () => {
    const timeline = parseAsciiTimeline('Flags: ● --watch ─────● -1.5 ─────● ─phase ─────►');

    expect(timeline.tracks[0].events.map((event) => event.label)).toEqual([
      '--watch',
      '-1.5',
      '─phase',
    ]);
  });

  it('keeps direct-source arrow prose, pointer offsets, and end-label punctuation', () => {
    const arrow = parseAsciiTimeline('Flow: ●────● Result :: A -> B');
    expect(arrow.tracks[0].events[1].description).toBe('A -> B');

    const pointer = parseAsciiTimeline(['●────────●────────►', '     ▲ -1.5'].join('\n'));
    expect(pointer.tracks[0].events.map((event) => event.label)).toContain('-1.5');

    const endLabel = parseAsciiTimeline('Track: ● A ─────● B ───► --phase');
    expect(endLabel.tracks[0].endLabel).toBe('--phase');
  });

  it('does not duplicate a suffix-only axis label at the left edge', () => {
    const track = parseAsciiTimeline('────●────●────► sim time').tracks[0];
    expect(track.label).toBeUndefined();
    expect(track.endLabel).toBe('sim time');
  });

  it('promotes a cadence point when an authored elbow adds a callout', () => {
    const timeline = parseAsciiTimeline(['Client: f f f f', '        └─ dropped frame'].join('\n'));
    expect(timeline.tracks[0].events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'dropped frame', callout: true, side: 'below' }),
      ]),
    );
  });

  it('preserves a leading minus in an elbow callout', () => {
    const timeline = parseAsciiTimeline(['●────────●────────►', '└─-1.5'].join('\n'));
    expect(timeline.tracks[0].events[0].description).toBe('-1.5');
  });

  it('keeps trailing prose braces when they are not timeline metadata', () => {
    const timeline = parseAsciiTimeline('Flow: ● Deploy {phase} ───►');
    expect(timeline.tracks[0].events[0].label).toBe('Deploy {phase}');
  });

  it('segments multiple fractional pointers on the same row', () => {
    const timeline = parseAsciiTimeline(
      ['●────────●────────●────────►', '  ▲ A         ▲ B'].join('\n'),
    );
    const pointerLabels = timeline.tracks[0].events
      .filter((event) => event.marker === 'hollow')
      .map((event) => event.label);
    expect(pointerLabels).toEqual(['A', 'B']);
  });

  it('does not turn hyphenated Unicode event labels into phantom ASCII markers', () => {
    const timeline = parseAsciiTimeline('Flow: ● Go-live {#go} ─────● Done {#done} ─────►');

    expect(timeline.style).toBe('unicode');
    expect(timeline.tracks[0].events.map((event) => event.label)).toEqual(['Go-live', 'Done']);
    expect(timeline.tracks[0].events.map((event) => event.id)).toEqual(['go', 'done']);
  });
});
