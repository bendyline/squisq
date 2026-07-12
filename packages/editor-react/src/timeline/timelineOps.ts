/**
 * Pure edits over the authored ASCII timeline model.
 *
 * The code fence remains the source of truth. Canvas coordinates are
 * normalized to the same global, shared scale used by
 * `asciiTimelineToTemplateData`; commands render the edited model back into
 * canonical fence text after applying one of these operations.
 */

import type {
  AsciiTimeline,
  AsciiTimelineEvent,
  AsciiTimelineMarker,
  AsciiTimelineSide,
} from '@bendyline/squisq/doc';

const STRUCTURAL_MARKERS = /[●○◉◆◇•]+/gu;
const LEADING_RAILS = /^[─━═╌╍┄┅┈┉-]+/u;
const COORDINATE_PRECISION = 1_000;
const COLUMN_EPSILON = 1 / COORDINATE_PRECISION / 2;

export interface TimelineEventPatch {
  label?: string;
  /** `null` clears the optional description. */
  description?: string | null;
  side?: AsciiTimelineSide;
  /** `null` restores the label side/default placement. */
  descriptionSide?: AsciiTimelineSide | null;
  callout?: boolean;
  marker?: AsciiTimelineMarker;
  /** Normalized position on the global timeline scale. */
  position?: number;
}

export interface AddTimelineEventOptions {
  id?: string;
  label?: string;
  description?: string;
  side?: AsciiTimelineSide;
  descriptionSide?: AsciiTimelineSide;
  callout?: boolean;
  marker?: AsciiTimelineMarker;
}

export interface AddTimelineEventResult {
  timeline: AsciiTimeline;
  eventId: string;
}

/**
 * Normalize editable one-line prose exactly as the canonical core renderer
 * does. This prevents the verified command path from accepting a value that
 * is silently reinterpreted as timeline syntax on its first render.
 */
export function sanitizeTimelineText(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(STRUCTURAL_MARKERS, '·')
    .replace(/\*/g, '∗')
    .replace(/::/g, '∶')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.replace(LEADING_RAILS, (run) =>
    Array.from(run, (character) => (character === '-' ? '−' : '–')).join(''),
  );
}

/** Return a globally unique, renderer-safe event id. */
export function nextTimelineEventId(timeline: AsciiTimeline, base = 'event'): string {
  const used = new Set(timeline.tracks.flatMap((track) => track.events.map((event) => event.id)));
  const safeBase = safeId(base) || 'event';
  if (!used.has(safeBase)) return safeBase;
  let suffix = 2;
  while (used.has(`${safeBase}-${suffix}`)) suffix++;
  return `${safeBase}-${suffix}`;
}

/**
 * Add a visible point to `trackId` at a normalized global rail position.
 * Returns the stable id so the canvas can select/focus the new point after
 * the fence rewrite.
 */
export function addTimelineEventOp(
  timeline: AsciiTimeline,
  trackId: string,
  position: number,
  options: AddTimelineEventOptions = {},
): AddTimelineEventResult | null {
  if (!Number.isFinite(position)) return null;
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return null;

  const column = columnAtPosition(timeline, position);
  // Two coincident markers cannot be independently hit on the canvas. A
  // marker click should select the existing point rather than adding atop it.
  if (track.events.some((event) => Math.abs(event.column - column) <= COLUMN_EPSILON)) return null;

  const label = sanitizeTimelineText(options.label ?? '') || 'New event';
  const description = sanitizeTimelineText(options.description ?? '');
  const eventId = nextTimelineEventId(timeline, options.id ?? label);
  const insertionIndex = track.events.filter((event) => event.column < column).length;
  const side = options.side ?? (insertionIndex % 2 === 0 ? 'above' : 'below');
  const event: AsciiTimelineEvent = {
    id: eventId,
    label,
    ...(description ? { description } : {}),
    column,
    side,
    ...(description && options.descriptionSide ? { descriptionSide: options.descriptionSide } : {}),
    ...(options.callout === false ? { callout: false } : {}),
    marker: options.marker ?? 'filled',
  };

  const events = [...track.events, event].sort(
    (left, right) => left.column - right.column || left.id.localeCompare(right.id),
  );
  const tracks = timeline.tracks.map((candidate) =>
    candidate.id === trackId ? { ...candidate, events } : candidate,
  );
  // ASCII art has no distinct diamond glyph. Promote the authored vocabulary
  // when the inspector explicitly requests one rather than silently folding
  // the user's choice back to a filled point in the renderer.
  const style = options.marker === 'diamond' ? 'unicode' : timeline.style;
  return { timeline: { ...timeline, tracks, style }, eventId };
}

/** Update one point without changing its stable id or branch endpoints. */
export function updateTimelineEventOp(
  timeline: AsciiTimeline,
  eventId: string,
  patch: TimelineEventPatch,
): AsciiTimeline {
  const location = findEvent(timeline, eventId);
  if (!location || Object.keys(patch).length === 0) return timeline;

  const hasLabel = Object.prototype.hasOwnProperty.call(patch, 'label');
  const hasDescription = Object.prototype.hasOwnProperty.call(patch, 'description');
  const hasDescriptionSide = Object.prototype.hasOwnProperty.call(patch, 'descriptionSide');
  const hasPosition = Object.prototype.hasOwnProperty.call(patch, 'position');
  const label = hasLabel ? sanitizeTimelineText(patch.label ?? '') : location.event.label;
  if (!label) return timeline;

  let description = hasDescription
    ? sanitizeTimelineText(patch.description ?? '')
    : location.event.description;
  if (!description) description = undefined;

  let column = location.event.column;
  if (hasPosition) {
    if (!Number.isFinite(patch.position)) return timeline;
    column = columnAtPosition(timeline, patch.position as number);
    const collision = location.track.events.some(
      (event) => event.id !== eventId && Math.abs(event.column - column) <= COLUMN_EPSILON,
    );
    if (collision) return timeline;
  }

  const editedText = hasLabel || hasDescription;
  const callout =
    patch.callout !== undefined
      ? patch.callout
      : editedText && location.event.callout === false
        ? true
        : location.event.callout;
  const descriptionSide = !description
    ? undefined
    : hasDescriptionSide
      ? (patch.descriptionSide ?? undefined)
      : location.event.descriptionSide;

  const nextEvent: AsciiTimelineEvent = {
    ...location.event,
    label,
    column,
    ...(description ? { description } : {}),
    ...(patch.side ? { side: patch.side } : {}),
    ...(descriptionSide ? { descriptionSide } : {}),
    ...(callout !== undefined ? { callout } : {}),
    ...(patch.marker ? { marker: patch.marker } : {}),
  };
  if (!description) delete nextEvent.description;
  if (!descriptionSide) delete nextEvent.descriptionSide;

  if (eventsEqual(location.event, nextEvent)) return timeline;
  const events = location.track.events
    .map((event) => (event.id === eventId ? nextEvent : event))
    .sort((left, right) => left.column - right.column || left.id.localeCompare(right.id));
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id ? { ...track, events } : track,
  );
  const style = patch.marker === 'diamond' ? 'unicode' : timeline.style;
  return { ...timeline, tracks, style };
}

/**
 * Remove a point and every incident branch. Empty tracks are removed because
 * the canonical renderer cannot represent them. The last point in the whole
 * timeline is retained so an edit cannot erase its own source fence/widget.
 */
export function removeTimelineEventOp(timeline: AsciiTimeline, eventId: string): AsciiTimeline {
  const location = findEvent(timeline, eventId);
  if (!location) return timeline;
  const eventCount = timeline.tracks.reduce((sum, track) => sum + track.events.length, 0);
  if (eventCount <= 1) return timeline;

  const tracks = timeline.tracks
    .map((track) =>
      track.id === location.track.id
        ? { ...track, events: track.events.filter((event) => event.id !== eventId) }
        : track,
    )
    .filter((track) => track.events.length > 0);
  const links = timeline.links.filter((link) => link.source !== eventId && link.target !== eventId);
  return { ...timeline, tracks, links };
}

function globalBounds(timeline: AsciiTimeline): { start: number; span: number } {
  if (timeline.tracks.length === 0) return { start: 0, span: 1 };
  const start = Math.min(...timeline.tracks.map((track) => track.startColumn));
  const end = Math.max(...timeline.tracks.map((track) => track.endColumn));
  return { start, span: Math.max(1, end - start) };
}

function columnAtPosition(timeline: AsciiTimeline, position: number): number {
  const { start, span } = globalBounds(timeline);
  const clamped = Math.max(0, Math.min(1, position));
  return Math.round((start + clamped * span) * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}

function safeId(value: string): string {
  return (
    sanitizeTimelineText(value)
      .toLowerCase()
      .replace(/[^a-z0-9_.~-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event'
  );
}

function findEvent(
  timeline: AsciiTimeline,
  eventId: string,
): { track: AsciiTimeline['tracks'][number]; event: AsciiTimelineEvent } | null {
  for (const track of timeline.tracks) {
    const event = track.events.find((candidate) => candidate.id === eventId);
    if (event) return { track, event };
  }
  return null;
}

function eventsEqual(left: AsciiTimelineEvent, right: AsciiTimelineEvent): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.description === right.description &&
    left.column === right.column &&
    left.side === right.side &&
    left.descriptionSide === right.descriptionSide &&
    left.callout === right.callout &&
    left.marker === right.marker
  );
}
