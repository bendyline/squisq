/**
 * Write direction for the WYSIWYG timeline editor:
 *
 *   fence text -> parse -> pure op -> render -> verify -> one fence rewrite
 *
 * The original code block remains the source of truth and every successful
 * edit is a single ProseMirror transaction/undo step.
 */

import type { Editor } from '@tiptap/react';
import {
  parseAsciiTimeline,
  renderAsciiTimeline,
  type AsciiTimeline,
  type AsciiTimelineMarker,
  type AsciiTimelineSide,
} from '@bendyline/squisq/doc';
import { replaceAsciiFenceText } from '../asciiDiagram/asciiDiagramCommands';
import { findTimelineBlockPos, parseTimelineForNode } from './TimelineViewExtension';
import {
  addTimelineEventOp,
  removeTimelineEventOp,
  updateTimelineEventOp,
  type TimelineEventPatch,
} from './timelineOps';

export type TimelineCommand =
  | {
      kind: 'addEvent';
      trackId: string;
      /** Normalized position on the global timeline rail. */
      position: number;
      id?: string;
      label?: string;
      description?: string;
      side?: AsciiTimelineSide;
      descriptionSide?: AsciiTimelineSide;
      callout?: boolean;
      marker?: AsciiTimelineMarker;
    }
  | { kind: 'updateEvent'; eventId: string; patch: TimelineEventPatch }
  | { kind: 'removeEvent'; eventId: string };

export interface TimelineCommandResult {
  applied: boolean;
  /** Present after add so the widget can select/focus the new marker. */
  eventId?: string;
  /** Why an otherwise valid semantic edit was deliberately blocked. */
  reason?: 'read-only' | 'unsafe-source';
}

interface OpResult {
  timeline: AsciiTimeline;
  eventId?: string;
}

const NOT_APPLIED: TimelineCommandResult = { applied: false };
const READ_ONLY: TimelineCommandResult = { applied: false, reason: 'read-only' };
const UNSAFE_SOURCE: TimelineCommandResult = { applied: false, reason: 'unsafe-source' };

function countEvents(timeline: AsciiTimeline): number {
  return timeline.tracks.reduce((sum, track) => sum + track.events.length, 0);
}

function hasEvent(timeline: AsciiTimeline, eventId: string): boolean {
  return timeline.tracks.some((track) => track.events.some((event) => event.id === eventId));
}

/**
 * Layout rows and source dimensions are deliberately absent: canonical
 * rendering is allowed to compact hand-authored art. Everything the editor
 * can semantically preserve is included, so this signature can distinguish
 * harmless layout normalization from content loss.
 */
function semanticSignature(timeline: AsciiTimeline): string {
  return JSON.stringify({
    style: timeline.style,
    tracks: timeline.tracks.map((track) => ({
      id: track.id,
      label: track.label,
      endLabel: track.endLabel,
      startColumn: track.startColumn,
      endColumn: track.endColumn,
      events: track.events.map((event) => ({
        id: event.id,
        label: event.label,
        description: event.description,
        column: event.column,
        side: event.side,
        descriptionSide: event.descriptionSide,
        callout: event.callout,
        marker: event.marker,
      })),
    })),
    links: timeline.links,
    warnings: timeline.warnings,
  });
}

const METADATA_BLOCK_RE = /\{([^{}\r\n]*)\}/gu;
const METADATA_ATTEMPT_RE = /^(?:#[^\s{}]*|[A-Za-z][A-Za-z0-9]*=)/u;
const MALFORMED_METADATA_RE =
  /(?:\{[^{}\r\n]*(?:#[^\s{}]+|[A-Za-z][A-Za-z0-9]*=)|(?:#[^\s{}]+|[A-Za-z][A-Za-z0-9]*=)[^{}\r\n]*\})/u;
const UNICODE_MARKER_RE = /[●○◉◆◇•]/u;
const ASCII_MARKERS = new Set(['*', 'o', 'O']);
const RAIL_CHARS = new Set(['─', '━', '═', '╌', '╍', '┄', '┅', '┈', '┉', '-']);
const STRUCTURAL_CHARS_RE = /[─━═╌╍┄┅┈┉●○◉◆◇•►▶▷→>▲△▼▽│|└┌├┬┘┐╰╭╯╮:\-*]/gu;
const SEMANTIC_LEXEME_RE = /[\p{L}\p{N}_]+|[^\s]/gu;

type MetadataKind = 'track' | 'event';

/**
 * Validate every metadata block that the parser could consume, then replace
 * it with whitespace for source-content comparison. The parser deliberately
 * accepts recognized tokens from a mixed block and ignores the rest; the
 * editor must be stricter or `{#id unknown}` would be silently normalized.
 */
function validateAndStripMetadata(source: string, timeline: AsciiTimeline): string | null {
  const trackRows = new Set(timeline.tracks.map((track) => track.row));
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  for (let row = 0; row < lines.length; row++) {
    if (!trackRows.has(row)) continue;
    const line = lines[row];
    const firstMarker = firstAxisMarkerOffset(line, timeline.style);
    let valid = true;
    const stripped = line.replace(METADATA_BLOCK_RE, (block, inner: string, offset: number) => {
      const tokens = inner.trim() ? inner.trim().split(/\s+/u) : [];
      if (!tokens.some((token) => METADATA_ATTEMPT_RE.test(token))) return block;
      const kind: MetadataKind = firstMarker >= 0 && offset < firstMarker ? 'track' : 'event';
      if (!isValidMetadata(tokens, kind)) valid = false;
      return ' '.repeat(block.length);
    });
    // A missing/opening brace prevents METADATA_BLOCK_RE from seeing the
    // block at all. Reject the remaining metadata-shaped fragment as well.
    if (!valid || MALFORMED_METADATA_RE.test(stripped)) return null;
    lines[row] = stripped;
  }
  return lines.join('\n');
}

function isValidMetadata(tokens: readonly string[], kind: MetadataKind): boolean {
  if (tokens.length === 0) return false;
  const seen = new Set<string>();
  for (const token of tokens) {
    let key: string;
    let valid = false;
    if (token.startsWith('#') && token.length > 1) {
      key = '#';
      valid = !/[{}\s]/u.test(token.slice(1));
    } else {
      const separator = token.indexOf('=');
      key = separator > 0 ? token.slice(0, separator) : token;
      const value = separator > 0 ? token.slice(separator + 1) : '';
      if (kind === 'track' && (key === 'start' || key === 'end')) {
        valid = value.trim() !== '' && Number.isFinite(Number(value));
      } else if (kind === 'event' && key === 'side') {
        valid = value === 'above' || value === 'below';
      } else if (kind === 'event' && key === 'descriptionSide') {
        valid = value === 'above' || value === 'below';
      } else if (kind === 'event' && key === 'column') {
        valid = value.trim() !== '' && Number.isFinite(Number(value));
      } else if (kind === 'event' && key === 'callout') {
        valid = value === 'true' || value === 'false';
      }
    }
    if (!valid || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function firstAxisMarkerOffset(line: string, style: AsciiTimeline['style']): number {
  if (style === 'unicode') return line.search(UNICODE_MARKER_RE);
  for (let index = 0; index < line.length; index++) {
    if (!ASCII_MARKERS.has(line[index])) continue;
    const leftRail = railRun(line, index, -1);
    const rightRail = railRun(line, index, 1);
    const beforeIsWord = /[\p{L}\p{N}_]/u.test(line[index - 1] ?? '');
    const afterIsWord = /[\p{L}\p{N}_]/u.test(line[index + 1] ?? '');
    if ((leftRail >= 2 && !afterIsWord) || (rightRail >= 2 && !beforeIsWord)) return index;
  }
  return -1;
}

function railRun(line: string, index: number, direction: -1 | 1): number {
  let count = 0;
  for (let cursor = index + direction; RAIL_CHARS.has(line[cursor] ?? ''); cursor += direction) {
    count++;
  }
  return count;
}

function semanticLexemeCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const prose = text.normalize('NFC').replace(STRUCTURAL_CHARS_RE, ' ');
  for (const match of prose.matchAll(SEMANTIC_LEXEME_RE)) {
    const lexeme = match[0].toLocaleLowerCase();
    counts.set(lexeme, (counts.get(lexeme) ?? 0) + 1);
  }
  return counts;
}

function countsEqual(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [lexeme, count] of left) {
    if (right.get(lexeme) !== count) return false;
  }
  return true;
}

function hasUnrepresentedStructuralOnlyLine(source: string, timeline: AsciiTimeline): boolean {
  const trackRows = new Set(timeline.tracks.map((track) => track.row));
  const lines = source.split('\n');
  for (let row = 0; row < lines.length; row++) {
    if (!lines[row].trim() || trackRows.has(row)) continue;
    if (semanticLexemeCounts(lines[row]).size === 0) return true;
  }
  return false;
}

/**
 * Semantic operations replace the whole fence with canonical rendered art.
 * Fail closed when that would discard source the timeline model cannot
 * represent. Warnings catch unresolved/unlabeled constructs; the semantic
 * round-trip catches renderer normalization that changes modeled content;
 * exact metadata validation rejects partially consumed attrs; and a linear
 * semantic-residue comparison catches ignored prose/symbol rows without
 * reparsing a successively shorter document for every source line.
 */
export function isTimelineSourceSafeForSemanticEdit(
  source: string,
  timeline: AsciiTimeline,
): boolean {
  if (timeline.warnings.length > 0) return false;

  const rendered = renderAsciiTimeline(timeline);
  if (!rendered) return false;
  const reparsed = parseAsciiTimeline(rendered);
  const signature = semanticSignature(timeline);
  if (reparsed.warnings.length > 0 || semanticSignature(reparsed) !== signature) return false;

  const strippedSource = validateAndStripMetadata(source, timeline);
  const strippedRendered = validateAndStripMetadata(rendered, reparsed);
  if (!strippedSource || !strippedRendered) return false;
  if (hasUnrepresentedStructuralOnlyLine(strippedSource, timeline)) return false;
  return countsEqual(semanticLexemeCounts(strippedSource), semanticLexemeCounts(strippedRendered));
}

/**
 * Verify the renderer/parser boundary before changing the document. Rows and
 * source dimensions intentionally are not compared: canonical rendering
 * compacts authored multi-line art while preserving its semantic content.
 */
function verifyRenderedTimeline(next: AsciiTimeline, rendered: string): AsciiTimeline | null {
  if (!rendered) return null;
  const verification = parseAsciiTimeline(rendered);
  if (renderAsciiTimeline(verification) !== rendered) return null;
  if (verification.tracks.length !== next.tracks.length) return null;
  if (countEvents(verification) !== countEvents(next)) return null;
  if (verification.links.length !== next.links.length) return null;

  const ids = new Set(
    verification.tracks.flatMap((track) => track.events.map((event) => event.id)),
  );
  if (ids.size !== countEvents(verification)) return null;
  if (verification.links.some((link) => !ids.has(link.source) || !ids.has(link.target))) {
    return null;
  }
  return verification;
}

function applyOp(
  editor: Editor,
  blockId: string,
  op: (timeline: AsciiTimeline) => OpResult | null,
  verifyResult?: (timeline: AsciiTimeline) => boolean,
): TimelineCommandResult {
  // Resolve at dispatch time; captured ProseMirror positions become stale as
  // soon as content above the fence changes.
  const pos = findTimelineBlockPos(editor, blockId);
  if (pos === null) return NOT_APPLIED;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'codeBlock') return NOT_APPLIED;
  const timeline = parseTimelineForNode(node);
  if (!timeline) return NOT_APPLIED;
  if (!isTimelineSourceSafeForSemanticEdit(node.textContent, timeline)) return UNSAFE_SOURCE;

  const result = op(timeline);
  if (!result || result.timeline === timeline) return NOT_APPLIED;
  const rendered = renderAsciiTimeline(result.timeline);
  const verification = verifyRenderedTimeline(result.timeline, rendered);
  if (
    !verification ||
    (result.eventId && !hasEvent(verification, result.eventId)) ||
    (verifyResult && !verifyResult(verification))
  ) {
    return NOT_APPLIED;
  }

  // Promoting to the explicit language makes an edited timeline sticky over
  // Markdown <-> Tiptap round trips. Text + attrs change in one undo step.
  if (!replaceAsciiFenceText(editor, pos, rendered, 'timeline')) return NOT_APPLIED;
  return {
    applied: true,
    ...(result.eventId ? { eventId: result.eventId } : {}),
  };
}

/** Apply one semantic timeline command to a registered fence block. */
export function applyTimelineCommand(
  editor: Editor,
  blockId: string,
  command: TimelineCommand,
): TimelineCommandResult {
  // Commands may outlive the render that created their controls. Enforce the
  // editor's current authority at dispatch time, not only in widget props.
  if (!editor.isEditable) return READ_ONLY;

  switch (command.kind) {
    case 'addEvent':
      return applyOp(editor, blockId, (timeline) => {
        const result = addTimelineEventOp(timeline, command.trackId, command.position, {
          id: command.id,
          label: command.label,
          description: command.description,
          side: command.side,
          descriptionSide: command.descriptionSide,
          callout: command.callout,
          marker: command.marker,
        });
        return result;
      });
    case 'updateEvent':
      return applyOp(
        editor,
        blockId,
        (timeline) => ({
          timeline: updateTimelineEventOp(timeline, command.eventId, command.patch),
        }),
        (timeline) => hasEvent(timeline, command.eventId),
      );
    case 'removeEvent':
      return applyOp(
        editor,
        blockId,
        (timeline) => ({ timeline: removeTimelineEventOp(timeline, command.eventId) }),
        (timeline) => !hasEvent(timeline, command.eventId),
      );
  }
  const exhaustive: never = command;
  void exhaustive;
  return NOT_APPLIED;
}
