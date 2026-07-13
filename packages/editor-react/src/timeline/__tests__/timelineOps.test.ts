import { describe, expect, it } from 'vitest';
import { parseAsciiTimeline, renderAsciiTimeline, type AsciiTimeline } from '@bendyline/squisq/doc';
import {
  addTimelineTrackOp,
  addTimelineEventOp,
  nextTimelineEventId,
  nextTimelineTrackId,
  removeTimelineTrackOp,
  removeTimelineEventOp,
  sanitizeTimelineText,
  updateTimelineTrackOp,
  updateTimelineEventOp,
} from '../timelineOps';

function makeTimeline(): AsciiTimeline {
  return {
    tracks: [
      {
        id: 'kernel',
        label: 'Kernel',
        row: 0,
        startColumn: 10,
        endColumn: 70,
        events: [
          { id: 'start', label: 'Start', column: 10, side: 'above', marker: 'filled' },
          { id: 'review', label: 'Review', column: 55, side: 'below', marker: 'hollow' },
        ],
      },
      {
        id: 'client',
        label: 'Client',
        row: 2,
        startColumn: 20,
        endColumn: 100,
        events: [
          {
            id: 'frame',
            label: 'f',
            column: 20,
            side: 'above',
            callout: false,
            marker: 'hollow',
          },
          { id: 'paint', label: 'Paint', column: 100, side: 'below', marker: 'filled' },
        ],
      },
    ],
    links: [
      { source: 'start', target: 'frame', label: 'begins' },
      { source: 'review', target: 'paint' },
    ],
    width: 101,
    height: 3,
    style: 'unicode',
    warnings: [],
  };
}

function event(timeline: AsciiTimeline, id: string) {
  return timeline.tracks.flatMap((track) => track.events).find((candidate) => candidate.id === id);
}

function expectFixpoint(timeline: AsciiTimeline): void {
  const rendered = renderAsciiTimeline(timeline);
  expect(renderAsciiTimeline(parseAsciiTimeline(rendered))).toBe(rendered);
}

describe('timeline editor pure operations', () => {
  it('sanitizes one-line text with the renderer vocabulary', () => {
    expect(sanitizeTimelineText('  --watch\n● phase :: ready *  ')).toBe(
      '−−watch · phase ∶ ready ∗',
    );
  });

  it('generates globally unique, stable event ids', () => {
    const timeline = makeTimeline();
    expect(nextTimelineEventId(timeline, 'Start')).toBe('start-2');
    expect(nextTimelineEventId(timeline, 'A new point')).toBe('a-new-point');
    expect(nextTimelineTrackId(timeline, 'Kernel')).toBe('kernel-2');
  });

  it('adds a representable line with a starter point without mutating its input', () => {
    const timeline = makeTimeline();
    const before = JSON.stringify(timeline);
    const result = addTimelineTrackOp(timeline, { label: 'Release', eventLabel: 'Ready' });

    expect(JSON.stringify(timeline)).toBe(before);
    expect(result).toMatchObject({ trackId: 'release', eventId: 'ready' });
    expect(result.timeline.tracks[2]).toMatchObject({
      id: 'release',
      label: 'Release',
      row: 3,
      startColumn: 10,
      endColumn: 100,
      events: [
        {
          id: 'ready',
          label: 'Ready',
          column: 55,
          side: 'above',
          marker: 'filled',
        },
      ],
    });
    expectFixpoint(result.timeline);
  });

  it('renames and removes a line while preserving or pruning branches as appropriate', () => {
    const timeline = makeTimeline();
    const renamed = updateTimelineTrackOp(timeline, 'client', '  Browser\nwork  ');
    expect(renamed.tracks[1]).toMatchObject({ id: 'client', label: 'Browser work' });
    expect(renamed.tracks[1].events).toEqual(timeline.tracks[1].events);
    expect(renamed.links).toEqual(timeline.links);

    const removed = removeTimelineTrackOp(renamed, 'client');
    expect(removed.tracks.map((track) => track.id)).toEqual(['kernel']);
    expect(removed.links).toEqual([]);
    expectFixpoint(renamed);
    expectFixpoint(removed);
  });

  it('rejects invalid line edits and retains the final line', () => {
    const timeline = makeTimeline();
    expect(updateTimelineTrackOp(timeline, 'missing', 'Nope')).toBe(timeline);
    expect(updateTimelineTrackOp(timeline, 'kernel', '  ')).toBe(timeline);
    expect(removeTimelineTrackOp(timeline, 'missing')).toBe(timeline);

    const oneLine = { ...timeline, tracks: [timeline.tracks[0]], links: [] };
    expect(removeTimelineTrackOp(oneLine, 'kernel')).toBe(oneLine);
  });

  it('adds at the globally normalized position without mutating its input', () => {
    const timeline = makeTimeline();
    const before = JSON.stringify(timeline);
    // Shared bounds are 10..100, so 25% is source column 32.5.
    const result = addTimelineEventOp(timeline, 'kernel', 0.25, {
      label: 'Compile',
      description: 'Build the frame',
    });

    expect(result).not.toBeNull();
    expect(JSON.stringify(timeline)).toBe(before);
    expect(result?.eventId).toBe('compile');
    expect(event(result!.timeline, 'compile')).toMatchObject({
      label: 'Compile',
      description: 'Build the frame',
      column: 32.5,
      side: 'below',
      marker: 'filled',
    });
    expect(result?.timeline.tracks[0].events.map((point) => point.id)).toEqual([
      'start',
      'compile',
      'review',
    ]);
    expectFixpoint(result!.timeline);
  });

  it('clamps positions, rejects nonfinite positions, unknown tracks, and collisions', () => {
    const timeline = makeTimeline();
    expect(addTimelineEventOp(timeline, 'missing', 0.2)).toBeNull();
    expect(addTimelineEventOp(timeline, 'kernel', Number.NaN)).toBeNull();
    expect(addTimelineEventOp(timeline, 'kernel', 0)).toBeNull(); // `start` already at column 10

    const result = addTimelineEventOp(timeline, 'client', 2, { label: 'After' });
    expect(result).toBeNull(); // clamped column 100 is occupied by `paint`
  });

  it('updates text and styling while preserving ids and branch endpoints', () => {
    const timeline = makeTimeline();
    const next = updateTimelineEventOp(timeline, 'start', {
      label: 'Boot',
      description: 'Initialize\nworld',
      side: 'below',
      descriptionSide: 'above',
      marker: 'diamond',
      position: 0.4,
    });

    expect(next).not.toBe(timeline);
    expect(event(timeline, 'start')?.label).toBe('Start');
    expect(event(next, 'start')).toMatchObject({
      id: 'start',
      label: 'Boot',
      description: 'Initialize world',
      column: 46,
      side: 'below',
      descriptionSide: 'above',
      marker: 'diamond',
    });
    expect(next.links[0]).toMatchObject({ source: 'start', target: 'frame' });
    expect(next.tracks[0].startColumn).toBe(46);
    expectFixpoint(next);
  });

  it('resets track bounds after dropping a point that anchored an edge', () => {
    const timeline = makeTimeline();

    const movedStart = updateTimelineEventOp(timeline, 'start', { position: 0.3 });
    expect(event(movedStart, 'start')?.column).toBe(37);
    expect(movedStart.tracks[0]).toMatchObject({ startColumn: 37, endColumn: 70 });

    const crossedStart = updateTimelineEventOp(timeline, 'start', { position: 0.8 });
    expect(crossedStart.tracks[0].events.map((point) => point.id)).toEqual(['review', 'start']);
    expect(crossedStart.tracks[0]).toMatchObject({ startColumn: 55, endColumn: 82 });

    const movedEnd = updateTimelineEventOp(timeline, 'paint', { position: 0.7 });
    expect(event(movedEnd, 'paint')?.column).toBe(73);
    expect(movedEnd.tracks[1]).toMatchObject({ startColumn: 20, endColumn: 73 });
    expectFixpoint(movedStart);
    expectFixpoint(crossedStart);
    expectFixpoint(movedEnd);
  });

  it('promotes an edited cadence point to a visible callout and can clear its description', () => {
    const timeline = makeTimeline();
    const visible = updateTimelineEventOp(timeline, 'frame', {
      label: 'Dropped frame',
      description: 'Late snapshot',
    });
    expect(event(visible, 'frame')).toMatchObject({
      label: 'Dropped frame',
      description: 'Late snapshot',
      callout: true,
    });

    const cleared = updateTimelineEventOp(visible, 'frame', {
      description: null,
      descriptionSide: null,
    });
    expect(event(cleared, 'frame')?.description).toBeUndefined();
    expect(event(cleared, 'frame')?.descriptionSide).toBeUndefined();
  });

  it('promotes ASCII art to Unicode when a diamond marker is requested', () => {
    const timeline = { ...makeTimeline(), style: 'ascii' as const };
    const next = updateTimelineEventOp(timeline, 'start', { marker: 'diamond' });
    expect(next.style).toBe('unicode');
    expect(parseAsciiTimeline(renderAsciiTimeline(next)).tracks[0].events[0].marker).toBe(
      'diamond',
    );
  });

  it('returns the original for invalid or no-op updates', () => {
    const timeline = makeTimeline();
    expect(updateTimelineEventOp(timeline, 'missing', { label: 'Nope' })).toBe(timeline);
    expect(updateTimelineEventOp(timeline, 'start', { label: '  ' })).toBe(timeline);
    expect(updateTimelineEventOp(timeline, 'start', { position: Number.POSITIVE_INFINITY })).toBe(
      timeline,
    );
    expect(updateTimelineEventOp(timeline, 'start', { position: 0.5 })).toBe(timeline); // review
    expect(updateTimelineEventOp(timeline, 'start', { label: 'Start' })).toBe(timeline);
  });

  it('deletes incident links and removes a track after its final event', () => {
    const timeline = makeTimeline();
    const withoutFrame = removeTimelineEventOp(timeline, 'frame');
    expect(event(withoutFrame, 'frame')).toBeUndefined();
    expect(withoutFrame.links).toEqual([{ source: 'review', target: 'paint' }]);
    expect(withoutFrame.tracks).toHaveLength(2);

    const withoutClient = removeTimelineEventOp(withoutFrame, 'paint');
    expect(withoutClient.tracks.map((track) => track.id)).toEqual(['kernel']);
    expect(withoutClient.links).toEqual([]);
    expectFixpoint(withoutClient);
  });

  it('keeps the final event so an edit cannot erase its own fence', () => {
    const timeline = makeTimeline();
    const one: AsciiTimeline = {
      ...timeline,
      tracks: [{ ...timeline.tracks[0], events: [timeline.tracks[0].events[0]] }],
      links: [],
    };
    expect(removeTimelineEventOp(one, 'start')).toBe(one);
  });
});
