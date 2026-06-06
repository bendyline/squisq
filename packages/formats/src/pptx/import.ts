/**
 * PPTX import — PresentationML (.pptx) → MarkdownDocument.
 *
 * Reuses the shared ooxml/ reader. Reads slide order from
 * `ppt/presentation.xml` (`<p:sldIdLst>`), resolves each slide part via
 * relationships, and converts each slide to: an H2 of the title placeholder
 * (or "Slide N"), the remaining text as a bullet list, and any slide tables
 * (`<a:tbl>`) as markdown tables. Text lives in the DrawingML namespace
 * (`a:p` / `a:r` / `a:t`) inside PresentationML shapes (`p:sp`).
 */

import type {
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownListItem,
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';
import { getPartRelationships, getPartXml, openPackage } from '../ooxml/reader.js';
import type { OoxmlPackage } from '../ooxml/types.js';
import { NS_DRAWINGML, NS_PML, NS_R } from '../ooxml/namespaces.js';

export interface PptxImportOptions {
  /** Whether to extract embedded images as data URIs (not yet used). */
  extractImages?: boolean;
}

function attrNS(el: Element, ns: string, local: string, fallback: string): string | null {
  return el.getAttributeNS(ns, local) ?? el.getAttribute(fallback);
}

function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\//, '');
  const stack = baseDir ? baseDir.split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '..') stack.pop();
    else if (seg !== '.') stack.push(seg);
  }
  return stack.join('/');
}

async function orderedSlidePaths(pkg: OoxmlPackage): Promise<string[]> {
  const pres = await getPartXml(pkg, 'ppt/presentation.xml');
  if (!pres) return [];
  const rels = await getPartRelationships(pkg, 'ppt/presentation.xml');
  const relById = new Map(rels.map((r) => [r.id, r.target]));
  const out: string[] = [];
  const ids = pres.getElementsByTagNameNS(NS_PML, 'sldId');
  for (let i = 0; i < ids.length; i++) {
    const rid = attrNS(ids[i]!, NS_R, 'id', 'r:id');
    const target = rid ? relById.get(rid) : undefined;
    if (target) out.push(resolveTarget('ppt', target));
  }
  return out;
}

/** Concatenate the DrawingML text runs (`a:t`) inside a paragraph element. */
function paragraphText(para: Element): string {
  const ts = para.getElementsByTagNameNS(NS_DRAWINGML, 't');
  let s = '';
  for (let i = 0; i < ts.length; i++) s += ts[i]!.textContent ?? '';
  return s.trim();
}

function isTitleShape(sp: Element): boolean {
  const ph = sp.getElementsByTagNameNS(NS_PML, 'ph');
  if (!ph.length) return false;
  const type = ph[0]!.getAttribute('type');
  return type === 'title' || type === 'ctrTitle';
}

function tableToMarkdown(tbl: Element): MarkdownTable {
  const rows: MarkdownTableRow[] = [];
  const trs = tbl.getElementsByTagNameNS(NS_DRAWINGML, 'tr');
  for (let r = 0; r < trs.length; r++) {
    const tcs = trs[r]!.getElementsByTagNameNS(NS_DRAWINGML, 'tc');
    const cells: MarkdownTableCell[] = [];
    for (let c = 0; c < tcs.length; c++) {
      const paras = tcs[c]!.getElementsByTagNameNS(NS_DRAWINGML, 'p');
      const text = Array.from({ length: paras.length }, (_, i) => paragraphText(paras[i]!))
        .filter(Boolean)
        .join(' ');
      cells.push({
        type: 'tableCell',
        ...(r === 0 ? { isHeader: true } : {}),
        children: text ? [{ type: 'text', value: text }] : [],
      });
    }
    rows.push({ type: 'tableRow', children: cells });
  }
  return { type: 'table', children: rows };
}

async function convertSlide(
  pkg: OoxmlPackage,
  path: string,
  index: number,
): Promise<MarkdownBlockNode[]> {
  const doc = await getPartXml(pkg, path);
  if (!doc) return [];
  const out: MarkdownBlockNode[] = [];

  let title = '';
  const bullets: string[] = [];
  const shapes = doc.getElementsByTagNameNS(NS_PML, 'sp');
  for (let s = 0; s < shapes.length; s++) {
    const sp = shapes[s]!;
    const txBody = sp.getElementsByTagNameNS(NS_PML, 'txBody');
    if (!txBody.length) continue;
    const paras = txBody[0]!.getElementsByTagNameNS(NS_DRAWINGML, 'p');
    const texts: string[] = [];
    for (let p = 0; p < paras.length; p++) {
      const t = paragraphText(paras[p]!);
      if (t) texts.push(t);
    }
    if (texts.length === 0) continue;
    if (isTitleShape(sp) && !title) {
      title = texts.join(' ');
    } else {
      bullets.push(...texts);
    }
  }

  out.push({
    type: 'heading',
    depth: 2,
    children: [{ type: 'text', value: title || `Slide ${index + 1}` }],
  });

  if (bullets.length > 0) {
    const items: MarkdownListItem[] = bullets.map((text) => ({
      type: 'listItem',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
    }));
    out.push({ type: 'list', ordered: false, children: items });
  }

  const tbls = doc.getElementsByTagNameNS(NS_DRAWINGML, 'tbl');
  for (let t = 0; t < tbls.length; t++) out.push(tableToMarkdown(tbls[t]!));

  return out;
}

export async function pptxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  _options: PptxImportOptions = {},
): Promise<MarkdownDocument> {
  const pkg = await openPackage(data);
  const paths = await orderedSlidePaths(pkg);
  const children: MarkdownBlockNode[] = [];
  for (let i = 0; i < paths.length; i++) {
    children.push(...(await convertSlide(pkg, paths[i]!, i)));
  }
  return { type: 'document', children };
}
