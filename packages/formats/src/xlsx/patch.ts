/**
 * XLSX in-place cell-value patching — the grid's XLSX save path.
 *
 * `patchXlsxCellValues(bytes, patches)` rewrites ONLY the worksheet parts a
 * patch touches (plus `xl/workbook.xml` for the calc flag) and copies every
 * other archive member through untouched, so charts, pivot caches, styles,
 * macros and anything else this library does not model survive a save
 * byte-for-byte (uncompressed content — the archive itself is re-deflated).
 *
 * All-or-nothing: any per-cell refusal throws `XlsxPatchRefusal` BEFORE any
 * output is produced. Refusals, and their whys:
 *  - `sheet-missing` / `cell-ref-invalid` — the patch addresses nothing.
 *  - `formula-cell` — overwriting `<v>` under an `<f>` silently desyncs the
 *    cached value from the formula; deleting the `<f>` destroys authored
 *    logic. Formula editing arrives with the calculation engine (Phase 3).
 *  - `shared-formula-follower` — worse: the cell LOOKS empty (`<f t="shared"
 *    si="…"/>` with no text) but is the fill-down continuation of a master
 *    formula; distinguished from `formula-cell` so a UI can explain it.
 *  - `date-value-unsupported` — a date-styled cell stores a serial number
 *    whose meaning depends on the workbook epoch and format code; writing a
 *    naive number or string produces a silently wrong date. Clearing
 *    (value `null`) is allowed — it keeps the style.
 *
 * Values write the way Excel does: number → `<v>` with no `t`; boolean →
 * `t="b"`; string → `t="inlineStr"` (a shared-string cell is switched to
 * inlineStr — orphaned sst entries are legal per ECMA-376); `null` clears
 * content but keeps the cell and its style. After a successful patch the
 * workbook's `<calcPr fullCalcOnLoad="1"/>` is set (inserted in CT_Workbook
 * sequence position when absent) so Excel recomputes every formula on open
 * instead of trusting caches that may reference patched inputs.
 *
 * XML is parsed AND serialized with the package-owned xmldom in every
 * environment — browser DOMParser/XMLSerializer output differs across
 * engines, and a deterministic writer is what makes the untouched-member and
 * zero-patch guardrail tests meaningful. The XML declaration is re-prefixed
 * from the original bytes (a serializer never reproduces it verbatim).
 */

import JSZip from 'jszip';
import { DOMParser as XmldomDOMParser, XMLSerializer as XmldomXMLSerializer } from '@xmldom/xmldom';
import { getPartBinary, openPackage, requireMainPartPath } from '../ooxml/reader.js';
import type { OoxmlOpenOptions } from '../ooxml/reader.js';
import { NS_SML } from '../ooxml/namespaces.js';
import { parseCellRef, formatCellRef, colIndex } from './cells.js';
import { listSheetParts, readCellStyles, numberFormatKind, type CellStyle } from './import.js';

const XLSX_MAIN_PART = 'xl/workbook.xml';

export interface XlsxCellPatch {
  /** Sheet name, exactly as the workbook lists it. */
  sheet: string;
  /** A1-style cell reference (e.g. `B4`). */
  ref: string;
  /**
   * New cell value; `null` clears the cell's content, keeping its style.
   * Mutually exclusive with `formula`.
   */
  value?: number | boolean | string | null;
  /**
   * New formula source WITHOUT the leading `=` — the grid's formula-editing
   * save path. The cell's `<f>` is replaced (a shared-formula FOLLOWER's
   * membership is self-contained, so overwriting it simply removes that
   * cell from the group; a shared MASTER is refused — its followers'
   * `si` would dangle). Pair with `cachedValue` so viewers that don't
   * recalculate still show the engine's result; `fullCalcOnLoad` makes
   * Excel recompute regardless.
   */
  formula?: string;
  /** Engine-computed result stored beside `formula` as the cached `<v>`. */
  cachedValue?: number | boolean | string;
}

export type XlsxPatchRefusalCode =
  | 'sheet-missing'
  | 'cell-ref-invalid'
  | 'formula-cell'
  | 'shared-formula-follower'
  | 'shared-formula-master'
  | 'date-value-unsupported'
  | 'number-not-finite'
  | 'patch-invalid';

/** A per-cell condition that makes the whole patch refuse (all-or-nothing). */
export class XlsxPatchRefusal extends Error {
  readonly code: XlsxPatchRefusalCode;
  readonly sheet: string;
  readonly ref: string;

  constructor(code: XlsxPatchRefusalCode, sheet: string, ref: string, message: string) {
    super(message);
    this.name = 'XlsxPatchRefusal';
    this.code = code;
    this.sheet = sheet;
    this.ref = ref;
  }
}

export type XlsxPatchOptions = OoxmlOpenOptions;

// ── xmldom plumbing ──────────────────────────────────────────────────

interface RawPart {
  text: string;
  doc: Document;
}

function parsePart(text: string): Document {
  const doc = new XmldomDOMParser().parseFromString(text, 'application/xml') as unknown as Document;
  const errors = doc.getElementsByTagName('parsererror');
  if (errors.length > 0) {
    throw new Error(`Invalid XLSX XML part: ${errors[0]?.textContent ?? 'parse error'}`);
  }
  return doc;
}

/** Serialize, re-prefixing the ORIGINAL XML declaration (serializers drop it). */
function serializePart(doc: Document, originalText: string): string {
  const serialized = new XmldomXMLSerializer().serializeToString(
    doc as unknown as Parameters<InstanceType<typeof XmldomXMLSerializer>['serializeToString']>[0],
  );
  if (serialized.startsWith('<?xml')) return serialized;
  const decl = /^\uFEFF?<\?xml[^>]*\?>\s*/.exec(originalText);
  return decl ? decl[0] + serialized : serialized;
}

async function readRawPart(
  pkg: Awaited<ReturnType<typeof openPackage>>,
  path: string,
): Promise<RawPart> {
  const bytes = await getPartBinary(pkg, path);
  if (!bytes) throw new Error(`Invalid XLSX package: part "${path}" is missing.`);
  const text = new TextDecoder().decode(bytes);
  return { text, doc: parsePart(text) };
}

// ── worksheet DOM helpers ────────────────────────────────────────────

function childElementsNS(parent: Element, local: string): Element[] {
  const out: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.localName === local && el.namespaceURI === NS_SML) out.push(el);
  }
  return out;
}

function firstChildNS(parent: Element, local: string): Element | null {
  return childElementsNS(parent, local)[0] ?? null;
}

/** Find (or create, in `r`-sorted position) the `<row>` for a 1-based index. */
function findOrCreateRow(doc: Document, sheetData: Element, rowNumber: number): Element {
  let insertBefore: Element | null = null;
  for (const row of childElementsNS(sheetData, 'row')) {
    const r = Number.parseInt(row.getAttribute('r') ?? '', 10);
    if (r === rowNumber) return row;
    if (Number.isFinite(r) && r > rowNumber && !insertBefore) insertBefore = row;
  }
  const created = doc.createElementNS(NS_SML, 'row');
  created.setAttribute('r', String(rowNumber));
  sheetData.insertBefore(created, insertBefore);
  return created;
}

/** Find (or create, in column-sorted position) the `<c>` for an A1 ref. */
function findOrCreateCell(doc: Document, row: Element, ref: string): Element {
  const targetCol = colIndex(ref);
  let insertBefore: Element | null = null;
  for (const cell of childElementsNS(row, 'c')) {
    const cellRef = cell.getAttribute('r');
    if (cellRef === ref) return cell;
    if (cellRef && colIndex(cellRef) > targetCol && !insertBefore) insertBefore = cell;
  }
  const created = doc.createElementNS(NS_SML, 'c');
  created.setAttribute('r', ref);
  row.insertBefore(created, insertBefore);
  return created;
}

function refuseFormulaCell(cell: Element, sheet: string, ref: string): void {
  const f = firstChildNS(cell, 'f');
  if (!f) return;
  const isSharedFollower = f.getAttribute('t') === 'shared' && (f.textContent ?? '').trim() === '';
  throw new XlsxPatchRefusal(
    isSharedFollower ? 'shared-formula-follower' : 'formula-cell',
    sheet,
    ref,
    isSharedFollower
      ? `${sheet}!${ref} continues a shared (fill-down) formula; formula cells cannot be patched`
      : `${sheet}!${ref} holds a formula; formula cells cannot be patched`,
  );
}

function refuseDateStyled(
  cell: Element,
  styles: CellStyle[],
  sheet: string,
  ref: string,
  value: number | boolean | string | null,
): void {
  if (value === null) return; // clearing keeps the style — always legal
  const styleIndex = Number.parseInt(cell.getAttribute('s') ?? '', 10);
  if (!Number.isFinite(styleIndex)) return;
  const style = styles[styleIndex];
  if (!style) return;
  const kind = numberFormatKind(style.formatCode);
  if (kind === 'date' || kind === 'time' || kind === 'datetime') {
    throw new XlsxPatchRefusal(
      'date-value-unsupported',
      sheet,
      ref,
      `${sheet}!${ref} is date-formatted; date values are not supported by in-place patching`,
    );
  }
}

/** Remove the cell's content children (`<v>`, `<is>`), keeping everything else. */
function clearCellContent(cell: Element): void {
  for (const local of ['v', 'is'] as const) {
    for (const el of childElementsNS(cell, local)) cell.removeChild(el);
  }
}

function writeCellValue(
  doc: Document,
  cell: Element,
  value: number | boolean | string | null,
): void {
  clearCellContent(cell);
  if (value === null) {
    cell.removeAttribute('t');
    return;
  }
  if (typeof value === 'number') {
    cell.removeAttribute('t');
    const v = doc.createElementNS(NS_SML, 'v');
    v.appendChild(doc.createTextNode(String(value)));
    cell.appendChild(v);
    return;
  }
  if (typeof value === 'boolean') {
    cell.setAttribute('t', 'b');
    const v = doc.createElementNS(NS_SML, 'v');
    v.appendChild(doc.createTextNode(value ? '1' : '0'));
    cell.appendChild(v);
    return;
  }
  // string → inlineStr; a former shared-string cell simply orphans its sst
  // entry, which is legal — the sst is a pool, not a reference-counted store.
  cell.setAttribute('t', 'inlineStr');
  const is = doc.createElementNS(NS_SML, 'is');
  const t = doc.createElementNS(NS_SML, 't');
  if (value !== value.trim())
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(value));
  is.appendChild(t);
  cell.appendChild(is);
}

/** Refuse replacing a shared-formula MASTER — its followers' `si` would dangle. */
function refuseSharedMaster(cell: Element, sheet: string, ref: string): void {
  const f = firstChildNS(cell, 'f');
  if (!f) return;
  if (f.getAttribute('t') === 'shared' && (f.textContent ?? '').trim() !== '') {
    throw new XlsxPatchRefusal(
      'shared-formula-master',
      sheet,
      ref,
      `${sheet}!${ref} is the master of a shared (fill-down) formula group; replacing it would orphan its followers`,
    );
  }
}

/** Remove any existing `<f>` (plain or shared-follower membership). */
function clearCellFormula(cell: Element): void {
  for (const el of childElementsNS(cell, 'f')) cell.removeChild(el);
}

function writeCellFormula(
  doc: Document,
  cell: Element,
  formula: string,
  cachedValue: number | boolean | string | undefined,
): void {
  clearCellFormula(cell);
  clearCellContent(cell);
  cell.removeAttribute('t');
  // Schema order: <f> precedes <v>/<is> in CT_Cell.
  const f = doc.createElementNS(NS_SML, 'f');
  f.appendChild(doc.createTextNode(formula));
  cell.appendChild(f);
  if (cachedValue === undefined) return;
  const v = doc.createElementNS(NS_SML, 'v');
  if (typeof cachedValue === 'number') {
    v.appendChild(doc.createTextNode(String(cachedValue)));
  } else if (typeof cachedValue === 'boolean') {
    cell.setAttribute('t', 'b');
    v.appendChild(doc.createTextNode(cachedValue ? '1' : '0'));
  } else {
    // `t="str"` is the cached-string-FORMULA-result cell type.
    cell.setAttribute('t', 'str');
    v.appendChild(doc.createTextNode(cachedValue));
  }
  cell.appendChild(v);
}

// ── workbook calc flag ───────────────────────────────────────────────

/**
 * CT_Workbook child sequence (ECMA-376 §18.2.27) — everything that may
 * legally FOLLOW `<calcPr>`, used to insert it in schema position.
 */
const AFTER_CALC_PR = new Set([
  'oleSize',
  'customWorkbookViews',
  'pivotCaches',
  'smartTagPr',
  'smartTagTypes',
  'webPublishing',
  'fileRecoveryPr',
  'webPublishObjects',
  'extLst',
]);

function setFullCalcOnLoad(doc: Document): void {
  const root = doc.documentElement;
  if (!root) return;
  const existing = firstChildNS(root as unknown as Element, 'calcPr');
  if (existing) {
    existing.setAttribute('fullCalcOnLoad', '1');
    return;
  }
  const calcPr = doc.createElementNS(NS_SML, 'calcPr');
  calcPr.setAttribute('fullCalcOnLoad', '1');
  let insertBefore: Node | null = null;
  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.namespaceURI === NS_SML && AFTER_CALC_PR.has(el.localName)) {
      insertBefore = node;
      break;
    }
  }
  root.insertBefore(calcPr, insertBefore);
}

// ── the patcher ──────────────────────────────────────────────────────

/**
 * Apply cell-value patches to an XLSX file in place.
 *
 * @param bytes - The original workbook bytes.
 * @param patches - Cell writes; all applied, or none (`XlsxPatchRefusal`).
 * @param options - Zip safety limits (same contract as import).
 * @returns The patched workbook as a new ArrayBuffer.
 */
export async function patchXlsxCellValues(
  bytes: ArrayBuffer,
  patches: readonly XlsxCellPatch[],
  options: XlsxPatchOptions = {},
): Promise<ArrayBuffer> {
  const pkg = await openPackage(bytes, options);
  const mainPart = requireMainPartPath(pkg, XLSX_MAIN_PART, 'XLSX');
  const sheets = await listSheetParts(pkg, mainPart);
  const styles = await readCellStyles(pkg);
  const sheetByName = new Map(sheets.map((sheet) => [sheet.name, sheet.path]));

  // Validate refs and sheet names up front — cheap, and it keeps DOM work
  // from starting on a batch that cannot fully apply.
  for (const patch of patches) {
    if (!sheetByName.has(patch.sheet)) {
      throw new XlsxPatchRefusal(
        'sheet-missing',
        patch.sheet,
        patch.ref,
        `workbook has no sheet named "${patch.sheet}"`,
      );
    }
    if (!parseCellRef(patch.ref)) {
      throw new XlsxPatchRefusal(
        'cell-ref-invalid',
        patch.sheet,
        patch.ref,
        `"${patch.ref}" is not a valid cell reference`,
      );
    }
    const hasValue = patch.value !== undefined;
    const hasFormula = patch.formula !== undefined;
    if (hasValue === hasFormula) {
      throw new XlsxPatchRefusal(
        'patch-invalid',
        patch.sheet,
        patch.ref,
        `${patch.sheet}!${patch.ref}: a patch carries exactly one of value or formula`,
      );
    }
    if (hasFormula && patch.formula!.trim() === '') {
      throw new XlsxPatchRefusal(
        'patch-invalid',
        patch.sheet,
        patch.ref,
        `${patch.sheet}!${patch.ref}: formula must be non-empty`,
      );
    }
    const numericCandidate = hasFormula ? patch.cachedValue : patch.value;
    if (typeof numericCandidate === 'number' && !Number.isFinite(numericCandidate)) {
      throw new XlsxPatchRefusal(
        'number-not-finite',
        patch.sheet,
        patch.ref,
        `${patch.sheet}!${patch.ref}: only finite numbers can be written`,
      );
    }
  }

  // Parse each touched worksheet once and apply its patches to the DOM.
  const touched = new Map<string, RawPart>();
  for (const patch of patches) {
    const path = sheetByName.get(patch.sheet)!;
    let part = touched.get(path);
    if (!part) {
      part = await readRawPart(pkg, path);
      touched.set(path, part);
    }
    const parsed = parseCellRef(patch.ref)!;
    const normalizedRef = formatCellRef(parsed.row, parsed.col);
    const sheetData = firstChildNS(part.doc.documentElement as unknown as Element, 'sheetData');
    if (!sheetData) {
      throw new Error(`Invalid worksheet part "${path}": no <sheetData> element.`);
    }
    const row = findOrCreateRow(part.doc, sheetData, parsed.row + 1);
    const cell = findOrCreateCell(part.doc, row, normalizedRef);
    if (patch.formula !== undefined) {
      refuseSharedMaster(cell, patch.sheet, normalizedRef);
      writeCellFormula(part.doc, cell, patch.formula, patch.cachedValue);
    } else {
      refuseFormulaCell(cell, patch.sheet, normalizedRef);
      refuseDateStyled(cell, styles, patch.sheet, normalizedRef, patch.value ?? null);
      writeCellValue(part.doc, cell, patch.value ?? null);
    }
  }

  // A workbook whose inputs changed must not present stale formula caches.
  if (touched.size > 0) {
    const workbook = await readRawPart(pkg, mainPart);
    setFullCalcOnLoad(workbook.doc);
    touched.set(mainPart, workbook);
  }

  // Rewrite the archive: only the touched parts are replaced; JSZip carries
  // every other member's content through unchanged.
  const zip = await JSZip.loadAsync(bytes);
  for (const [path, part] of touched) {
    zip.file(path, serializePart(part.doc, part.text));
  }
  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
