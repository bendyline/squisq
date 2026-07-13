/**
 * Conservative parser for two-or-more-lane flow art whose last edge wraps
 * around the right margin. This dialect is common in AI-authored architecture
 * notes and sequence sketches:
 *
 *   CLIENT                 KERNEL
 *   ──────                 ──────
 *   input ──► command ────► validate
 *                            ├─ invalid → rejected ─┐
 *   surfaced ◄─────────────────────────────────────┘
 *
 * It is intentionally strict. Every nonblank row must be a heading,
 * underline, connector-only row, parenthetical continuation, or prose joined
 * by an explicit arrow. Accepted art is converted to the ordinary timeline
 * model, after which the canonical timeline renderer owns the authored form.
 */

import type {
  AsciiTimeline,
  AsciiTimelineEvent,
  AsciiTimelineLink,
  AsciiTimelineTrack,
} from './types.js';

interface TextSegment {
  text: string;
  start: number;
  end: number;
  trackIndex: number;
}

interface TrackBand {
  id: string;
  label: string;
  row: number;
  start: number;
  end: number;
}

interface EventDraft {
  id: string;
  label: string;
  description?: string;
  trackIndex: number;
  order: number;
}

interface LinkDraft {
  source: string;
  target: string;
  label?: string;
}

interface PendingDescription {
  eventId: string;
  text: string;
}

const UNDERLINE_RE = /[─━═-]{6,}/gu;
const FLOW_CHAR_RE = /[─━═│|►◄→←┌┐└┘├┤]/u;
const ARROW_RE = /[►◄→←]/u;
const LEFT_ARROW_RE = /[◄←]/u;
const RIGHT_ARROW_RE = /[►→]/u;
const CONNECTOR_ONLY_RE = /^[\s─━═│|►◄→←┌┐└┘├┤]+$/u;
const HEADER_RE = /^[A-Z][A-Z0-9 _/-]*(?:\s+\([^)]*\))?$/u;

/** Parse the wrapped-flow dialect, or return null without claiming the art. */
export function parseWrappedFlowTimeline(text: string): AsciiTimeline | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const header = findHeader(lines);
  if (!header || header.tracks.length < 2) return null;

  const drafts: EventDraft[] = [];
  const links: LinkDraft[] = [];
  const usedIds = new Set<string>();
  const lastByTrack = new Map<number, string>();
  let pendingDescription: PendingDescription | null = null;
  let activeBranchRoot: string | null = null;
  let wrapSource: string | null = null;
  let arrowCount = 0;
  let hasLeftArrow = false;
  let hasRightArrow = false;
  let hasWrapTop = false;
  let hasWrapBottom = false;

  const addEvent = (segment: TextSegment): EventDraft => {
    const label = normalizeText(segment.text);
    const id = uniqueId(label, usedIds);
    const draft: EventDraft = {
      id,
      label,
      trackIndex: segment.trackIndex,
      order: drafts.length,
    };
    drafts.push(draft);
    return draft;
  };
  const addLink = (source: string | undefined, target: string | undefined, label?: string) => {
    if (!source || !target || source === target) return;
    if (
      links.some((link) => link.source === source && link.target === target && link.label === label)
    ) {
      return;
    }
    links.push({ source, target, ...(label ? { label } : {}) });
  };

  for (let row = header.underlineRow + 1; row < lines.length; row++) {
    const original = lines[row];
    if (!original.trim()) continue;
    if (CONNECTOR_ONLY_RE.test(original)) {
      hasWrapTop ||= original.includes('┐');
      hasWrapBottom ||= original.includes('┘');
      continue;
    }

    const trimmed = original.trim();
    if (trimmed.startsWith('(') && !ARROW_RE.test(original)) {
      const trackIndex = trackIndexAt(header.tracks, firstContentColumn(original));
      const eventId = lastByTrack.get(trackIndex);
      if (!eventId) return null;
      pendingDescription = {
        eventId,
        text: normalizeText(original.replace(/[│|]+\s*$/u, '')),
      };
      continue;
    }

    let line = original;
    let continuationTarget: string | null = null;
    if (pendingDescription) {
      const firstArrow = firstArrowColumn(line);
      if (firstArrow < 0) return null;
      const continuation = normalizeText(Array.from(line).slice(0, firstArrow).join(''));
      const event = drafts.find((candidate) => candidate.id === pendingDescription?.eventId);
      if (!event) return null;
      event.description = normalizeText(`${pendingDescription.text} ${continuation}`);
      continuationTarget = event.id;
      line = `${' '.repeat(firstArrow)}${Array.from(line).slice(firstArrow).join('')}`;
      pendingDescription = null;
    }

    const segments = extractSegments(line, header.tracks);
    if (segments.length === 0) return null;
    if (segments.some((segment) => !/[\p{L}\p{N}]/u.test(segment.text))) return null;

    const previousByTrack = new Map(lastByTrack);
    const events = segments.map(addEvent);
    const directions: Array<'left' | 'right' | null> = [];
    for (let index = 0; index < segments.length - 1; index++) {
      const between = Array.from(line)
        .slice(segments[index].end + 1, segments[index + 1].start)
        .join('');
      const direction = LEFT_ARROW_RE.test(between)
        ? 'left'
        : RIGHT_ARROW_RE.test(between)
          ? 'right'
          : null;
      directions.push(direction);
      if (direction) arrowCount++;
      hasLeftArrow ||= direction === 'left';
      hasRightArrow ||= direction === 'right';
      if (direction === 'left') addLink(events[index + 1].id, events[index].id);
      if (direction === 'right') addLink(events[index].id, events[index + 1].id);
    }

    const leadingBranch = /^[\s│|]*[├└]/u.exec(original)?.[0] ?? '';
    if (leadingBranch) {
      if (!activeBranchRoot) {
        activeBranchRoot = previousByTrack.get(events[0].trackIndex) ?? null;
      }
      addLink(activeBranchRoot ?? undefined, events[0].id);
      if (leadingBranch.includes('└')) activeBranchRoot = null;
    } else {
      activeBranchRoot = null;
    }

    const allLeft = directions.length > 0 && directions.every((direction) => direction === 'left');
    const ordered = allLeft ? [...events].reverse() : events;
    const first = ordered[0];
    if (!leadingBranch && !original.includes('┘')) {
      addLink(previousByTrack.get(first.trackIndex), first.id);
    }
    if (continuationTarget) addLink(ordered[ordered.length - 1]?.id, continuationTarget);

    for (const event of ordered) lastByTrack.set(event.trackIndex, event.id);

    if (original.includes('┐')) {
      hasWrapTop = true;
      wrapSource = events[events.length - 1]?.id ?? null;
    }
    if (original.includes('┘')) {
      hasWrapBottom = true;
      const target = allLeft ? events[0]?.id : events[events.length - 1]?.id;
      addLink(wrapSource ?? undefined, target);
    }
  }

  if (pendingDescription || drafts.length < 6) return null;
  if (arrowCount < 4 || !hasLeftArrow || !hasRightArrow || !hasWrapTop || !hasWrapBottom) {
    return null;
  }
  if (!hasCrossTrackLink(drafts, links)) return null;

  const columns = assignColumns(drafts, links);
  const endColumn = Math.max(10, ...columns.values());
  const tracks: AsciiTimelineTrack[] = header.tracks.map((band, trackIndex) => {
    const trackEvents = drafts
      .filter((event) => event.trackIndex === trackIndex)
      .sort(
        (left, right) =>
          (columns.get(left.id) ?? 0) - (columns.get(right.id) ?? 0) || left.order - right.order,
      );
    let previousColumn = -1;
    const events: AsciiTimelineEvent[] = trackEvents.map((event, index) => {
      const ideal = columns.get(event.id) ?? index * 10;
      const column = Math.max(previousColumn + 1, ideal);
      previousColumn = column;
      return {
        id: event.id,
        label: event.label,
        ...(event.description ? { description: event.description } : {}),
        column,
        side: index % 2 === 0 ? 'above' : 'below',
        marker: 'filled',
      };
    });
    return {
      id: band.id,
      label: band.label,
      row: band.row,
      startColumn: 0,
      endColumn,
      events,
    };
  });
  const width = Math.max(0, ...lines.map((line) => Array.from(line).length));
  links.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      (left.label ?? '').localeCompare(right.label ?? ''),
  );
  return {
    tracks,
    links: links satisfies AsciiTimelineLink[],
    width,
    height: lines.length,
    style: 'unicode',
    warnings: [],
  };
}

/** High-confidence predicate used by the editor's lossless rewrite gate. */
export function isWrappedFlowTimelineSource(text: string): boolean {
  return parseWrappedFlowTimeline(text) !== null;
}

function findHeader(
  lines: readonly string[],
): { tracks: TrackBand[]; underlineRow: number } | null {
  for (let row = 1; row < Math.min(lines.length, 5); row++) {
    const runs = Array.from(lines[row].matchAll(UNDERLINE_RE)).map((match) => ({
      start: match.index,
      end: (match.index ?? 0) + Array.from(match[0]).length - 1,
    }));
    if (runs.length < 2) continue;
    const headings = splitHeader(lines[row - 1]);
    if (
      headings.length !== runs.length ||
      headings.some((heading) => !HEADER_RE.test(heading.text))
    ) {
      continue;
    }
    const tracks = runs.map((run, index): TrackBand => {
      const heading = headings[index];
      const base = heading.text.replace(/\s+\([^)]*\)\s*$/u, '').trim();
      return {
        id: safeId(base),
        label: heading.text,
        row: row - 1,
        start: run.start,
        end: run.end,
      };
    });
    return { tracks, underlineRow: row };
  }
  return null;
}

function splitHeader(line: string): Array<{ text: string; start: number; end: number }> {
  const chars = Array.from(line);
  const segments: Array<{ text: string; start: number; end: number }> = [];
  let start = -1;
  let spaces = 0;
  for (let index = 0; index <= chars.length; index++) {
    const char = chars[index];
    if (char === ' ') {
      spaces++;
      if (start >= 0 && spaces >= 3) {
        const end = index - spaces;
        const text = chars
          .slice(start, end + 1)
          .join('')
          .trim();
        if (text) segments.push({ text, start, end });
        start = -1;
      }
      continue;
    }
    spaces = 0;
    if (char !== undefined && start < 0) start = index;
    if (char === undefined && start >= 0) {
      const text = chars.slice(start).join('').trim();
      if (text) segments.push({ text, start, end: chars.length - 1 });
    }
  }
  return segments;
}

function extractSegments(line: string, tracks: readonly TrackBand[]): TextSegment[] {
  const chars = Array.from(line);
  const segments: TextSegment[] = [];
  let start = -1;
  for (let index = 0; index <= chars.length; index++) {
    const structural = index === chars.length || FLOW_CHAR_RE.test(chars[index] ?? '');
    if (!structural && start < 0) start = index;
    if (!structural || start < 0) continue;
    const raw = chars.slice(start, index).join('');
    const leading = raw.length - raw.trimStart().length;
    const text = normalizeText(raw);
    if (text) {
      const segmentStart = start + leading;
      const segmentEnd = segmentStart + Array.from(text).length - 1;
      segments.push({
        text,
        start: segmentStart,
        end: segmentEnd,
        trackIndex: trackIndexAt(tracks, segmentStart),
      });
    }
    start = -1;
  }
  return segments;
}

function trackIndexAt(tracks: readonly TrackBand[], column: number): number {
  for (let index = 1; index < tracks.length; index++) {
    if (column < tracks[index].start) return index - 1;
  }
  return tracks.length - 1;
}

function firstContentColumn(line: string): number {
  const chars = Array.from(line);
  const index = chars.findIndex((char) => /[\p{L}\p{N}(]/u.test(char));
  return Math.max(0, index);
}

function firstArrowColumn(line: string): number {
  return Array.from(line).findIndex((char) => ARROW_RE.test(char));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/^[\s:]+|[\s:]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function safeId(value: string): string {
  return (
    value
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^a-z0-9_.~-]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'event'
  );
}

function uniqueId(label: string, used: Set<string>): string {
  const base = safeId(label);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  const id = `${base}-${suffix}`;
  used.add(id);
  return id;
}

function hasCrossTrackLink(events: readonly EventDraft[], links: readonly LinkDraft[]): boolean {
  const trackById = new Map(events.map((event) => [event.id, event.trackIndex]));
  return links.some((link) => trackById.get(link.source) !== trackById.get(link.target));
}

function assignColumns(
  events: readonly EventDraft[],
  links: readonly LinkDraft[],
): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(events.map((event) => [event.id, 0]));
  for (const link of links) {
    outgoing.set(link.source, [...(outgoing.get(link.source) ?? []), link.target]);
    indegree.set(link.target, (indegree.get(link.target) ?? 0) + 1);
  }
  const ranks = new Map(events.map((event) => [event.id, 0]));
  const queue = events.filter((event) => indegree.get(event.id) === 0).map((event) => event.id);
  let visited = 0;
  while (queue.length > 0) {
    const source = queue.shift() as string;
    visited++;
    for (const target of outgoing.get(source) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(source) ?? 0) + 1));
      const next = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visited < events.length) {
    for (const event of events) ranks.set(event.id, event.order);
  }
  return new Map(Array.from(ranks, ([id, rank]) => [id, rank * 10]));
}
