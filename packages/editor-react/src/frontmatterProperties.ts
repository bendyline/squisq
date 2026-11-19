/**
 * frontmatterProperties
 *
 * The document's OWN frontmatter keys — `author`, `tags`, `slug`,
 * `description` — as an editable list of name/value rows, shared by the Write
 * view's document tray and Document settings.
 *
 * Squisq's own settings are not properties: anything prefixed `squisq-`,
 * `title` and `subtitle` (Document settings edits those), the settings the
 * editor reads without a prefix (`display-mode`, `document-render-as`), and
 * the older unprefixed spellings of managed settings (`theme`, `cover-slide`,
 * …). The hide list is derived from the same key constants the settings use,
 * so a new setting cannot leak into the grid.
 *
 * Everything here is pure: rows are drafts, `planPropertyEdits` turns the
 * difference between the drafts and the source into renames/removals/updates,
 * and `applyPropertyEdits` writes them with core's in-place frontmatter
 * writers — so an untouched property keeps its exact bytes, and a renamed one
 * keeps its place.
 */

import { COVER_SLIDE_FRONTMATTER_KEYS, DASHBOARD_FRONTMATTER_KEYS } from '@bendyline/squisq/doc';
import {
  parseFrontmatter,
  readFrontmatterScalar,
  renameFrontmatterKeys,
  setFrontmatterValues,
  splitFrontmatterBlock,
  type FrontmatterUpdateValue,
} from '@bendyline/squisq/markdown';
import { PROOF_FRONTMATTER_KEYS } from '@bendyline/squisq/proof';
import { FRONTMATTER_EDITOR_KEYS, FRONTMATTER_SETTING_KEYS } from './frontmatterSettings';

// ── Which keys are properties ─────────────────────────────────────

const SQUISQ_PREFIX = 'squisq-';

type KeyPair = { canonical: string; legacy: string | readonly string[] };

function managedBareKeys(): ReadonlySet<string> {
  const pairs: KeyPair[] = [
    ...Object.values(FRONTMATTER_SETTING_KEYS),
    ...Object.values(COVER_SLIDE_FRONTMATTER_KEYS),
    ...Object.values(DASHBOARD_FRONTMATTER_KEYS),
    ...Object.values(PROOF_FRONTMATTER_KEYS),
  ];
  const keys = new Set<string>([
    'title',
    'subtitle',
    'motion',
    ...Object.values(FRONTMATTER_EDITOR_KEYS),
  ]);
  for (const { canonical, legacy } of pairs) {
    keys.add(canonical);
    for (const name of typeof legacy === 'string' ? [legacy] : legacy) keys.add(name);
  }
  return keys;
}

const MANAGED_BARE_KEYS = managedBareKeys();

/**
 * Whether a frontmatter key is one of the document's own properties rather
 * than a Squisq setting. `description`, `author`, `tags` and any other key
 * that isn't a Squisq setting are properties.
 */
export function isCustomFrontmatterKey(key: string): boolean {
  return !key.startsWith(SQUISQ_PREFIX) && !MANAGED_BARE_KEYS.has(key);
}

// ── Reading ───────────────────────────────────────────────────────

/**
 * How a property's value can be edited: `text` in one box, `list` as
 * comma-separated items, or `nested` — a value with structure (or line breaks)
 * a text box cannot carry, shown read-only and edited in Source.
 */
export type CustomPropertyKind = 'text' | 'list' | 'nested';

export interface CustomProperty {
  key: string;
  /** The parsed value. */
  value: unknown;
  kind: CustomPropertyKind;
  /** What the value box shows: the value, the comma-joined list, or a summary. */
  text: string;
}

const FRONTMATTER_INNER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** A list item that survives a trip through comma-separated text unchanged. */
function isListItem(item: unknown): boolean {
  if (typeof item === 'number' || typeof item === 'boolean') return true;
  return typeof item === 'string' && item !== '' && item.trim() === item && !/[,\r\n]/.test(item);
}

function describeValue(value: unknown): { kind: CustomPropertyKind; text: string } {
  if (value === null || value === undefined) return { kind: 'text', text: '' };
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'text', text: String(value) };
  }
  if (typeof value === 'string') {
    // A text box drops line breaks; a block scalar is edited in Source.
    return /[\r\n]/.test(value)
      ? { kind: 'nested', text: `${value.split(/\r?\n/).length} lines` }
      : { kind: 'text', text: value };
  }
  if (Array.isArray(value)) {
    if (value.every(isListItem)) return { kind: 'list', text: value.map(String).join(', ') };
    return { kind: 'nested', text: value.length === 1 ? '1 item' : `${value.length} items` };
  }
  return { kind: 'nested', text: 'Nested values' };
}

/**
 * The document's own properties, in the order the frontmatter lists them.
 * Accepts a whole source or just its frontmatter block.
 */
export function readCustomProperties(source: string): CustomProperty[] {
  const block = splitFrontmatterBlock(source).frontmatter;
  const inner = block ? FRONTMATTER_INNER_RE.exec(block)?.[1] : undefined;
  if (!inner) return [];
  const frontmatter = parseFrontmatter(inner);
  if (!frontmatter) return [];
  return Object.entries(frontmatter)
    .filter(([key]) => isCustomFrontmatterKey(key))
    .map(([key, value]) => ({ key, value, ...describeValue(value) }));
}

// ── Typing what was typed ─────────────────────────────────────────

function typedText(text: string): string | number | boolean {
  // Null would remove the key, so "null", "~" and an empty box stay text.
  return readFrontmatterScalar(text) ?? text.trim();
}

/**
 * The value to write for a property's text. A value that was text stays text
 * (`version: "1.0"` keeps its quotes). A list splits on commas. Anything else
 * — a new property, a number, a true/false — is typed the way the same text
 * typed into the frontmatter by hand would be: `true` is true and `42` a
 * number. Commas in a new property's value are just text: a list is made in
 * Source, where its shape is unambiguous.
 */
export function coercePropertyText(
  text: string,
  original?: Pick<CustomProperty, 'kind' | 'value'>,
): Exclude<FrontmatterUpdateValue, null | undefined> {
  if (original?.kind === 'list') {
    return text
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
      .map(typedText);
  }
  if (typeof original?.value === 'string') return text.trim();
  return typedText(text);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

// ── Draft rows ────────────────────────────────────────────────────

/** One editable row: a property as loaded, or a new one (`originalKey: null`). */
export interface PropertyRow {
  id: string;
  /** The key this row was loaded from; null for a row added since. */
  originalKey: string | null;
  key: string;
  text: string;
  kind: CustomPropertyKind;
}

let rowSeq = 0;

/** A fresh, empty row for a new property. */
export function newPropertyRow(): PropertyRow {
  return { id: `property-new-${++rowSeq}`, originalKey: null, key: '', text: '', kind: 'text' };
}

/** Draft rows for the given properties, as loaded. */
export function rowsFromProperties(properties: readonly CustomProperty[]): PropertyRow[] {
  return properties.map((property) => ({
    id: `property-${++rowSeq}`,
    originalKey: property.key,
    key: property.key,
    text: property.text,
    kind: property.kind,
  }));
}

/** A new row nobody has typed into; it is dropped rather than written. */
export function isBlankNewRow(row: PropertyRow): boolean {
  return row.originalKey === null && row.key.trim() === '' && row.text.trim() === '';
}

/** Whether a row differs from the property it was loaded from. */
export function isRowChanged(row: PropertyRow, properties: readonly CustomProperty[]): boolean {
  if (row.originalKey === null) return !isBlankNewRow(row);
  const property = properties.find((entry) => entry.key === row.originalKey);
  return !property || row.key.trim() !== property.key || row.text !== property.text;
}

/**
 * What is wrong with each row's name, by row id. A row is fine when it has a
 * unique name that is not a Squisq setting; a blank new row is ignored.
 */
export function validatePropertyRows(rows: readonly PropertyRow[]): Map<string, string> {
  const errors = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.key.trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (isBlankNewRow(row)) continue;
    const key = row.key.trim();
    if (!key) errors.set(row.id, 'Give this property a name.');
    else if (/[\r\n]/.test(key)) errors.set(row.id, 'A name can’t contain a line break.');
    else if (key.startsWith(SQUISQ_PREFIX)) {
      errors.set(row.id, 'Names that start with “squisq-” are reserved for Squisq settings.');
    } else if (!isCustomFrontmatterKey(key)) {
      errors.set(row.id, `“${key}” is a document setting, not a property.`);
    } else if ((counts.get(key) ?? 0) > 1) {
      errors.set(row.id, `There’s already a property named “${key}”.`);
    }
  }
  return errors;
}

// ── Writing ───────────────────────────────────────────────────────

/** The edits that turn the loaded properties into the draft rows. */
export interface PropertyEditPlan {
  /** Keys to delete. Applied first, so a renamed row can take a deleted name. */
  removals: string[];
  /** Old key → new key, renamed in place. */
  renames: Record<string, string>;
  /** Values to write, by their (new) key; new keys are appended. */
  updates: Record<string, FrontmatterUpdateValue>;
}

/**
 * Compare draft rows with the properties they were loaded from. Rows the
 * user did not change contribute nothing, so their bytes are never rewritten.
 * Validate the rows first: a plan from invalid rows is not meaningful.
 */
export function planPropertyEdits(
  properties: readonly CustomProperty[],
  rows: readonly PropertyRow[],
): PropertyEditPlan {
  const byKey = new Map(properties.map((property) => [property.key, property]));
  const kept = new Set<string>();
  const plan: PropertyEditPlan = { removals: [], renames: {}, updates: {} };

  for (const row of rows) {
    if (isBlankNewRow(row)) continue;
    const key = row.key.trim();
    const property = row.originalKey === null ? undefined : byKey.get(row.originalKey);
    if (!property) {
      // A new row, or one whose property was removed elsewhere meanwhile.
      if (key) plan.updates[key] = coercePropertyText(row.text);
      continue;
    }
    kept.add(property.key);
    if (key !== property.key) plan.renames[property.key] = key;
    if (property.kind === 'nested' || row.text === property.text) continue;
    const value = coercePropertyText(row.text, property);
    if (!sameValue(value, property.value)) plan.updates[key] = value;
  }
  for (const property of properties) {
    if (!kept.has(property.key)) plan.removals.push(property.key);
  }
  return plan;
}

/** Whether a plan changes nothing. */
export function isEmptyPropertyPlan(plan: PropertyEditPlan): boolean {
  return (
    plan.removals.length === 0 &&
    Object.keys(plan.renames).length === 0 &&
    Object.keys(plan.updates).length === 0
  );
}

/**
 * Write a plan into a markdown source: removals, then in-place renames, then
 * values. Untouched keys, comments and the body keep their exact text.
 */
export function applyPropertyEdits(source: string, plan: PropertyEditPlan): string {
  let next = source;
  if (plan.removals.length > 0) {
    next = setFrontmatterValues(next, Object.fromEntries(plan.removals.map((key) => [key, null])));
  }
  if (Object.keys(plan.renames).length > 0) next = renameFrontmatterKeys(next, plan.renames);
  if (Object.keys(plan.updates).length > 0) next = setFrontmatterValues(next, plan.updates);
  return next;
}

// ── Live rows (the tray) ──────────────────────────────────────────

/**
 * Re-derive draft rows after the source's properties changed (a commit of
 * our own, an undo, an edit in Source).
 *
 * Rows keep their ids, so React keeps their inputs (and focus) mounted. A row
 * we just committed is matched through `carried` (new key → row id) and takes
 * the source's values. A row with an edit that has not been written — one the
 * user is still typing in, or one that failed validation — keeps its draft.
 * New rows that were never written stay at the end.
 */
export function reconcilePropertyRows(
  previousRows: readonly PropertyRow[],
  previousProperties: readonly CustomProperty[],
  properties: readonly CustomProperty[],
  carried: ReadonlyMap<string, string> = new Map(),
): PropertyRow[] {
  const byId = new Map(previousRows.map((row) => [row.id, row]));
  const byOriginalKey = new Map(
    previousRows
      .filter((row) => row.originalKey !== null)
      .map((row) => [row.originalKey as string, row]),
  );
  const used = new Set<string>();
  const next: PropertyRow[] = [];

  for (const property of properties) {
    const carriedId = carried.get(property.key);
    const carriedRow = carriedId === undefined ? undefined : byId.get(carriedId);
    const prior = carriedRow ?? byOriginalKey.get(property.key);
    const fresh: PropertyRow = {
      id: prior && !used.has(prior.id) ? prior.id : `property-${++rowSeq}`,
      originalKey: property.key,
      key: property.key,
      text: property.text,
      kind: property.kind,
    };
    used.add(fresh.id);
    if (prior && !carriedRow && isRowChanged(prior, previousProperties)) {
      next.push({ ...fresh, key: prior.key, text: prior.text });
    } else {
      next.push(fresh);
    }
  }
  for (const row of previousRows) {
    if (row.originalKey === null && !used.has(row.id)) next.push(row);
  }
  return next;
}
