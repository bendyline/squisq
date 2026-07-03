/**
 * blockProperties
 *
 * Generic read/write of a single block-meta key on a heading's Pandoc `{…}`
 * attribute block (stored as the `dataBlockAttrs` inner string in the WYSIWYG
 * heading node — no braces, matching `tiptapBridge`).
 *
 * The transition family (which spans three coupled keys) has its own helpers
 * in `headingTransition.ts`; this module covers the standalone scalar keys the
 * block-properties palette edits — `duration`, `startTime`, `x`, `y`, … — all
 * of which are plain `key=value` params. Parse/serialize is delegated to the
 * shared core helpers so quoting and ordering match the parser exactly.
 */

import {
  parsePandocAttrTokens,
  serializePandocAttributes,
  parseTimeSeconds,
  type HeadingAttributes,
} from '@bendyline/squisq/markdown';
import { normalizeTransitionType } from '@bendyline/squisq/schemas';
import { readBlockAttrsTransition } from './headingTransition';
import { transitionLabel } from './transitionCatalog';

/** Parse a `dataBlockAttrs` inner string into its flat `key → value` map. */
export function readBlockAttrsParams(inner: string | null | undefined): Record<string, string> {
  return inner ? (parsePandocAttrTokens(inner).params ?? {}) : {};
}

/** Read a single block-meta param, or '' when unset. */
export function readBlockAttrsValue(inner: string | null | undefined, key: string): string {
  return readBlockAttrsParams(inner)[key] ?? '';
}

/**
 * Set (or, when `value` is empty, remove) a single param in a `dataBlockAttrs`
 * inner string. Returns the new inner (no braces), or null when the block is
 * left with no attributes at all — matching how `tiptapBridge` stores an
 * absent attribute (null, not `{}`).
 */
export function setBlockAttrsValue(
  inner: string | null | undefined,
  key: string,
  value: string,
): string | null {
  const attrs: HeadingAttributes = inner ? parsePandocAttrTokens(inner) : {};
  const params: Record<string, string> = { ...(attrs.params ?? {}) };
  const trimmed = value.trim();
  if (trimmed === '') delete params[key];
  else params[key] = trimmed;
  attrs.params = params;
  const raw = serializePandocAttributes(attrs);
  return raw == null || raw === '{}' ? null : raw.slice(1, -1);
}

/**
 * A concise, human-readable summary of a block's authored properties for the
 * on-canvas badge — e.g. `Doors · 1:30 start · 3:20 long`. Returns '' when no
 * properties are set (the badge then shows just its icon). Reads transition
 * from both the Pandoc block and the `{[…]}` params; timing from the block.
 */
export function summarizeBlockProps(
  blockAttrs: string | null | undefined,
  templateParams: string | null | undefined,
): string {
  const parts: string[] = [];

  const transition = readBlockAttrsTransition(blockAttrs, templateParams);
  if (transition.type) {
    parts.push(transitionLabel(normalizeTransitionType(transition.type) ?? transition.type));
  }

  const params = readBlockAttrsParams(blockAttrs);
  if (params.startTime) parts.push(`${formatClock(params.startTime)} start`);
  if (params.duration) parts.push(`${formatClock(params.duration)} long`);

  return parts.join(' · ');
}

/** Format a raw time value (`90`, `1:30`, `1500ms`) as `m:ss`, or pass through. */
function formatClock(raw: string): string {
  const seconds = parseTimeSeconds(raw);
  if (seconds == null) return raw;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
