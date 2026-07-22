/**
 * timelineSource
 *
 * Line-level markdown rewrites for the timeline editor: set a block's
 * `duration` on its heading's Pandoc attribute block, and patch a media
 * clip's `startAt` / `clipStart` / `clipEnd` / `spillover` on its `{[audio …]}`
 * / `{[video …]}` annotation line. Both preserve everything else on the line
 * (template annotations, ids, classes, other params) by reusing the shared
 * tokenizers rather than regex-replacing values.
 */

import {
  matchTrailingPandocAttr,
  matchTrailingTemplateAnnotation,
  parsePandocAttrTokens,
  serializePandocAttributes,
  tokenizeAttrTokens,
  splitKeyValueToken,
  quoteAttrValue,
} from '@bendyline/squisq/markdown';
import type {
  VideoPipPosition,
  VideoPipShape,
  VideoPipSize,
  VideoPlacement,
} from '@bendyline/squisq/schemas';
import { setHeadingLineTransition, type TransitionFields } from './headingTransition';

/** Format a seconds value compactly: integers bare, else up to 2 decimals. */
export function formatSeconds(seconds: number): string {
  const clamped = Math.max(0, seconds);
  if (Number.isInteger(clamped)) return String(clamped);
  return String(Math.round(clamped * 100) / 100);
}

/**
 * Set/insert a `duration` on the heading at 1-based `line`, written in the
 * squisq-native squiggly form — `{[duration=<seconds>]}` on its own, or
 * folded into an existing `{[template …]}` annotation. Preserves any `{#id}`,
 * classes, and other Pandoc params, and migrates a legacy Pandoc
 * `{duration=…}` to the squiggly form (dropping the stale Pandoc key so the
 * two can't disagree). Returns the new full source, or null when the line
 * isn't an ATX heading.
 */
export function setBlockDurationInSource(
  source: string,
  line: number,
  seconds: number | null,
): string | null {
  return setBlockTimeInSource(source, line, 'duration', seconds);
}

/** Set or clear a block's explicit start time on its source heading. */
export function setBlockStartTimeInSource(
  source: string,
  line: number,
  seconds: number | null,
): string | null {
  return setBlockTimeInSource(source, line, 'startTime', seconds);
}

function setBlockTimeInSource(
  source: string,
  line: number,
  key: 'duration' | 'startTime',
  seconds: number | null,
): string | null {
  const lines = source.split('\n');
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const original = lines[idx];
  if (!/^#{1,6}\s/.test(original)) return null;

  const value = seconds == null ? null : formatSeconds(seconds);

  // Peel the trailing `{[…]}` annotation (if any) off the line; we'll fold
  // `duration` into it. Canonical heading order is `{#pandoc} {[squiggly]}`,
  // so the squiggly annotation is the last `{…}` on the line.
  let rest = original;
  let annotationInner: string | null = null;
  const tpl = matchTrailingTemplateAnnotation(rest);
  if (tpl) {
    annotationInner = tpl.inner.trim();
    rest = rest.slice(0, tpl.index).replace(/\s+$/, '');
  }

  // Then peel a trailing Pandoc `{…}` block; drop its `duration` so a legacy
  // value can't shadow the squiggly one we're writing. Keep the rest (id,
  // classes, other params).
  let pandocSerialized: string | null = null;
  const pa = matchTrailingPandocAttr(rest);
  if (pa) {
    const attrs = parsePandocAttrTokens(pa.inner.trim());
    if (attrs.params) {
      delete attrs.params[key];
      if (Object.keys(attrs.params).length === 0) delete attrs.params;
    }
    const serialized = serializePandocAttributes(attrs);
    pandocSerialized = serialized && serialized !== '{}' ? serialized : null;
    rest = rest.slice(0, pa.index).replace(/\s+$/, '');
  }

  const annotation = setTemplateParam(annotationInner, key, value);
  const parts = [rest];
  if (pandocSerialized) parts.push(pandocSerialized);
  if (annotation) parts.push(annotation);
  lines[idx] = parts.join(' ');
  return lines.join('\n');
}

/** Rewrite a block transition on its source heading. */
export function setBlockTransitionInSource(
  source: string,
  line: number,
  transition: TransitionFields,
): string | null {
  const lines = source.split('\n');
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length || !/^#{1,6}\s/.test(lines[idx])) return null;
  lines[idx] = setHeadingLineTransition(lines[idx], transition);
  return lines.join('\n');
}

/**
 * Build a `{[…]}` annotation from an existing inner string (or null for a
 * fresh one), setting `key=value` and preserving the template name plus any
 * other params in their original order.
 */
function setTemplateParam(inner: string | null, key: string, value: string | null): string | null {
  const tokens = inner ? tokenizeAttrTokens(inner) : [];
  const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
  const template = firstIsParam || tokens.length === 0 ? undefined : tokens[0];

  const params: Record<string, string> = {};
  const order: string[] = [];
  for (let i = template ? 1 : 0; i < tokens.length; i++) {
    const kv = splitKeyValueToken(tokens[i]);
    if (kv) {
      if (!(kv.key in params)) order.push(kv.key);
      params[kv.key] = kv.value;
    }
  }
  if (value === null) {
    delete params[key];
    const index = order.indexOf(key);
    if (index >= 0) order.splice(index, 1);
  } else {
    if (!(key in params)) order.push(key);
    params[key] = value;
  }

  const parts = template ? [template] : [];
  for (const k of order) parts.push(`${k}=${quoteAttrValue(params[k])}`);
  return parts.length > 0 ? `{[${parts.join(' ')}]}` : null;
}

/** A patch to a media clip; numeric values are seconds, `null` removes the key. */
export interface MediaClipPatch {
  startAt?: number | null;
  clipStart?: number | null;
  clipEnd?: number | null;
  spillover?: boolean | null;
  placement?: VideoPlacement | null;
  lockToBlock?: boolean | null;
  pipSize?: VideoPipSize | null;
  pipShape?: VideoPipShape | null;
  pipPosition?: VideoPipPosition | null;
}

function setHtmlAttribute(openingTag: string, name: string, value: string | null): string {
  const attr = new RegExp(`\\s+${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'i');
  if (value === null) return openingTag.replace(attr, '');
  if (attr.test(openingTag)) return openingTag.replace(attr, ` ${name}="${value}"`);
  return openingTag.replace(/\s*\/?>(?=$)/, (end) => ` ${name}="${value}"${end.trimStart()}`);
}

/** Patch timeline timing data on a toolbar-authored standalone HTML video. */
function setHtmlVideoClipInLine(original: string, patch: MediaClipPatch): string | null {
  if (!/^\s*<video\b/i.test(original)) return null;
  const opening = /<video\b[^>]*>/i.exec(original);
  if (!opening) return null;
  let next = opening[0];
  if (patch.startAt !== undefined) {
    next = setHtmlAttribute(
      next,
      'data-squisq-video-start-at',
      patch.startAt == null ? null : formatSeconds(patch.startAt),
    );
  }
  if (patch.clipStart !== undefined) {
    next = setHtmlAttribute(
      next,
      'data-squisq-video-clip-start',
      patch.clipStart == null ? null : formatSeconds(patch.clipStart),
    );
  }
  if (patch.clipEnd !== undefined) {
    next = setHtmlAttribute(
      next,
      'data-squisq-video-clip-end',
      patch.clipEnd == null ? null : formatSeconds(patch.clipEnd),
    );
  }
  if (patch.placement !== undefined) {
    next = setHtmlAttribute(
      next,
      'data-squisq-video-placement',
      patch.placement == null || patch.placement === 'content' ? null : patch.placement,
    );
  }
  if (patch.lockToBlock !== undefined) {
    next = setHtmlAttribute(
      next,
      'data-squisq-video-lock-to-block',
      patch.lockToBlock == null || patch.lockToBlock ? null : 'false',
    );
  }
  if (patch.pipSize !== undefined) {
    next = setHtmlAttribute(next, 'data-squisq-video-pip-size', patch.pipSize);
  }
  if (patch.pipShape !== undefined) {
    next = setHtmlAttribute(next, 'data-squisq-video-pip-shape', patch.pipShape);
  }
  if (patch.pipPosition !== undefined) {
    next = setHtmlAttribute(next, 'data-squisq-video-pip-position', patch.pipPosition);
  }
  return `${original.slice(0, opening.index)}${next}${original.slice(opening.index + opening[0].length)}`;
}

/**
 * Patch the `{[audio …]}` / `{[video …]}` annotation at 1-based `line`.
 * Preserves the template name and any params not in the patch. Returns the
 * new full source, or null when the line isn't a media annotation.
 */
export function setMediaClipInSource(
  source: string,
  line: number,
  patch: MediaClipPatch,
): string | null {
  const lines = source.split('\n');
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const original = lines[idx];
  const htmlVideo = setHtmlVideoClipInLine(original, patch);
  if (htmlVideo != null) {
    lines[idx] = htmlVideo;
    return lines.join('\n');
  }
  const m = matchTrailingTemplateAnnotation(original);
  if (!m) return null;

  const tokens = tokenizeAttrTokens(m.inner.trim());
  const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
  const template = firstIsParam || tokens.length === 0 ? undefined : tokens[0];
  if (!template || !['audio', 'video', 'media'].includes(template)) return null;

  const params: Record<string, string> = {};
  const order: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const kv = splitKeyValueToken(tokens[i]);
    if (kv) {
      if (!(kv.key in params)) order.push(kv.key);
      params[kv.key] = kv.value;
    }
  }

  const apply = (key: string, value: string | null) => {
    if (value === null) {
      delete params[key];
      const i = order.indexOf(key);
      if (i >= 0) order.splice(i, 1);
    } else {
      if (!(key in params)) order.push(key);
      params[key] = value;
    }
  };
  if (patch.startAt !== undefined)
    apply('startAt', patch.startAt == null ? null : formatSeconds(patch.startAt));
  if (patch.clipStart !== undefined)
    apply('clipStart', patch.clipStart == null ? null : formatSeconds(patch.clipStart));
  if (patch.clipEnd !== undefined)
    apply('clipEnd', patch.clipEnd == null ? null : formatSeconds(patch.clipEnd));
  if (patch.spillover !== undefined) apply('spillover', patch.spillover ? 'true' : null);
  if (patch.placement !== undefined) {
    // Normalize all placement aliases onto the canonical key. Clearing must
    // also clear aliases or `pip=true` would silently keep winning on parse.
    apply('presentation', null);
    apply('pip', null);
    apply('overlay', null);
    apply('placement', patch.placement);
  }
  if (patch.lockToBlock !== undefined) {
    apply('lockToBlock', patch.lockToBlock == null ? null : patch.lockToBlock ? 'true' : 'false');
  }
  if (patch.pipSize !== undefined) apply('pipSize', patch.pipSize);
  if (patch.pipShape !== undefined) apply('pipShape', patch.pipShape);
  if (patch.pipPosition !== undefined) apply('pipPosition', patch.pipPosition);

  const parts = [template, ...order.map((k) => `${k}=${quoteAttrValue(params[k])}`)];
  const annotation = `{[${parts.join(' ')}]}`;
  const prefix = original.slice(0, m.index).replace(/\s+$/, '');
  lines[idx] = prefix ? `${prefix} ${annotation}` : annotation;
  return lines.join('\n');
}

/** A timed media clip's identity for (re)writing its annotation. */
export interface ClipSpec {
  kind: 'audio' | 'video';
  src: string;
  clipStart?: number;
  clipEnd?: number;
  spillover?: boolean;
  placement?: Exclude<VideoPlacement, 'content'>;
  lockToBlock?: boolean;
  pipSize?: VideoPipSize;
  pipShape?: VideoPipShape;
  pipPosition?: VideoPipPosition;
}

/** Build a `{[audio|video src=… startAt=… clipEnd=…]}` annotation string. */
export function buildClipAnnotation(spec: ClipSpec, startAt: number): string {
  const parts: string[] = [spec.kind, `src=${quoteAttrValue(spec.src)}`];
  if (spec.placement) parts.push(`placement=${spec.placement}`);
  if (spec.lockToBlock != null) parts.push(`lockToBlock=${spec.lockToBlock}`);
  if (spec.pipSize) parts.push(`pipSize=${spec.pipSize}`);
  if (spec.pipShape) parts.push(`pipShape=${spec.pipShape}`);
  if (spec.pipPosition) parts.push(`pipPosition=${spec.pipPosition}`);
  if (startAt > 0) parts.push(`startAt=${formatSeconds(startAt)}`);
  if (spec.clipStart != null && spec.clipStart > 0) {
    parts.push(`clipStart=${formatSeconds(spec.clipStart)}`);
  }
  if (spec.clipEnd != null) parts.push(`clipEnd=${formatSeconds(spec.clipEnd)}`);
  if (spec.spillover) parts.push('spillover=true');
  return `{[${parts.join(' ')}]}`;
}

/** Index of the heading line at/above `idx` (−1 for the preamble). */
function headingIndexAbove(lines: string[], idx: number): number {
  for (let i = Math.min(idx, lines.length - 1); i >= 0; i--) {
    if (/^#{1,6}\s/.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Place a timed clip into the block whose heading is at 1-based
 * `targetHeadingLine`, written as a `{[…]}` annotation. The clip's current
 * authoring line at 1-based `fromLine` (a media embed or an existing
 * annotation) is removed; when the target is the same block the line is
 * rewritten in place. Returns the new source, or null on bad input.
 *
 * This is what lets a clip be dragged from one block into another on the
 * timeline: its representation relocates to the target block's body.
 */
export function placeClipInBlock(
  source: string,
  fromLine: number,
  targetHeadingLine: number,
  spec: ClipSpec,
  startAt: number,
): string | null {
  const lines = source.split('\n');
  const fromIdx = fromLine - 1;
  if (fromIdx < 0 || fromIdx >= lines.length) return null;
  const targetIdx0 = targetHeadingLine - 1;
  if (targetIdx0 < 0 || targetIdx0 >= lines.length) return null;

  const annotation = buildClipAnnotation(spec, Math.max(0, startAt));

  // Same block → rewrite the line in place (preserves position).
  if (headingIndexAbove(lines, fromIdx) === targetIdx0) {
    lines[fromIdx] = annotation;
    return lines.join('\n');
  }

  // Cross-block → remove the source line and insert into the target block,
  // right after its heading on its own paragraph.
  lines.splice(fromIdx, 1);
  let targetIdx = targetIdx0;
  if (fromIdx < targetIdx) targetIdx -= 1;
  lines.splice(targetIdx + 1, 0, '', annotation);
  return lines.join('\n');
}
