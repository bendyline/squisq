/** ASCII timeline parser: horizontal tracks + point/callout art -> model. */

import type {
  AsciiTimeline,
  AsciiTimelineEvent,
  AsciiTimelineLink,
  AsciiTimelineMarker,
  AsciiTimelineSide,
  AsciiTimelineStyle,
  AsciiTimelineTrack,
} from './types.js';

const STRONG_MARKERS = new Set(['●', '○', '◉', '◆', '◇', '•']);
const ASCII_MARKERS = new Set(['*', 'o', 'O']);
const HORIZONTAL = new Set(['─', '━', '═', '╌', '╍', '┄', '┅', '┈', '┉', '-']);
const END_ARROWS = new Set(['►', '▶', '▷', '→', '>']);
const POINTERS = new Set(['▲', '△', '▼', '▽']);
const CONNECTOR_ANCHORS = new Set(['└', '┌', '├', '┬', '┘', '┐', '╰', '╭', '╯', '╮']);

export interface AsciiTimelineStats {
  axisLines: number;
  markerCount: number;
  strongMarkerCount: number;
  horizontalChars: number;
  pointerCount: number;
  branchDeclarations: number;
}

interface AxisAnalysis {
  row: number;
  id?: string;
  startColumn: number;
  endColumn: number;
  markerColumns: number[];
  markerGlyphs: string[];
  inline: Array<{
    label?: string;
    description?: string;
    id?: string;
    column?: number;
    side?: AsciiTimelineSide;
    descriptionSide?: AsciiTimelineSide;
    callout?: boolean;
  }>;
  label?: string;
  endLabel?: string;
  horizontalChars: number;
  strongMarkerCount: number;
}

interface PendingBranch {
  source: string;
  target: string;
  label?: string;
}

interface Segment {
  start: number;
  end: number;
  text: string;
}

export function parseAsciiTimeline(text: string): AsciiTimeline {
  return parseAsciiTimelineWithStats(text).timeline;
}

export function parseAsciiTimelineWithStats(text: string): {
  timeline: AsciiTimeline;
  stats: AsciiTimelineStats;
} {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const width = Math.max(0, ...lines.map((line) => Array.from(line).length));
  const style = detectStyle(lines);
  const pendingBranches: PendingBranch[] = [];
  const axes: AxisAnalysis[] = [];

  for (let row = 0; row < lines.length; row++) {
    const branch = parseBranchDeclaration(lines[row]);
    if (branch) {
      pendingBranches.push(branch);
      continue;
    }
    const axis = analyzeAxisLine(lines[row], row, style);
    if (axis) {
      axes.push(axis);
      continue;
    }
    const cadence = analyzeCadenceLine(lines[row], row);
    if (cadence) axes.push(cadence);
  }

  const tracks: AsciiTimelineTrack[] = axes.map((axis, index) => ({
    id: axis.id ?? slug(axis.label || `track-${index + 1}`),
    ...(axis.label ? { label: axis.label } : {}),
    ...(axis.endLabel ? { endLabel: axis.endLabel } : {}),
    row: axis.row,
    startColumn: axis.startColumn,
    endColumn: axis.endColumn,
    events: axis.markerColumns.map((markerColumn, eventIndex) => {
      const inline = axis.inline[eventIndex];
      return {
        id: inline.id ?? '',
        label: inline.label ?? '',
        ...(inline.description ? { description: inline.description } : {}),
        column: inline.column ?? markerColumn,
        ...(inline.side ? { side: inline.side } : {}),
        ...(inline.descriptionSide ? { descriptionSide: inline.descriptionSide } : {}),
        ...(inline.callout === false ? { callout: false } : {}),
        marker: markerKind(axis.markerGlyphs[eventIndex]),
      } satisfies AsciiTimelineEvent;
    }),
  }));

  // Labels immediately above an axis are the common authored form. Match by
  // source column, conservatively: a prose prefix ("kernel ticks:") must not
  // steal the first event just because it shares the same line.
  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    const track = tracks[i];
    const aboveRow = previousNonBlankRow(lines, axis.row - 1);
    if (aboveRow >= 0 && !axes.some((candidate) => candidate.row === aboveRow)) {
      const segments = splitPlainSegments(lines[aboveRow]);
      const pointEvents = track.events.filter((event) => !event.label);
      const aligned = alignedEventSegments(segments, pointEvents);
      if (aligned) {
        for (let eventIndex = 0; eventIndex < pointEvents.length; eventIndex++) {
          pointEvents[eventIndex].label = cleanProseText(aligned[eventIndex].text);
          pointEvents[eventIndex].side = 'above';
        }
        // A prose prefix ending in `:` on the label row is a stronger track
        // name than a generic axis suffix such as "sim time".
        const firstAligned = segments.indexOf(aligned[0]);
        const prefix = firstAligned > 0 ? segments[firstAligned - 1] : undefined;
        if (prefix?.text.trim().endsWith(':')) {
          track.label = stripTrailingColon(prefix.text);
          track.id = slug(track.label);
        }
      }
      for (const event of track.events) {
        if (event.label) continue;
        const gap = nearestEventGap(track.events, event.column);
        const threshold = Math.max(3, Math.min(8, gap * 0.38));
        const nearest = nearestSegment(segments, event.column, threshold);
        if (!nearest) continue;
        event.label = cleanProseText(nearest.text);
        event.side = 'above';
      }
    }
  }

  // Anchored pointers (▲/▼) are fractional events: unlike milestone dots,
  // they may intentionally sit between snapshots/ticks.
  let pointerCount = 0;
  for (let row = 0; row < lines.length; row++) {
    if (axes.some((axis) => axis.row === row)) continue;
    const chars = Array.from(lines[row]);
    const pointerColumns = chars
      .map((char, column) => ({ char, column }))
      .filter(({ char }) => POINTERS.has(char))
      .map(({ column }) => column);
    for (let pointerIndex = 0; pointerIndex < pointerColumns.length; pointerIndex++) {
      const column = pointerColumns[pointerIndex];
      const track = nearestTrack(tracks, row, column);
      if (!track) continue;
      pointerCount++;
      const nextPointer = pointerColumns[pointerIndex + 1] ?? chars.length;
      const after = cleanProseText(chars.slice(column + 1, nextPointer).join(''));
      // A prose prefix belongs only to the first pointer on a row. Subsequent
      // pointers own the text to their right, preventing `▲ A  ▲ B` from
      // contaminating both labels with the whole row.
      const prefix = pointerIndex === 0 ? cleanProseText(chars.slice(0, column).join('')) : '';
      const label = stripTrailingColon(prefix) || after || `Event ${track.events.length + 1}`;
      const description = prefix && after ? after : undefined;
      const side: AsciiTimelineSide = row < track.row ? 'above' : 'below';
      const existing = track.events.find(
        (event) => event.callout !== false && Math.abs(event.column - column) <= 1,
      );
      if (existing) {
        if (!existing.label) existing.label = label;
        if (description && !existing.description) existing.description = description;
        if (description) existing.descriptionSide ??= side;
        existing.side ??= side;
      } else {
        track.events.push({
          id: '',
          label,
          ...(description ? { description } : {}),
          column,
          side,
          ...(description ? { descriptionSide: side } : {}),
          marker: 'hollow',
        });
      }
    }
  }

  // Elbow-led callouts (`└─Δ28`, `└─ interpolate ...`) attach descriptions
  // to the closest point on the closest track. This covers interval labels
  // and multi-line explanatory callouts in the motivating sample.
  for (let row = 0; row < lines.length; row++) {
    if (axes.some((axis) => axis.row === row)) continue;
    const callouts = extractConnectorCallouts(lines[row]);
    const prefix =
      callouts.length > 0
        ? cleanProseText(Array.from(lines[row]).slice(0, callouts[0].start).join(''))
        : '';
    for (let calloutIndex = 0; calloutIndex < callouts.length; calloutIndex++) {
      const callout = callouts[calloutIndex];
      const track = nearestTrack(tracks, row, callout.start);
      if (!track || track.events.length === 0) continue;
      const event = nearestEvent(track.events, callout.start);
      if (!event) continue;
      const calloutText = cleanProseText(callout.text);
      const cleaned = calloutIndex === 0 && prefix ? `${prefix} ${calloutText}` : calloutText;
      if (!cleaned || cleaned === event.label) continue;
      if (event.callout === false) {
        // A cadence point becomes a real annotated event when the author
        // attaches an elbow callout to it; leaving `callout:false` would make
        // the template silently hide that authored text.
        event.callout = true;
        event.label = cleaned;
        event.side = row < track.row ? 'above' : 'below';
        continue;
      }
      event.description = event.description ? `${event.description} ${cleaned}` : cleaned;
      event.descriptionSide ??= row < track.row ? 'above' : 'below';
      event.side ??= row < track.row ? 'above' : 'below';
    }
  }

  const warnings: string[] = [];
  const usedTrackIds = new Map<string, number>();
  for (const track of tracks) track.id = dedupe(track.id, usedTrackIds);

  // Finalize ids only after labels/callouts have been associated.
  const usedEventIds = new Map<string, number>();
  for (const track of tracks) {
    track.events.sort((a, b) => a.column - b.column);
    for (let i = 0; i < track.events.length; i++) {
      const event = track.events[i];
      if (!event.label) {
        event.label = `Event ${i + 1}`;
        warnings.push(`unlabeled-event(${track.id}:${event.column})`);
      }
      event.id = dedupe(event.id || slug(event.label), usedEventIds);
      event.side ??= i % 2 === 0 ? 'above' : 'below';
    }
  }

  const eventIds = new Set(tracks.flatMap((track) => track.events.map((event) => event.id)));
  const labelToId = new Map<string, string>();
  for (const track of tracks) {
    for (const event of track.events) {
      labelToId.set(slug(event.label), event.id);
      labelToId.set(event.id, event.id);
    }
  }
  const links: AsciiTimelineLink[] = [];
  for (const branch of pendingBranches) {
    const source = labelToId.get(slug(branch.source)) ?? branch.source;
    const target = labelToId.get(slug(branch.target)) ?? branch.target;
    if (!eventIds.has(source) || !eventIds.has(target)) {
      warnings.push(`unresolved-link(${branch.source}->${branch.target})`);
      continue;
    }
    links.push({ source, target, ...(branch.label ? { label: branch.label } : {}) });
  }

  const stats: AsciiTimelineStats = {
    axisLines: axes.length,
    markerCount: axes.reduce((sum, axis) => sum + axis.markerColumns.length, 0),
    strongMarkerCount: axes.reduce((sum, axis) => sum + axis.strongMarkerCount, 0),
    horizontalChars: axes.reduce((sum, axis) => sum + axis.horizontalChars, 0),
    pointerCount,
    branchDeclarations: pendingBranches.length,
  };

  return {
    timeline: { tracks, links, width, height: lines.length, style, warnings },
    stats,
  };
}

/**
 * Many terminal timelines put labels at a consistent offset from every dot
 * (the motivating sample uses +6 columns), rather than centering them. When
 * the last N text segments have one stable offset, pair them in order.
 */
function alignedEventSegments(
  segments: readonly Segment[],
  events: readonly AsciiTimelineEvent[],
): Segment[] | undefined {
  if (events.length < 2 || segments.length < events.length) return undefined;
  const candidates = segments.slice(-events.length);
  if (candidates.some((segment) => cleanCalloutText(segment.text).length > 40)) return undefined;
  const offsets = candidates.map(
    (segment, index) => (segment.start + segment.end) / 2 - events[index].column,
  );
  const spread = Math.max(...offsets) - Math.min(...offsets);
  return spread <= 3 ? [...candidates] : undefined;
}

function analyzeAxisLine(
  line: string,
  row: number,
  style: AsciiTimelineStyle,
): AxisAnalysis | null {
  const chars = Array.from(line);
  const markerColumns: number[] = [];
  const markerGlyphs: string[] = [];
  let horizontalChars = 0;
  let strongMarkerCount = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (HORIZONTAL.has(ch)) horizontalChars++;
    if (isMarkerAt(chars, i, style)) {
      markerColumns.push(i);
      markerGlyphs.push(ch);
      if (STRONG_MARKERS.has(ch)) strongMarkerCount++;
    }
  }
  if (markerColumns.length === 0 || horizontalChars < 2) return null;

  const firstMarker = markerColumns[0];
  const colon = chars.slice(0, firstMarker).lastIndexOf(':');
  let startColumn: number;
  if (colon >= 0) {
    startColumn = colon + 1;
    while (chars[startColumn] === ' ') startColumn++;
  } else {
    let i = firstMarker - 1;
    while (i >= 0 && (HORIZONTAL.has(chars[i]) || chars[i] === ' ')) i--;
    startColumn = i + 1;
    while (chars[startColumn] === ' ') startColumn++;
  }

  let endColumn = markerColumns[markerColumns.length - 1];
  // Inline prose may contain `>` / `->`. A track terminator is structural
  // only when it follows a rail (allowing spaces between the rail and arrow).
  // Search directly from the last marker: brace-delimited prose may legally
  // occur in an end label, so a blind `lastIndexOf('}')` is not an attrs gate.
  const arrowSearchStart = endColumn + 1;
  const arrowColumn = chars.findIndex(
    (ch, index) =>
      index >= arrowSearchStart &&
      END_ARROWS.has(ch) &&
      hasRailBefore(chars, index, ch === '>' ? 3 : 2),
  );
  let payloadEndExclusive: number;
  if (arrowColumn >= 0) {
    endColumn = arrowColumn;
    // Do not feed the structural arrow into the event payload parser. This
    // lets internal prose arrows survive untouched.
    payloadEndExclusive = arrowColumn;
  } else {
    // With no structural arrow, all trailing prose belongs to the last event.
    const lastNonSpace = findLastNonSpace(chars);
    endColumn = Math.max(endColumn, lastNonSpace);
    payloadEndExclusive = endColumn + 1;
  }

  const prefix = parseTrackPrefix(stripTrailingColon(chars.slice(0, startColumn).join('').trim()));
  const suffix = cleanProseText(chars.slice(endColumn + 1).join(''));
  const label = prefix.label;
  const inline = markerColumns.map((column, index) => {
    const next = index + 1 < markerColumns.length ? markerColumns[index + 1] : payloadEndExclusive;
    return parseInlineEvent(chars.slice(column + 1, next).join(''));
  });

  return {
    row,
    ...(prefix.id ? { id: prefix.id } : {}),
    startColumn: prefix.startColumn ?? startColumn,
    endColumn: prefix.endColumn ?? Math.max(endColumn, startColumn + 1),
    markerColumns,
    markerGlyphs,
    inline,
    ...(label ? { label } : {}),
    ...(suffix ? { endLabel: suffix } : {}),
    horizontalChars,
    strongMarkerCount,
  };
}

/**
 * Recognize dense cadence rows such as
 * `client frames (120 Hz): f f f f f f`. They are timelines without an
 * authored rail: every repeated one-character token is a hollow point, while
 * `callout: false` keeps the visual timeline from labeling every frame.
 */
function analyzeCadenceLine(line: string, row: number): AxisAnalysis | null {
  const chars = Array.from(line);
  const colon = chars.indexOf(':');
  if (colon < 0) return null;
  const label = chars.slice(0, colon).join('').trim();
  if (!label) return null;

  const tokens: Array<{ value: string; column: number }> = [];
  let index = colon + 1;
  while (index < chars.length) {
    while (index < chars.length && /\s/u.test(chars[index])) index++;
    if (index >= chars.length) break;
    const start = index;
    while (index < chars.length && !/\s/u.test(chars[index])) index++;
    tokens.push({ value: chars.slice(start, index).join(''), column: start });
  }
  if (
    tokens.length < 4 ||
    tokens[0].value.length !== 1 ||
    tokens.some((token) => token.value !== tokens[0].value)
  ) {
    return null;
  }

  return {
    row,
    startColumn: tokens[0].column,
    endColumn: tokens[tokens.length - 1].column,
    markerColumns: tokens.map((token) => token.column),
    markerGlyphs: tokens.map(() => '○'),
    inline: tokens.map((token, tokenIndex) => ({
      label: token.value,
      id: `${slug(label)}-${tokenIndex + 1}`,
      column: token.column,
      callout: false,
    })),
    label,
    horizontalChars: 0,
    strongMarkerCount: 0,
  };
}

function parseInlineEvent(raw: string): {
  label?: string;
  description?: string;
  id?: string;
  column?: number;
  side?: AsciiTimelineSide;
  descriptionSide?: AsciiTimelineSide;
  callout?: boolean;
} {
  // Separator rails only have structural meaning at the payload edges.
  // Internal prose such as `release--candidate` and `A > B` is content.
  let text = stripEdgeRails(raw).replace(/\s+/g, ' ').trim();
  if (!text) return {};

  let id: string | undefined;
  let column: number | undefined;
  let side: AsciiTimelineSide | undefined;
  let descriptionSide: AsciiTimelineSide | undefined;
  let callout: boolean | undefined;
  const attrs = /\{([^{}]+)\}\s*$/.exec(text);
  if (attrs) {
    let recognized = false;
    for (const token of attrs[1].trim().split(/\s+/)) {
      if (token.startsWith('#') && token.length > 1) {
        id = token.slice(1);
        recognized = true;
      } else if (token === 'side=above') {
        side = 'above';
        recognized = true;
      } else if (token === 'side=below') {
        side = 'below';
        recognized = true;
      } else if (token === 'descriptionSide=above') {
        descriptionSide = 'above';
        recognized = true;
      } else if (token === 'descriptionSide=below') {
        descriptionSide = 'below';
        recognized = true;
      } else if (token.startsWith('column=')) {
        const parsed = parseCoordinate(token.slice(7));
        if (parsed !== undefined) {
          column = parsed;
          recognized = true;
        }
      } else if (token === 'callout=false') {
        callout = false;
        recognized = true;
      } else if (token === 'callout=true') {
        callout = true;
        recognized = true;
      }
    }
    if (recognized) text = text.slice(0, attrs.index).trim();
  }
  if (text.startsWith('^ ')) {
    side = 'above';
    text = text.slice(2).trim();
  } else if (/^[vV]\s+/.test(text)) {
    side = 'below';
    text = text.slice(2).trim();
  }
  const separator = text.indexOf('::');
  const label = (separator >= 0 ? text.slice(0, separator) : text).trim();
  const description = separator >= 0 ? text.slice(separator + 2).trim() : undefined;
  return {
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(id ? { id } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(side ? { side } : {}),
    ...(descriptionSide ? { descriptionSide } : {}),
    ...(callout !== undefined ? { callout } : {}),
  };
}

function parseTrackPrefix(text: string): {
  label?: string;
  id?: string;
  startColumn?: number;
  endColumn?: number;
  hasMetadata: boolean;
} {
  let label = text.trim();
  let id: string | undefined;
  let startColumn: number | undefined;
  let endColumn: number | undefined;
  let recognized = false;
  const attrs = /\{([^{}]+)\}\s*$/.exec(label);
  if (attrs) {
    for (const token of attrs[1].trim().split(/\s+/)) {
      if (token.startsWith('#') && token.length > 1) {
        id = token.slice(1);
        recognized = true;
      } else if (token.startsWith('start=')) {
        startColumn = parseCoordinate(token.slice(6));
        recognized ||= startColumn !== undefined;
      } else if (token.startsWith('end=')) {
        endColumn = parseCoordinate(token.slice(4));
        recognized ||= endColumn !== undefined;
      }
    }
    if (recognized) label = label.slice(0, attrs.index).trim();
  }
  return {
    ...(label ? { label } : {}),
    ...(id ? { id } : {}),
    ...(startColumn !== undefined ? { startColumn } : {}),
    ...(endColumn !== undefined ? { endColumn } : {}),
    hasMetadata: recognized,
  };
}

function parseCoordinate(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripEdgeRails(raw: string): string {
  const chars = Array.from(raw);
  let start = 0;
  let end = chars.length - 1;

  // A structural leading rail either touches the marker (`●── label`) or is
  // followed by whitespace (`● ── label`). A payload that begins after a
  // space with `-1.5`, `--watch`, or `─phase` is authored prose and stays.
  let firstNonSpace = 0;
  while (firstNonSpace <= end && /\s/u.test(chars[firstNonSpace])) firstNonSpace++;
  let leadingRailEnd = firstNonSpace;
  while (leadingRailEnd <= end && HORIZONTAL.has(chars[leadingRailEnd])) leadingRailEnd++;
  const hasLeadingRail = leadingRailEnd > firstNonSpace;
  const structuralLeadingRail =
    hasLeadingRail &&
    (firstNonSpace === 0 || leadingRailEnd > end || /\s/u.test(chars[leadingRailEnd] ?? ''));
  start = structuralLeadingRail ? leadingRailEnd : firstNonSpace;
  while (start <= end && /\s/u.test(chars[start])) start++;

  while (end >= start && /\s/u.test(chars[end])) end--;
  const trailingRailEnd = end;
  while (end >= start && HORIZONTAL.has(chars[end])) end--;
  const hasTrailingRail = end < trailingRailEnd;
  // Separators are normally preceded by whitespace; a long/Unicode run is
  // also safely structural in compact `label───●` authored art.
  const trailingRun = hasTrailingRail ? chars.slice(end + 1, trailingRailEnd + 1) : [];
  const structuralTrailingRail =
    hasTrailingRail &&
    (end < start ||
      /\s/u.test(chars[end] ?? '') ||
      trailingRun.length >= 3 ||
      trailingRun.some((char) => char !== '-'));
  if (!structuralTrailingRail) end = trailingRailEnd;
  while (end >= start && /\s/u.test(chars[end])) end--;
  return chars.slice(start, end + 1).join('');
}

function hasRailBefore(chars: readonly string[], column: number, minimum: number): boolean {
  let index = column - 1;
  while (index >= 0 && /\s/u.test(chars[index])) index--;
  let count = 0;
  while (index >= 0 && HORIZONTAL.has(chars[index])) {
    count++;
    index--;
  }
  return count >= minimum;
}

function findLastNonSpace(chars: readonly string[]): number {
  for (let index = chars.length - 1; index >= 0; index--) {
    if (!/\s/u.test(chars[index])) return index;
  }
  return -1;
}

function parseBranchDeclaration(line: string): PendingBranch | null {
  const match =
    /^\s*(?:branch|link)\s*:\s*([^\s:]+)\s*(?:->|=>|→)\s*([^\s:]+)(?:\s*:\s*(.+))?\s*$/i.exec(line);
  if (!match) return null;
  return {
    source: match[1],
    target: match[2],
    ...(match[3]?.trim() ? { label: match[3].trim() } : {}),
  };
}

function splitPlainSegments(line: string): Segment[] {
  const chars = Array.from(line);
  const out: Segment[] = [];
  let start = -1;
  let spaces = 0;
  for (let i = 0; i <= chars.length; i++) {
    const ch = chars[i];
    if (ch === ' ') {
      spaces++;
      if (start >= 0 && spaces >= 2) {
        const end = i - spaces;
        const text = chars
          .slice(start, end + 1)
          .join('')
          .trim();
        if (text) out.push({ start, end, text });
        start = -1;
      }
      continue;
    }
    spaces = 0;
    if (ch !== undefined && start < 0) start = i;
    if (ch === undefined && start >= 0) {
      const text = chars.slice(start).join('').trim();
      if (text) out.push({ start, end: chars.length - 1, text });
    }
  }
  return out.filter((segment) => cleanCalloutText(segment.text).length > 0);
}

function extractConnectorCallouts(line: string): Segment[] {
  const chars = Array.from(line);
  const out: Segment[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (!CONNECTOR_ANCHORS.has(chars[i])) continue;
    let j = i + 1;
    const railStart = j;
    while (j < chars.length && (HORIZONTAL.has(chars[j]) || chars[j] === ' ')) j++;
    const railEnd = j;
    // In `└─-1.5` / `└─--watch`, the Unicode rail is structural but the
    // following ASCII hyphen run is authored prose. Preserve that suffix.
    const afterRail = chars[j];
    if (afterRail !== undefined && !/\s/u.test(afterRail)) {
      let lastNonAsciiRail = -1;
      for (let railIndex = railStart; railIndex < j; railIndex++) {
        if (HORIZONTAL.has(chars[railIndex]) && chars[railIndex] !== '-') {
          lastNonAsciiRail = railIndex;
        }
      }
      if (lastNonAsciiRail >= railStart && lastNonAsciiRail + 1 < j) {
        j = lastNonAsciiRail + 1;
      } else if (lastNonAsciiRail < 0 && j - railStart >= 3) {
        j--;
      }
    }
    const textStart = j;
    if (j < railEnd) while (j < chars.length && chars[j] === '-') j++;
    while (j < chars.length && !HORIZONTAL.has(chars[j]) && !CONNECTOR_ANCHORS.has(chars[j])) j++;
    const text = chars.slice(textStart, j).join('').trim();
    if (text) out.push({ start: i, end: Math.max(i, j - 1), text });
  }
  return out;
}

function nearestTrack(
  tracks: readonly AsciiTimelineTrack[],
  row: number,
  column: number,
): AsciiTimelineTrack | undefined {
  return tracks
    .filter((track) => column >= track.startColumn - 2 && column <= track.endColumn + 2)
    .sort((a, b) => Math.abs(a.row - row) - Math.abs(b.row - row))[0];
}

function nearestEvent(
  events: readonly AsciiTimelineEvent[],
  column: number,
): AsciiTimelineEvent | undefined {
  return [...events].sort(
    (a, b) =>
      Math.abs(a.column - column) - Math.abs(b.column - column) ||
      Number(a.callout === false) - Number(b.callout === false),
  )[0];
}

function nearestSegment(
  segments: readonly Segment[],
  column: number,
  threshold: number,
): Segment | undefined {
  return [...segments]
    .map((segment) => ({ segment, distance: Math.abs((segment.start + segment.end) / 2 - column) }))
    .filter((candidate) => candidate.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)[0]?.segment;
}

function nearestEventGap(events: readonly AsciiTimelineEvent[], column: number): number {
  const gaps = events
    .filter((event) => event.column !== column)
    .map((event) => Math.abs(event.column - column));
  return gaps.length > 0 ? Math.min(...gaps) : 12;
}

function previousNonBlankRow(lines: readonly string[], from: number): number {
  for (let row = from; row >= 0; row--) if (lines[row].trim()) return row;
  return -1;
}

function markerKind(glyph: string): AsciiTimelineMarker {
  if (glyph === '◆' || glyph === '◇') return 'diamond';
  if (glyph === '○' || glyph === 'o' || glyph === 'O') return 'hollow';
  return 'filled';
}

function isMarkerAt(chars: readonly string[], index: number, style: AsciiTimelineStyle): boolean {
  const glyph = chars[index];
  if (STRONG_MARKERS.has(glyph)) return true;
  if (style !== 'ascii' || !ASCII_MARKERS.has(glyph)) return false;
  // ASCII marker glyphs are ordinary prose/code characters too. Only treat
  // them as points when they touch a real rail run. Requiring two rail cells
  // plus a prose boundary avoids turning `Go-live`, `foo--bar`, or
  // `release-o` into phantom dots.
  const leftRail = railRun(chars, index, -1);
  const rightRail = railRun(chars, index, 1);
  const beforeIsWord = /[\p{L}\p{N}_]/u.test(chars[index - 1] ?? '');
  const afterIsWord = /[\p{L}\p{N}_]/u.test(chars[index + 1] ?? '');
  return (leftRail >= 2 && !afterIsWord) || (rightRail >= 2 && !beforeIsWord);
}

function railRun(chars: readonly string[], index: number, direction: -1 | 1): number {
  let count = 0;
  for (let cursor = index + direction; HORIZONTAL.has(chars[cursor] ?? ''); cursor += direction) {
    count++;
  }
  return count;
}

function cleanCalloutText(text: string): string {
  return text
    .replace(/^[\s│|└┌├┬┘┐╰╭╯╮─━═╌╍┄┅┈┉-]+/u, '')
    .replace(/[\s│|└┌├┬┘┐╰╭╯╮─━═╌╍┄┅┈┉►▶▷→>-]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize already-separated prose without stripping meaningful `-`/rails. */
function cleanProseText(text: string): string {
  return text
    .replace(/^[\s│|]+/u, '')
    .replace(/[\s│|]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingColon(text: string): string {
  return text.replace(/:\s*$/, '').trim();
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event'
  );
}

function dedupe(base: string, used: Map<string, number>): string {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function detectStyle(lines: readonly string[]): AsciiTimelineStyle {
  for (const line of lines) {
    for (const ch of line) {
      if (
        STRONG_MARKERS.has(ch) ||
        (HORIZONTAL.has(ch) && ch !== '-') ||
        ['►', '▶', '▷', '→'].includes(ch)
      ) {
        // Unicode structural vocabulary is unambiguous. Prefer it even when
        // labels/descriptions contain many ordinary ASCII `o`, `-`, or `>`
        // characters; those prose characters must not flip marker parsing.
        return 'unicode';
      }
    }
  }
  return 'ascii';
}
