/**
 * ASCII timeline renderer: semantic tracks/events -> canonical timeline art.
 *
 * The authored form intentionally keeps every event on its track line:
 *
 *   Kernel {#kernel start=8 end=72}: ● T28 :: delta 28 {#t28 side=above column=12} ───○ T29 {#t29 side=below column=36} ───►
 *
 * Links follow the tracks as declarations. This form is compact, readable in
 * raw Markdown, and is the exact grammar consumed by `parse.ts`. Rendering is
 * deterministic and normalizes parser-sensitive text/ids up front, so it is a
 * byte fixpoint after one render:
 *
 *   renderAsciiTimeline(parseAsciiTimeline(renderAsciiTimeline(t))) ===
 *   renderAsciiTimeline(t)
 */

import type {
  AsciiTimeline,
  AsciiTimelineMarker,
  AsciiTimelineSide,
  AsciiTimelineStyle,
} from './types.js';

export interface RenderAsciiTimelineOptions {
  /** Character vocabulary; defaults to the timeline's detected style. */
  style?: AsciiTimelineStyle;
}

interface TimelineVocab {
  rail: string;
  arrow: string;
  marker: Record<AsciiTimelineMarker, string>;
}

interface PreparedEvent {
  id: string;
  label: string;
  description?: string;
  descriptionSide?: AsciiTimelineSide;
  column: number;
  side: AsciiTimelineSide;
  callout?: boolean;
  marker: AsciiTimelineMarker;
}

interface PreparedTrack {
  id: string;
  label?: string;
  endLabel?: string;
  startColumn: number;
  endColumn: number;
  events: PreparedEvent[];
}

interface PreparedLink {
  source: string;
  target: string;
  label?: string;
}

const UNICODE_VOCAB: TimelineVocab = {
  rail: '\u2500',
  arrow: '\u25ba',
  marker: {
    filled: '\u25cf',
    hollow: '\u25cb',
    diamond: '\u25c6',
  },
};

const ASCII_VOCAB: TimelineVocab = {
  rail: '-',
  arrow: '>',
  marker: {
    filled: '*',
    hollow: 'o',
    // The parser's ASCII vocabulary has no distinct diamond point. Folding
    // it to `*` is the canonical ASCII representation and is byte-stable.
    diamond: '*',
  },
};

const MIN_RAIL_LENGTH = 3;
const ASCII_FIRST_MARKER_RAIL = 2;

/** Render a timeline into deterministic, parser-canonical ASCII/Unicode art. */
export function renderAsciiTimeline(
  timeline: AsciiTimeline,
  options: RenderAsciiTimelineOptions = {},
): string {
  const style = options.style ?? timeline.style;
  const vocab = style === 'ascii' ? ASCII_VOCAB : UNICODE_VOCAB;
  const { tracks, links } = prepareTimeline(timeline, style);
  if (tracks.length === 0) return '';

  const railLength = MIN_RAIL_LENGTH;
  const lines = tracks.map((track) => renderTrack(track, style, vocab, railLength));

  if (links.length > 0) {
    lines.push('');
    for (const link of links) lines.push(renderLink(link, style));
  }

  return lines.join('\n');
}

function renderTrack(
  track: PreparedTrack,
  style: AsciiTimelineStyle,
  vocab: TimelineVocab,
  railLength: number,
): string {
  const metadata = `{#${track.id} start=${formatCoordinate(track.startColumn)} end=${formatCoordinate(track.endColumn)}}`;
  const prefix = track.label ? `${track.label} ${metadata}: ` : `${metadata}: `;
  const rail = vocab.rail.repeat(railLength);
  const parts: string[] = [];

  track.events.forEach((event, index) => {
    const marker = vocab.marker[event.marker];
    // ASCII point glyphs (`*`, `o`) are ordinary prose characters. The
    // parser only accepts one when it physically touches a rail, so give the
    // first point a tiny leading segment. Later points already touch the
    // preceding event's separator rail.
    const firstAsciiRail =
      style === 'ascii' && index === 0 ? vocab.rail.repeat(ASCII_FIRST_MARKER_RAIL) : '';
    parts.push(`${marker}${firstAsciiRail} ${renderEventPayload(event)} ${rail}`);
  });

  return `${prefix}${parts.join('')}${vocab.arrow}${track.endLabel ? ` ${track.endLabel}` : ''}`;
}

function renderEventPayload(event: PreparedEvent): string {
  const body = event.description ? `${event.label} :: ${event.description}` : event.label;
  const descriptionSide = event.descriptionSide ? ` descriptionSide=${event.descriptionSide}` : '';
  const callout = event.callout === false ? ' callout=false' : '';
  return `${body} {#${event.id} side=${event.side} column=${formatCoordinate(event.column)}${descriptionSide}${callout}}`;
}

function renderLink(link: PreparedLink, style: AsciiTimelineStyle): string {
  const arrow = style === 'ascii' ? '->' : '\u2192';
  return `branch: ${link.source} ${arrow} ${link.target}${link.label ? ` : ${link.label}` : ''}`;
}

function prepareTimeline(
  timeline: AsciiTimeline,
  style: AsciiTimelineStyle,
): { tracks: PreparedTrack[]; links: PreparedLink[] } {
  const sourceTracks = timeline.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => Array.isArray(track.events) && track.events.length > 0)
    .sort(
      (a, b) =>
        finiteOr(a.track.row, a.index) - finiteOr(b.track.row, b.index) ||
        a.index - b.index ||
        a.track.id.localeCompare(b.track.id),
    );

  const usedTrackIds = new Set<string>();
  const usedEventIds = new Set<string>();
  const endpointIds = new Map<string, string>();
  const labelIds = new Map<string, string>();
  const tracks: PreparedTrack[] = [];
  let fallbackIndex = 0;

  for (const { track } of sourceTracks) {
    const trackLabel = canonicalInlineText(track.label);
    const endLabel = canonicalInlineText(track.endLabel);
    const trackId = uniqueId(
      canonicalId(track.id, canonicalId(trackLabel, `track_${tracks.length + 1}`)),
      usedTrackIds,
    );
    const sortedEvents = track.events
      .map((event, index) => ({ event, index }))
      .sort(
        (a, b) =>
          finiteOr(a.event.column, a.index) - finiteOr(b.event.column, b.index) ||
          a.index - b.index ||
          a.event.id.localeCompare(b.event.id),
      );
    const events: PreparedEvent[] = [];

    for (let index = 0; index < sortedEvents.length; index++) {
      const event = sortedEvents[index].event;
      const fallbackLabel = `Event ${index + 1}`;
      const label = canonicalInlineText(event.label) || fallbackLabel;
      const idBase = canonicalId(event.id, canonicalId(label, `event_${++fallbackIndex}`));
      const id = uniqueId(idBase, usedEventIds);
      const description = canonicalInlineText(event.description);
      const descriptionSide =
        description && (event.descriptionSide === 'above' || event.descriptionSide === 'below')
          ? event.descriptionSide
          : undefined;
      const column = canonicalCoordinate(event.column, index);
      const side: AsciiTimelineSide =
        event.side === 'below'
          ? 'below'
          : event.side === 'above'
            ? 'above'
            : index % 2 === 0
              ? 'above'
              : 'below';
      const marker = canonicalMarker(event.marker, style);

      events.push({
        id,
        label,
        ...(description ? { description } : {}),
        ...(descriptionSide ? { descriptionSide } : {}),
        column,
        side,
        ...(event.callout === false ? { callout: false } : {}),
        marker,
      });

      // Source ids are normally unique. Preserve the first target when a
      // malformed runtime value duplicates one; the rendered ids themselves
      // are always unique and are also valid branch endpoints.
      if (event.id && !endpointIds.has(event.id)) endpointIds.set(event.id, id);
      endpointIds.set(id, id);
      labelIds.set(slug(label), id);
    }

    const eventColumns = events.map((event) => event.column);
    const fallbackStart = eventColumns.length > 0 ? Math.min(...eventColumns) : 0;
    const fallbackEnd = eventColumns.length > 0 ? Math.max(...eventColumns) : fallbackStart + 1;
    tracks.push({
      id: trackId,
      ...(trackLabel ? { label: trackLabel } : {}),
      ...(endLabel ? { endLabel } : {}),
      startColumn: canonicalCoordinate(track.startColumn, fallbackStart),
      endColumn: canonicalCoordinate(track.endColumn, fallbackEnd),
      events,
    });
  }

  const resolveEndpoint = (value: string): string | undefined =>
    endpointIds.get(value) ?? labelIds.get(slug(value));
  const links: PreparedLink[] = [];
  for (const link of Array.isArray(timeline.links) ? timeline.links : []) {
    const source = resolveEndpoint(link.source);
    const target = resolveEndpoint(link.target);
    // Unresolved declarations would be dropped by the parser anyway. Drop
    // them before the first render so the emitted form is already a fixpoint.
    if (!source || !target) continue;
    const label = canonicalBranchText(link.label);
    links.push({ source, target, ...(label ? { label } : {}) });
  }
  links.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      (a.label ?? '').localeCompare(b.label ?? ''),
  );

  return { tracks, links };
}

function canonicalMarker(
  marker: AsciiTimelineMarker | undefined,
  style: AsciiTimelineStyle,
): AsciiTimelineMarker {
  if (marker === 'hollow') return 'hollow';
  if (marker === 'diamond' && style !== 'ascii') return 'diamond';
  return 'filled';
}

/**
 * Normalize point glyphs that would accidentally create another event. Rails,
 * prose arrows, and hyphens are preserved: `parse.ts` only strips separator
 * rails at the payload edges, so `A > B` and `release--candidate` round-trip.
 */
function canonicalInlineText(value: string | undefined): string {
  if (!value) return '';
  const normalized = value
    .normalize('NFC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u25cf\u25cb\u25c9\u25c6\u25c7\u2022]+/gu, '\u00b7')
    .replace(/\*/g, '\u2217')
    .replace(/::/g, '\u2236')
    .replace(/\s+/g, ' ')
    .trim();
  // A leading authored rail is otherwise indistinguishable from the
  // renderer's separator prefix to `stripEdgeRails`. Keep the punctuation
  // visible with non-structural lookalikes so `--watch`, `-1.5`, and
  // `─phase` survive the very first render/parse normalization cycle.
  return normalized.replace(/^[\u2500\u2501\u2550\u254c\u254d\u2504\u2505\u2508\u2509-]+/u, (run) =>
    Array.from(run, (character) => (character === '-' ? '\u2212' : '\u2013')).join(''),
  );
}

function canonicalBranchText(value: string | undefined): string {
  return canonicalInlineText(value).replace(/\s+/g, ' ').trim();
}

function canonicalId(value: string | undefined, fallback: string): string {
  const normalized = (value ?? '')
    .normalize('NFC')
    .replace(/[\r\n\t\s]+/g, '_')
    .replace(/[^A-Za-z0-9_.~-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (used.has(candidate)) candidate = `${base}_${++suffix}`;
  used.add(candidate);
  return candidate;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event'
  );
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function canonicalCoordinate(value: number, fallback: number): number {
  const finite = finiteOr(value, fallback);
  return Math.max(0, Object.is(finite, -0) ? 0 : finite);
}

function formatCoordinate(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}
