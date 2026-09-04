/** Conservative detection for authored ASCII timeline fences. */

import type { MarkdownCodeBlock } from '../../markdown/types.js';
import { parseAsciiDiagramWithStats } from '../asciiDiagram/parse.js';
import { parseAsciiTimelineWithStats } from './parse.js';
import type { AsciiTimelineDetection } from './types.js';

export const ASCII_TIMELINE_FENCE_LANGS: ReadonlySet<string> = new Set([
  'text',
  'txt',
  'plaintext',
  'plain',
  'ascii',
  'timeline',
]);

const MAX_LINES = 400;
const MAX_CANONICAL_LINES = 2000;
const MAX_COLS = 400;
const MAX_EXPLICIT_COLS = 4096;
const BOX_TOP_EDGE_RE = /[┌┏╔╭].*[┐┓╗╮]/u;
const CANONICAL_TRACK_RE = /\{#[^{}\s]+ start=[^{}\s]+ end=[^{}\s]+\}:\s/u;

export function isEligibleAsciiTimelineFenceLang(lang: string | null | undefined): boolean {
  if (lang === null || lang === undefined) return true;
  const normalized = lang.trim().toLowerCase();
  return normalized === '' || ASCII_TIMELINE_FENCE_LANGS.has(normalized);
}

export function isExplicitTimelineLang(lang: string | null | undefined): boolean {
  return typeof lang === 'string' && lang.trim().toLowerCase() === 'timeline';
}

export interface DetectAsciiTimelineOptions {
  /** Explicit `timeline` language: allow one-point/ASCII-marker tracks. */
  explicit?: boolean;
}

export function detectAsciiTimeline(
  text: string,
  options: DetectAsciiTimelineOptions = {},
): AsciiTimelineDetection {
  const explicit = options.explicit === true;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const canonicalTrackRows = lines.filter((line) => CANONICAL_TRACK_RE.test(line)).length;
  const canonicalLineBudget = Math.min(
    MAX_CANONICAL_LINES,
    canonicalTrackRows * 6 +
      lines.filter((line) => /^\s*(?:branch|link)\s*:/iu.test(line)).length +
      2,
  );
  if (
    lines.length > MAX_LINES &&
    (canonicalTrackRows === 0 || lines.length > canonicalLineBudget)
  ) {
    return { isTimeline: false, reasons: [`too-many-lines(${lines.length})`] };
  }
  const maxCols = Math.max(0, ...lines.map((line) => Array.from(line).length));
  // Canonical renderer output carries bounded track metadata on every long
  // row. Permit that high-confidence form up to the explicit-fence cap while
  // retaining the conservative 400-column limit for arbitrary untagged art.
  const canonicalLongForm =
    canonicalTrackRows > 0 &&
    lines.every((line) => Array.from(line).length <= MAX_COLS || CANONICAL_TRACK_RE.test(line));
  const maxAllowedCols = explicit || canonicalLongForm ? MAX_EXPLICIT_COLS : MAX_COLS;
  if (maxCols > maxAllowedCols) {
    return { isTimeline: false, reasons: [`too-wide(${maxCols})`] };
  }

  const nonBlank = lines.filter((line) => line.trim().length > 0);
  const pipeRows = nonBlank.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
  const hasGfmSeparator = nonBlank.some(
    (line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-'),
  );
  if (pipeRows > nonBlank.length / 2 && hasGfmSeparator) {
    return { isTimeline: false, reasons: ['markdown-table'] };
  }

  if (!explicit && lines.some((line) => BOX_TOP_EDGE_RE.test(line))) {
    return { isTimeline: false, reasons: ['has-box-corners'] };
  }

  // Closed boxes own the art even if their borders happen to contain dots.
  // Untagged detection rejects even one box; the diagram auto-template needs
  // two, but silently turning a single boxed callout into a timeline is worse
  // than leaving it as authored code. An explicit timeline may use one boxed
  // callout, while two or more still belong to the diagram codec.
  // Counted as BOXES, never as diagram nodes: the diagram parser also
  // recovers bare rail labels, and a timeline's callouts read as those.
  const boxes = parseAsciiDiagramWithStats(text).stats.boxNodes;
  if (boxes >= (explicit ? 2 : 1)) {
    return { isTimeline: false, reasons: [`has-boxes(${boxes})`] };
  }

  // A tree item may itself contain a marker rail in its label. Connector
  // prefixes (`├── ●──●`, `|-- ●--●`) identify the outer structure as a
  // tree, so conservative untagged detection must not claim that row.
  if (!explicit && /^[ \t]*(?:[│|][ \t]*)*[├└+|`][─━═-]{1,4}[ \t]+[●○◉◆◇•]/mu.test(text)) {
    return { isTimeline: false, reasons: ['tree-connector-prefix'] };
  }

  const { timeline, stats } = parseAsciiTimelineWithStats(text);
  if (stats.wrappedFlow) {
    return {
      isTimeline: true,
      timeline,
      reasons: [`tracks(${stats.axisLines})`, `events(${stats.markerCount})`, 'wrapped-flow'],
    };
  }
  if (stats.axisLines === 0) return { isTimeline: false, reasons: ['no-axis-lines'] };
  const explicitCadence = explicit && stats.horizontalChars === 0 && stats.markerCount >= 4;
  if (!explicitCadence && stats.horizontalChars < (explicit ? 2 : 8)) {
    return { isTimeline: false, reasons: [`too-few-horizontal(${stats.horizontalChars})`] };
  }
  if (stats.markerCount < (explicit ? 1 : 2)) {
    return { isTimeline: false, reasons: [`too-few-markers(${stats.markerCount})`] };
  }
  // Untagged auto-detection requires unmistakable Unicode point markers.
  // `foo * bar *` or `o---o` in real code therefore stays ordinary code.
  if (!explicit && stats.strongMarkerCount < 2) {
    return { isTimeline: false, reasons: [`too-few-strong-markers(${stats.strongMarkerCount})`] };
  }

  return {
    isTimeline: true,
    timeline,
    reasons: [
      `tracks(${stats.axisLines})`,
      `events(${stats.markerCount + stats.pointerCount})`,
      explicit ? 'explicit' : 'strong-markers',
    ],
  };
}

export function isAsciiTimelineFence(node: MarkdownCodeBlock): boolean {
  if (node.type !== 'code') return false;
  if (!isEligibleAsciiTimelineFenceLang(node.lang)) return false;
  return detectAsciiTimeline(node.value, { explicit: isExplicitTimelineLang(node.lang) })
    .isTimeline;
}
