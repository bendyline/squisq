import { describe, expect, it } from 'vitest';
import {
  asciiTimelineToTemplateData,
  detectAsciiTimeline,
  parseAsciiTimeline,
  renderAsciiTimeline,
  type AsciiTimeline,
} from '../doc/asciiTimeline/index.js';
import { TICK_INTERPOLATION_TIMELINE } from './fixtures/asciiTimelines.js';

function renderFixpoint(timeline: AsciiTimeline, style?: 'unicode' | 'ascii'): string {
  const first = renderAsciiTimeline(timeline, style ? { style } : {});
  const second = renderAsciiTimeline(parseAsciiTimeline(first));
  const third = renderAsciiTimeline(parseAsciiTimeline(second));
  expect(second).toBe(first);
  expect(third).toBe(first);
  return first;
}

describe('renderAsciiTimeline', () => {
  const timeline: AsciiTimeline = {
    tracks: [
      {
        id: 'kernel',
        label: 'kernel ticks (30 Hz)',
        row: 4,
        startColumn: 20,
        endColumn: 65,
        events: [
          {
            id: 'tick-28',
            label: 'T28',
            description: 'delta-28',
            column: 22,
            side: 'above',
            marker: 'filled',
          },
          {
            id: 'tick-29',
            label: 'T29',
            column: 38,
            side: 'below',
            marker: 'hollow',
          },
        ],
      },
      {
        id: 'branch',
        label: 'client frames',
        row: 9,
        startColumn: 30,
        endColumn: 55,
        events: [
          {
            id: 'render-point',
            label: 'render position',
            description: 'interpolate T28 to T29',
            column: 42,
            marker: 'diamond',
          },
        ],
      },
    ],
    links: [{ source: 'tick-28', target: 'render-point', label: 'feeds renderer' }],
    width: 80,
    height: 12,
    style: 'unicode',
    warnings: [],
  };

  it('emits inline event data followed by branch declarations', () => {
    const output = renderFixpoint(timeline);
    const lines = output.split('\n');

    expect(lines[0]).toContain(
      'kernel ticks (30 Hz) {#kernel start=20 end=65}: ● T28 :: delta-28 {#tick-28 side=above column=22}',
    );
    expect(lines[0]).toContain('○ T29 {#tick-29 side=below column=38}');
    expect(lines[0].endsWith('►')).toBe(true);
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('branch: tick-28 → render-point : feeds renderer');
  });

  it('uses parser-recognizable ASCII markers and rails', () => {
    const output = renderFixpoint(timeline, 'ascii');

    expect(output).toMatch(/^kernel ticks \(30 Hz\) \{#kernel start=20 end=65\}: \*-- T28/m);
    expect(output).toContain('---o T29');
    expect(output).toContain('branch: tick-28 -> render-point : feeds renderer');
    expect(output).not.toMatch(/[─●○◆►→]/u);
  });

  it('sorts tracks/events and drops unresolved links before the first render', () => {
    const shuffled: AsciiTimeline = {
      ...timeline,
      tracks: [...timeline.tracks].reverse().map((track) => ({
        ...track,
        events: [...track.events].reverse(),
      })),
      links: [...timeline.links, { source: 'missing', target: 'tick-28' }],
    };
    const output = renderFixpoint(shuffled);

    expect(output.split('\n')[0]).toContain('kernel ticks');
    expect(output.indexOf('T28')).toBeLessThan(output.indexOf('T29'));
    expect(output).not.toContain('missing');
  });

  it('normalizes colliding ids and prose-heavy Unicode without fixpoint churn', () => {
    const adversarial: AsciiTimeline = {
      tracks: [
        {
          id: 'one',
          row: 0,
          startColumn: 0,
          endColumn: 20,
          events: [
            { id: 'same', label: 'oooooooooooo', column: 0 },
            { id: 'same', label: 'second', column: 10 },
            { id: 'same_2', label: 'third', column: 20 },
          ],
        },
      ],
      links: [],
      width: 21,
      height: 1,
      style: 'unicode',
      warnings: [],
    };
    const output = renderFixpoint(adversarial);

    expect(output).toContain('{#same side=above column=0}');
    expect(output).toContain('{#same_2 side=below column=10}');
    expect(output).toContain('{#same_2_2 side=above column=20}');
    expect(parseAsciiTimeline(output).style).toBe('unicode');
  });

  it('preserves shared geometry when track labels have different lengths', () => {
    const geometry: AsciiTimeline = {
      tracks: [
        {
          id: 'short',
          label: 'A',
          row: 0,
          startColumn: 10,
          endColumn: 110,
          events: [
            { id: 'a20', label: '20', column: 20 },
            { id: 'a90', label: '90', column: 90 },
          ],
        },
        {
          id: 'long',
          label: 'A much longer parallel track label',
          row: 3,
          startColumn: 10,
          endColumn: 110,
          events: [
            { id: 'b20', label: '20', column: 20 },
            { id: 'b90', label: '90', column: 90 },
          ],
        },
      ],
      links: [],
      width: 111,
      height: 4,
      style: 'unicode',
      warnings: [],
    };
    const before = asciiTimelineToTemplateData(geometry).tracks.map((track) =>
      track.events.map((event) => event.position),
    );
    const rendered = renderFixpoint(geometry);
    const parsed = parseAsciiTimeline(rendered);
    const after = asciiTimelineToTemplateData(parsed).tracks.map((track) =>
      track.events.map((event) => event.position),
    );

    expect(parsed.tracks.map((track) => [track.startColumn, track.endColumn])).toEqual([
      [10, 110],
      [10, 110],
    ]);
    expect(after).toEqual(before);
  });

  it('preserves internal arrows and double hyphens in event prose', () => {
    const prose: AsciiTimeline = {
      tracks: [
        {
          id: 'flow',
          label: 'Flow',
          row: 0,
          startColumn: 0,
          endColumn: 20,
          events: [
            {
              id: 'compare',
              label: 'Compare',
              description: 'A > B; release--candidate',
              column: 10,
            },
          ],
        },
      ],
      links: [],
      width: 21,
      height: 1,
      style: 'unicode',
      warnings: [],
    };
    const parsed = parseAsciiTimeline(renderFixpoint(prose));

    expect(parsed.tracks[0].events[0].description).toBe('A > B; release--candidate');
  });

  it('canonicalizes the exact sample without losing its cadence or callout semantics', () => {
    const parsed = parseAsciiTimeline(TICK_INTERPOLATION_TIMELINE);
    const before = asciiTimelineToTemplateData(parsed).tracks.map((track) =>
      track.events.map((event) => event.position),
    );
    const output = renderFixpoint(parsed);
    expect(detectAsciiTimeline(output).isTimeline).toBe(true);
    expect(detectAsciiTimeline(output, { explicit: true }).isTimeline).toBe(true);
    const reparsed = parseAsciiTimeline(output);
    const [kernel, client] = reparsed.tracks;

    expect(reparsed.tracks).toHaveLength(2);
    expect(kernel.endLabel).toBe('sim time');
    expect(kernel.events[0]).toMatchObject({
      label: 'T28',
      description: 'deltas sent: Δ28',
      side: 'above',
      descriptionSide: 'below',
    });
    expect(client.events.filter((event) => event.callout === false)).toHaveLength(16);
    expect(client.events.map((event) => event.label)).toEqual(
      expect.arrayContaining(['estimated kernel clock', 'render position']),
    );
    expect(
      asciiTimelineToTemplateData(reparsed).tracks.map((track) =>
        track.events.map((event) => event.position),
      ),
    ).toEqual(before);
  });

  it('round-trips a hyphenated label ending in an ASCII-marker letter', () => {
    const hyphenated: AsciiTimeline = {
      tracks: [
        {
          id: 'flow',
          row: 0,
          startColumn: 0,
          endColumn: 20,
          events: [
            { id: 'go', label: 'Go-live', column: 0 },
            { id: 'done', label: 'Done', column: 20 },
          ],
        },
      ],
      links: [],
      width: 21,
      height: 1,
      style: 'unicode',
      warnings: [],
    };

    const parsed = parseAsciiTimeline(renderFixpoint(hyphenated));
    expect(parsed.tracks[0].events.map((event) => [event.id, event.label])).toEqual([
      ['go', 'Go-live'],
      ['done', 'Done'],
    ]);
  });

  it('does not treat marker letters beside double hyphens as ASCII events', () => {
    const doubleHyphen: AsciiTimeline = {
      tracks: [
        {
          id: 'ascii-flow',
          row: 0,
          startColumn: 0,
          endColumn: 10,
          events: [{ id: 'foo', label: 'foo--bar', column: 5 }],
        },
      ],
      links: [],
      width: 11,
      height: 1,
      style: 'ascii',
      warnings: [],
    };

    const parsed = parseAsciiTimeline(renderFixpoint(doubleHyphen, 'ascii'));
    expect(parsed.tracks[0].events).toMatchObject([{ id: 'foo', label: 'foo--bar' }]);
  });

  it('round-trips brace-delimited prose in a track end label', () => {
    const braceSuffix: AsciiTimeline = {
      tracks: [
        {
          id: 'release',
          row: 0,
          startColumn: 0,
          endColumn: 10,
          endLabel: 'status {beta}',
          events: [
            { id: 'a', label: 'A', column: 0 },
            { id: 'b', label: 'B', column: 10 },
          ],
        },
      ],
      links: [],
      width: 11,
      height: 1,
      style: 'unicode',
      warnings: [],
    };

    const parsed = parseAsciiTimeline(renderFixpoint(braceSuffix));
    expect(parsed.tracks[0].endLabel).toBe('status {beta}');
    expect(parsed.tracks[0].events.map((event) => [event.id, event.label])).toEqual([
      ['a', 'A'],
      ['b', 'B'],
    ]);
  });

  it.each(['unicode', 'ascii'] as const)(
    'normalizes leading rail prose without %s fixpoint churn',
    (style) => {
      const leadingRails: AsciiTimeline = {
        tracks: [
          {
            id: 'flags',
            endLabel: '─-done',
            row: 0,
            startColumn: 0,
            endColumn: 20,
            events: [
              { id: 'watch', label: '--watch', column: 0 },
              { id: 'negative', label: '-1.5', column: 10 },
              { id: 'phase', label: '─phase', column: 20 },
            ],
          },
        ],
        links: [],
        width: 21,
        height: 1,
        style,
        warnings: [],
      };
      const parsed = parseAsciiTimeline(renderFixpoint(leadingRails, style));

      expect(parsed.tracks[0].events.map((event) => event.label)).toEqual([
        '−−watch',
        '−1.5',
        '–phase',
      ]);
      expect(parsed.tracks[0].endLabel).toBe('–−done');
    },
  );
});
