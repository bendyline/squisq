/**
 * Doc-level proofing settings, persisted in frontmatter — the proofing
 * analog of `coverSlideSettings`. Three keys:
 *
 *   - `squisq-proofing`         — per-doc enable override (boolean)
 *   - `squisq-proof-dialect`    — English dialect for this doc
 *   - `squisq-proof-dictionary` — comma-separated accepted words
 *
 * Deliberately NOT here: ignored findings. Dismissing a finding is a
 * personal preference about one person's editing session, not document
 * content — it would otherwise land in everyone's copy through git. The
 * editor hands that state to the host instead, scoped per document
 * (`ProofingIgnoreStore` in `@bendyline/squisq-editor-react/proofing`).
 */

import type { ProofDialect } from './types.js';
import { PROOF_DIALECTS } from './types.js';

/** Frontmatter keys (canonical `squisq-*` plus tolerated bare spellings). */
export const PROOF_FRONTMATTER_KEYS = Object.freeze({
  enabled: { canonical: 'squisq-proofing', legacy: 'proofing' },
  dialect: { canonical: 'squisq-proof-dialect', legacy: 'proof-dialect' },
  dictionary: { canonical: 'squisq-proof-dictionary', legacy: 'proof-dictionary' },
});

export interface ProofingSettings {
  /** Per-doc enable override; `undefined` = defer to the host default. */
  enabled?: boolean;
  /** Dialect override; `undefined` = provider/config default. */
  dialect?: ProofDialect;
  /** Doc-local accepted words (always an array; empty when unset). */
  dictionary: string[];
}

export const DEFAULT_PROOF_SETTINGS = Object.freeze({
  enabled: true,
  dialect: 'American' as ProofDialect,
});

function readSetting(
  frontmatter: Record<string, unknown> | undefined,
  keys: { canonical: string; legacy: string },
): unknown {
  if (!frontmatter) return undefined;
  return Object.prototype.hasOwnProperty.call(frontmatter, keys.canonical)
    ? frontmatter[keys.canonical]
    : frontmatter[keys.legacy];
}

function resolveBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'on'].includes(normalized)) return true;
  if (['false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

/** Resolve a dialect value case-insensitively; `undefined` when unrecognized. */
export function resolveProofDialect(value: unknown): ProofDialect | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return PROOF_DIALECTS.find((dialect) => dialect.toLowerCase() === normalized);
}

/**
 * Parse a dictionary value into a word list. Accepts the canonical
 * comma-separated string plus (defensively) a parsed YAML list.
 */
export function parseProofDictionary(value: unknown): string[] {
  const raw: string[] = [];
  if (typeof value === 'string') {
    raw.push(...value.split(/[,\s]+/));
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') raw.push(...entry.split(/[,\s]+/));
    }
  }
  const seen = new Set<string>();
  const words: string[] = [];
  for (const candidate of raw) {
    const word = candidate.trim();
    if (word.length === 0 || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

/** Encode a dictionary for frontmatter; `null` (remove the key) when empty. */
export function formatProofDictionary(words: readonly string[]): string | null {
  const deduped = parseProofDictionary([...words]);
  return deduped.length > 0 ? deduped.join(', ') : null;
}

/** Read all proofing settings from a parsed frontmatter record. */
export function readProofingSettings(
  frontmatter: Record<string, unknown> | undefined,
): ProofingSettings {
  return {
    enabled: resolveBoolean(readSetting(frontmatter, PROOF_FRONTMATTER_KEYS.enabled)),
    dialect: resolveProofDialect(readSetting(frontmatter, PROOF_FRONTMATTER_KEYS.dialect)),
    dictionary: parseProofDictionary(readSetting(frontmatter, PROOF_FRONTMATTER_KEYS.dictionary)),
  };
}
