/**
 * Text sizing for layer export.
 *
 * The slideshow grows a slide's text to fill its boxes: BlockRenderer picks
 * ONE scale for the whole slide — the largest in [1, 2] at which every text
 * layer still fits its box and no text block newly overlaps another — and
 * applies it to every text layer (react `BlockRenderer` + `utils/textFit.ts`;
 * geometry-bound templates are skipped). It measures real glyphs. The
 * exporter has no DOM, so {@link estimateSlideTextScale} runs the same search
 * over estimated extents, mirroring how each renderer grows its text:
 *
 * - SVG text (no `html`, no icons) keeps the line breaks it was wrapped into
 *   at its base size, and the whole block scales about its alignment pivot.
 * - HTML text (rich `html`, or text carrying icon markers) reflows inside a
 *   fixed box at the larger font.
 *
 * {@link estimateFlowHeight} is also what the per-shape shrink in
 * `export.ts` measures, so a scale chosen here is not undone there.
 */

import type { Layer, TextLayer, TextParagraph, TextStyle } from '@bendyline/squisq/schemas';
import { resolveFontFamily } from '@bendyline/squisq/schemas';
import { hasIconMarker, splitIconMarkers } from '@bendyline/squisq/icon-marker';
import { resolvePositionValue } from './geometry.js';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
/** The player's grow ceiling and fit tolerance (react `largestFittingTextScale`, `FIT_TOLERANCE_PX`). */
const MAX_TEXT_SCALE = 2;
const FIT_TOLERANCE_PX = 1;

/** Rich-text block spacing, in em — the player's scoped stylesheet for HTML text. */
const PARAGRAPH_GAP_EM = 0.4;
const LIST_GAP_EM = 0.7;
/** The player's per-level list indent (`padding-left: 1.2em`), in em. */
export const LIST_INDENT_EM = 1.2;

const MONO_FONT = /\b(mono|monospace|courier|consolas|menlo|monaco)\b/;
const SERIF_FONT =
  /\b(serif|georgia|times|garamond|playfair|merriweather|lora|baskerville|cambria|palatino|didot|bodoni)\b/;

/**
 * Average advance per character, in em. Set a little above what the
 * player's own renders measure (system sans ≈ 0.44, Georgia Bold ≈ 0.53) so
 * text still fits when Office substitutes a wider face for the CSS stack.
 */
export function averageCharEm(style: TextStyle): number {
  const first = resolveFontFamily(style.fontFamily, 'sans-serif')
    .split(',')[0]!
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
  const base = MONO_FONT.test(first)
    ? 0.6
    : !first.includes('sans') && SERIF_FONT.test(first)
      ? 0.52
      : 0.48;
  return style.fontWeight === 'bold' ? base * 1.07 : base;
}

/**
 * Greedy word wrap at a character budget — the player's `wrapText`, which
 * also picks the SVG renderer's line breaks (at half an em per character).
 */
export function wrapByChars(text: string, charsPerLine: number): string[] {
  if (!text.trim()) return [''];
  if (charsPerLine <= 0) return [text];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= charsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    let remaining = word;
    while (remaining.length > charsPerLine) {
      lines.push(remaining.slice(0, charsPerLine));
      remaining = remaining.slice(charsPerLine);
    }
    current = remaining;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * Text as measured: an icon marker counts as one character — about the width
 * its glyph draws — rather than as its sentinel payload.
 */
export function measurableText(text: string): string {
  return splitIconMarkers(text)
    .map((run) => (run.type === 'text' ? run.text : 'M'))
    .join('');
}

/** Whether a renderer lays this text out as HTML (reflowing) rather than SVG text. */
export function isHtmlText(layer: TextLayer): boolean {
  return Boolean(layer.content.html?.trim()) || hasIconMarker(layer.content.text ?? '');
}

/** Whether blank lines are block gaps (rich HTML margins) rather than empty lines. */
export function hasBlockGaps(layer: TextLayer): boolean {
  return Boolean(layer.content.html?.trim());
}

/** A layer's text as paragraphs: its structured `paragraphs`, else one per line. */
export function layerParagraphs(layer: TextLayer): readonly TextParagraph[] {
  return (
    layer.content.paragraphs ?? (layer.content.text ?? '').split('\n').map((text) => ({ text }))
  );
}

/**
 * Extra space above each paragraph when blank-paragraph runs are block gaps:
 * the gap after the previous block (a paragraph's or a list's margin) plus a
 * full line for every blank beyond the first, as the player's rich text
 * renders authored extra blank lines. `null` marks a blank paragraph that
 * the gap above its successor absorbs.
 */
export function blockGapsEm(
  paragraphs: readonly TextParagraph[],
  lineHeight: number,
): Array<number | null> {
  let pending = 0;
  let previous: TextParagraph | undefined;
  return paragraphs.map((paragraph) => {
    if (!paragraph.text.trim() && !paragraph.list) {
      pending++;
      return null;
    }
    const gap =
      previous && pending > 0
        ? (previous.list ? LIST_GAP_EM : PARAGRAPH_GAP_EM) + (pending - 1) * lineHeight
        : 0;
    pending = 0;
    previous = paragraph;
    return gap;
  });
}

/**
 * Estimated height of text laid out in a box `widthPx` wide at the style's
 * font size, wrapping naturally (as HTML and PowerPoint both do). List items
 * wrap inside their indent; `blockGaps` spaces blocks by margins instead of
 * blank lines.
 */
export function estimateFlowHeight(
  paragraphs: readonly TextParagraph[],
  style: TextStyle,
  widthPx: number,
  blockGaps: boolean,
): number {
  const fontSize = style.fontSize;
  const lineHeight = style.lineHeight ?? 1.4;
  const advance = averageCharEm(style) * fontSize;
  const gaps = blockGaps ? blockGapsEm(paragraphs, lineHeight) : undefined;
  let height = 0;
  paragraphs.forEach((paragraph, index) => {
    const gap = gaps?.[index];
    if (gap === null) return;
    height += (gap ?? 0) * fontSize + (paragraph.spaceBefore ?? 0);
    const indent = paragraph.list ? LIST_INDENT_EM * fontSize * (paragraph.list.level + 1) : 0;
    const charsPerLine = Math.floor(Math.max(advance, widthPx - indent) / advance);
    const lines = measurableText(paragraph.text)
      .split('\n')
      .reduce((count, line) => count + wrapByChars(line, charsPerLine).length, 0);
    height += lines * lineHeight * fontSize;
  });
  return height;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface FitTarget {
  /** Whether the target's content fits its box at this scale. */
  fits(scale: number): boolean;
  /** The target's content rectangle at this scale. */
  rect(scale: number): Rect;
}

function anchorOffset(anchor: string, size: number, axis: 'x' | 'y'): number {
  if (anchor === 'center') return size / 2;
  if (axis === 'x') return anchor.includes('right') ? size : 0;
  return anchor.includes('bottom') ? size : 0;
}

/** The player's SVG text: base-size line breaks, scaled about the alignment pivot. */
function svgTarget(layer: TextLayer): FitTarget | null {
  const { position, content } = layer;
  const { style } = content;
  const anchor = position.anchor ?? 'top-left';
  const rawX = resolvePositionValue(position.x, CANVAS_WIDTH);
  const rawY = resolvePositionValue(position.y, CANVAS_HEIGHT);
  const boxWidth =
    position.width != null ? resolvePositionValue(position.width, CANVAS_WIDTH) : undefined;
  const boxHeight =
    position.height != null ? resolvePositionValue(position.height, CANVAS_HEIGHT) : undefined;

  const textAnchor =
    style.textAlign === 'center'
      ? 'middle'
      : style.textAlign === 'right'
        ? 'end'
        : style.textAlign === 'left'
          ? 'start'
          : anchor.includes('right')
            ? 'end'
            : anchor === 'center'
              ? 'middle'
              : 'start';
  const baseline =
    style.verticalAlign === 'top'
      ? 'before'
      : style.verticalAlign === 'middle'
        ? 'middle'
        : style.verticalAlign === 'bottom'
          ? 'after'
          : anchor.includes('bottom')
            ? 'after'
            : anchor === 'center'
              ? 'middle'
              : 'before';

  let x = rawX;
  if (boxWidth != null) {
    const left = rawX - anchorOffset(anchor, boxWidth, 'x');
    x =
      textAnchor === 'middle' ? left + boxWidth / 2 : textAnchor === 'end' ? left + boxWidth : left;
  }
  let y = rawY;
  if (boxHeight != null) {
    const top = rawY - anchorOffset(anchor, boxHeight, 'y');
    y = baseline === 'middle' ? top + boxHeight / 2 : baseline === 'after' ? top + boxHeight : top;
  }
  const fitWidth =
    boxWidth ??
    (textAnchor === 'middle'
      ? Math.max(0, Math.min(x, CANVAS_WIDTH - x) * 2)
      : textAnchor === 'end'
        ? Math.max(0, x)
        : Math.max(0, CANVAS_WIDTH - x));
  const fitHeight =
    boxHeight ??
    (baseline === 'middle'
      ? Math.max(0, Math.min(y, CANVAS_HEIGHT - y) * 2)
      : baseline === 'after'
        ? Math.max(0, y)
        : Math.max(0, CANVAS_HEIGHT - y));

  let lines = measurableText(content.text ?? '').split('\n');
  if (boxWidth != null) {
    const playerChars = Math.floor(boxWidth / (style.fontSize * 0.5));
    lines = lines.flatMap((line) => wrapByChars(line, playerChars));
  }
  if (style.maxLines && lines.length > style.maxLines) lines = lines.slice(0, style.maxLines);
  const longest = Math.max(...lines.map((line) => line.length));
  if (longest === 0) return null;
  const width = longest * averageCharEm(style) * style.fontSize;
  const height = lines.length * (style.lineHeight ?? 1.4) * style.fontSize;

  return {
    fits: (scale) =>
      width * scale <= fitWidth + FIT_TOLERANCE_PX &&
      height * scale <= fitHeight + FIT_TOLERANCE_PX,
    rect: (scale) => {
      const w = width * scale;
      const h = height * scale;
      const left = textAnchor === 'middle' ? x - w / 2 : textAnchor === 'end' ? x - w : x;
      const top = baseline === 'middle' ? y - h / 2 : baseline === 'after' ? y - h : y;
      return { left, top, right: left + w, bottom: top + h };
    },
  };
}

/** The player's HTML text: a fixed box whose content reflows at the larger font. */
function htmlTarget(layer: TextLayer): FitTarget | null {
  const { position, content } = layer;
  const { style } = content;
  const anchor = position.anchor ?? 'top-left';
  const lineHeight = style.lineHeight ?? 1.4;
  const padding = style.padding ?? 0;
  const border = style.borderColor && (style.borderWidth ?? 0) > 0 ? style.borderWidth! : 0;
  const rich = hasBlockGaps(layer);
  const boxWidth =
    position.width != null ? resolvePositionValue(position.width, CANVAS_WIDTH) : CANVAS_WIDTH;
  const plain = measurableText(content.text ?? '');
  const boxHeight =
    position.height != null
      ? resolvePositionValue(position.height, CANVAS_HEIGHT)
      : rich
        ? style.fontSize * lineHeight * 2
        : Math.max(
            1,
            plain
              .split('\n')
              .flatMap((line) => wrapByChars(line, Math.floor(boxWidth / (style.fontSize * 0.5))))
              .length,
          ) *
            style.fontSize *
            lineHeight +
          padding * 2;
  const inset = padding + border;
  const left = resolvePositionValue(position.x, CANVAS_WIDTH) - anchorOffset(anchor, boxWidth, 'x');
  const top =
    resolvePositionValue(position.y, CANVAS_HEIGHT) - anchorOffset(anchor, boxHeight, 'y');
  const availableWidth = Math.max(1, boxWidth - inset * 2);
  const availableHeight = Math.max(0, boxHeight - inset * 2);
  const paragraphs = layerParagraphs(layer);
  if (!paragraphs.some((paragraph) => paragraph.text.trim())) return null;
  const justify = rich
    ? (style.verticalAlign ?? 'top')
    : style.verticalAlign === 'top' || style.verticalAlign === 'bottom'
      ? style.verticalAlign
      : 'middle';
  const heightAt = (scale: number) =>
    estimateFlowHeight(
      paragraphs,
      { ...style, fontSize: style.fontSize * scale },
      availableWidth,
      rich,
    );

  return {
    fits: (scale) => heightAt(scale) <= availableHeight + FIT_TOLERANCE_PX,
    rect: (scale) => {
      const h = heightAt(scale);
      const contentTop =
        justify === 'middle'
          ? top + (boxHeight - h) / 2
          : justify === 'bottom'
            ? top + boxHeight - inset - h
            : top + inset;
      return {
        left: left + inset,
        top: contentTop,
        right: left + inset + availableWidth,
        bottom: contentTop + h,
      };
    },
  };
}

function overlapPairs(rects: readonly Rect[]): Set<string> {
  const pairs = new Set<string>();
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) {
      const one = rects[a]!;
      const two = rects[b]!;
      if (
        one.left < two.right - FIT_TOLERANCE_PX &&
        one.right > two.left + FIT_TOLERANCE_PX &&
        one.top < two.bottom - FIT_TOLERANCE_PX &&
        one.bottom > two.top + FIT_TOLERANCE_PX
      ) {
        pairs.add(`${a}:${b}`);
      }
    }
  }
  return pairs;
}

/**
 * The slideshow's shared text scale for a slide's layers, estimated: the
 * largest scale in [1, 2] at which every text layer fits and no two text
 * blocks overlap that did not already — the player's binary search, run
 * over estimated extents. Returns 1 when even the base size does not fit.
 */
export function estimateSlideTextScale(layers: readonly Layer[]): number {
  const targets = layers
    .filter((layer): layer is TextLayer => layer.type === 'text')
    .map((layer) => (isHtmlText(layer) ? htmlTarget(layer) : svgTarget(layer)))
    .filter((target): target is FitTarget => target !== null);
  if (targets.length === 0) return 1;

  const baseline = overlapPairs(targets.map((target) => target.rect(1)));
  const fits = (scale: number): boolean => {
    if (!targets.every((target) => target.fits(scale))) return false;
    for (const pair of overlapPairs(targets.map((target) => target.rect(scale)))) {
      if (!baseline.has(pair)) return false;
    }
    return true;
  };

  if (!fits(1)) return 1;
  if (fits(MAX_TEXT_SCALE)) return MAX_TEXT_SCALE;
  let low = 1;
  let high = MAX_TEXT_SCALE;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = (low + high) / 2;
    if (fits(candidate)) low = candidate;
    else high = candidate;
  }
  return Math.max(1, Math.floor(low * 100) / 100);
}
