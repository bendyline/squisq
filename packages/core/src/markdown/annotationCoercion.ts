/**
 * Heading-attribute value coercion.
 *
 * The Pandoc-style heading attribute block `{#id .class key=value}` parses
 * to a flat `Record<string, string>` of `key → raw value`. This module
 * coerces a known subset of keys to typed values (numbers, time-in-seconds,
 * `BlockConnection[]`) so downstream consumers don't have to re-parse them.
 *
 * Unknown keys are returned in `metadata` as raw strings. Malformed known-key
 * values are dropped from the typed result and reported via `warnings` (the
 * raw string is preserved in `params` upstream for lossless round-tripping —
 * coercion failures do not corrupt the source).
 */

import type { BlockConnection } from './types.js';
import type { TransitionDirection, TransitionType } from '../schemas/Transitions.js';
import {
  normalizeTransitionDirection,
  normalizeTransitionType,
  TRANSITION_TYPES,
  TRANSITION_DIRECTIONS,
} from '../schemas/Transitions.js';

/**
 * Registry of known block-meta keys and their coercion strategies.
 *
 * Adding a new typed key: add an entry here, add the typed field to
 * `HeadingAttributes.blockMeta` in `types.ts`, and apply the coerced value
 * in `markdownToDoc.ts`.
 */
export const KNOWN_BLOCK_META_KEYS = {
  x: 'number',
  y: 'number',
  startTime: 'time',
  duration: 'time',
  connectsTo: 'connectionList',
  transition: 'transition',
  transitionDuration: 'time',
  transitionDirection: 'transitionDirection',
} as const;

export type KnownBlockMetaKey = keyof typeof KNOWN_BLOCK_META_KEYS;

/**
 * Editor-facing description of a known block-meta key: what it does, and
 * either its closed set of valid values or a free-form format hint. This is
 * the single source the markdown editor's `{[name key=value]}` attribute
 * autocomplete reads from, so the suggestion list stays in lockstep with
 * `KNOWN_BLOCK_META_KEYS` and the transition vocabulary rather than drifting
 * in a hand-maintained copy. `values`/`valueHint` are mutually exclusive: a
 * key has a closed enum (`values`) or a format hint (`valueHint`), not both.
 */
export interface BlockMetaKeyDescriptor {
  key: KnownBlockMetaKey;
  /** One-line description, shown as the completion item's detail. */
  description: string;
  /** Closed set of valid values, for keys backed by an enum. */
  values?: readonly string[];
  /** Format hint shown when the value is free-form (no closed set). */
  valueHint?: string;
}

/**
 * Ordered descriptors for every key in `KNOWN_BLOCK_META_KEYS`. Order is the
 * suggestion display order: the transition family first (the most common
 * authoring case), then timeline timing, then diagram geometry/links.
 */
export const BLOCK_META_KEY_DESCRIPTORS: readonly BlockMetaKeyDescriptor[] = [
  {
    key: 'transition',
    description: 'Block-to-block transition effect',
    values: TRANSITION_TYPES,
  },
  {
    key: 'transitionDuration',
    description: 'How long the transition lasts',
    valueHint: 'seconds — e.g. 0.7, 700ms',
  },
  {
    key: 'transitionDirection',
    description: 'Directional variant for the transition',
    values: TRANSITION_DIRECTIONS,
  },
  {
    key: 'startTime',
    description: 'Timeline start time of this block',
    valueHint: 'mm:ss or seconds — e.g. 01:30, 5, 1500ms',
  },
  {
    key: 'duration',
    description: 'How long this block lasts',
    valueHint: 'mm:ss or seconds — e.g. 45, 1500ms',
  },
  {
    key: 'x',
    description: 'Horizontal position on the diagram canvas',
    valueHint: 'number — e.g. 600',
  },
  {
    key: 'y',
    description: 'Vertical position on the diagram canvas',
    valueHint: 'number — e.g. 300',
  },
  {
    key: 'connectsTo',
    description: 'Diagram connections to other blocks',
    valueHint: 'comma-separated target or target:type — e.g. foo,bar:flow',
  },
];

/**
 * The shape of the typed values produced by coercion. Mirrors
 * `HeadingAttributes.blockMeta` in `types.ts`.
 */
export interface CoercedBlockMeta {
  x?: number;
  y?: number;
  startTime?: number;
  duration?: number;
  connectsTo?: BlockConnection[];
  transition?: {
    type: TransitionType;
    duration?: number;
    direction?: TransitionDirection;
  };
}

export interface CoerceResult {
  /** Typed values for known keys whose coercion succeeded. */
  blockMeta: CoercedBlockMeta;
  /** Raw string values for keys not in the known-key registry. */
  metadata: Record<string, string>;
  /** Human-readable diagnostics — currently emitted for coercion failures. */
  warnings: string[];
}

/**
 * Coerce a flat `key → raw string` map into typed block-meta + an
 * untyped metadata bag, per the `KNOWN_BLOCK_META_KEYS` registry.
 */
export function coerceAnnotationValues(params: Record<string, string>): CoerceResult {
  const blockMeta: CoercedBlockMeta = {};
  const metadata: Record<string, string> = {};
  const warnings: string[] = [];
  let transitionType: TransitionType | null = null;
  let transitionDuration: number | undefined;
  let transitionDirection: TransitionDirection | undefined;

  for (const [key, raw] of Object.entries(params)) {
    const kind = (KNOWN_BLOCK_META_KEYS as Record<string, string>)[key];
    if (!kind) {
      metadata[key] = raw;
      continue;
    }
    if (kind === 'number') {
      const n = parseNumber(raw);
      if (n == null) {
        warnings.push(`Invalid number for "${key}": ${JSON.stringify(raw)}`);
      } else {
        (blockMeta as Record<string, unknown>)[key] = n;
      }
    } else if (kind === 'time') {
      const s = parseTimeSeconds(raw);
      if (s == null) {
        warnings.push(`Invalid time for "${key}": ${JSON.stringify(raw)}`);
      } else if (key === 'transitionDuration') {
        transitionDuration = s;
      } else {
        (blockMeta as Record<string, unknown>)[key] = s;
      }
    } else if (kind === 'connectionList') {
      const { list, warning } = parseConnectionList(raw);
      if (warning) warnings.push(`"${key}": ${warning}`);
      blockMeta.connectsTo = list;
    } else if (kind === 'transition') {
      const transition = normalizeTransitionType(raw);
      if (transition == null) {
        warnings.push(`Invalid transition for "${key}": ${JSON.stringify(raw)}`);
      } else {
        transitionType = transition;
      }
    } else if (kind === 'transitionDirection') {
      const direction = normalizeTransitionDirection(raw);
      if (direction == null) {
        warnings.push(`Invalid transition direction for "${key}": ${JSON.stringify(raw)}`);
      } else {
        transitionDirection = direction;
      }
    }
  }

  if (transitionType) {
    blockMeta.transition = {
      type: transitionType,
      ...(transitionDuration !== undefined ? { duration: transitionDuration } : {}),
      ...(transitionDirection !== undefined ? { direction: transitionDirection } : {}),
    };
  }

  return { blockMeta, metadata, warnings };
}

// ============================================
// Coercers
// ============================================

/** Parse a finite number from a string. Returns null on failure. */
function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const TIME_BARE_RE = /^\d+(?:\.\d+)?$/;
const TIME_MS_RE = /^(\d+(?:\.\d+)?)ms$/;
const TIME_MMSS_RE = /^(\d+):(\d{1,2})(?:\.(\d+))?$/;

/**
 * Parse a time value to seconds. Accepts:
 * - bare number: `5` → 5, `5.5` → 5.5
 * - `mm:ss`: `01:30` → 90
 * - `mm:ss.ms`: `01:30.500` → 90.5
 * - `1500ms` → 1.5
 *
 * Returns null on malformed input.
 */
export function parseTimeSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (TIME_BARE_RE.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  const msMatch = trimmed.match(TIME_MS_RE);
  if (msMatch) {
    const n = Number(msMatch[1]);
    return Number.isFinite(n) ? n / 1000 : null;
  }

  const mmssMatch = trimmed.match(TIME_MMSS_RE);
  if (mmssMatch) {
    const mins = Number(mmssMatch[1]);
    const secs = Number(mmssMatch[2]);
    const frac = mmssMatch[3] ? Number(`0.${mmssMatch[3]}`) : 0;
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || !Number.isFinite(frac)) {
      return null;
    }
    if (secs >= 60) return null;
    return mins * 60 + secs + frac;
  }

  return null;
}

/**
 * Parse a comma-separated connection list. Each entry is `target` or
 * `target:type`. Empty entries (`a,,b`) are filtered with a warning; an
 * entirely empty input yields an empty list with no warning.
 */
export function parseConnectionList(raw: string): {
  list: BlockConnection[];
  warning: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { list: [], warning: null };

  const list: BlockConnection[] = [];
  let droppedEmpty = false;
  for (const part of trimmed.split(',')) {
    const entry = part.trim();
    if (!entry) {
      droppedEmpty = true;
      continue;
    }
    const colonIdx = entry.indexOf(':');
    if (colonIdx < 0) {
      list.push({ target: entry });
    } else {
      const target = entry.slice(0, colonIdx).trim();
      const type = entry.slice(colonIdx + 1).trim();
      if (!target) {
        droppedEmpty = true;
        continue;
      }
      list.push(type ? { target, type } : { target });
    }
  }

  return {
    list,
    warning: droppedEmpty ? 'dropped empty connection entries' : null,
  };
}
