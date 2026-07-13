/** Mapping from source-grid timeline data to normalized template inputs. */

import type {
  TimelineTemplateEvent,
  TimelineTemplateLink,
  TimelineTemplateTrack,
} from '../../schemas/BlockTemplates.js';
import type { AsciiTimeline } from './types.js';

export function asciiTimelineToTemplateData(timeline: AsciiTimeline): {
  tracks: TimelineTemplateTrack[];
  links: TimelineTemplateLink[];
} {
  const globalStart =
    timeline.tracks.length > 0 ? Math.min(...timeline.tracks.map((track) => track.startColumn)) : 0;
  const globalEnd =
    timeline.tracks.length > 0 ? Math.max(...timeline.tracks.map((track) => track.endColumn)) : 1;
  const span = Math.max(1, globalEnd - globalStart);

  const tracks: TimelineTemplateTrack[] = timeline.tracks.map((track) => ({
    id: track.id,
    ...(track.label ? { label: track.label } : {}),
    ...(track.endLabel ? { endLabel: track.endLabel } : {}),
    events: track.events.map(
      (event): TimelineTemplateEvent => ({
        id: event.id,
        label: event.label,
        ...(event.description ? { description: event.description } : {}),
        position: clamp01((event.column - globalStart) / span),
        ...(event.side ? { side: event.side } : {}),
        ...(event.descriptionSide ? { descriptionSide: event.descriptionSide } : {}),
        ...(event.callout === false ? { callout: false } : {}),
        ...(event.marker ? { marker: event.marker } : {}),
      }),
    ),
  }));
  const links: TimelineTemplateLink[] = timeline.links.map((link) => ({ ...link }));
  return { tracks, links };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
