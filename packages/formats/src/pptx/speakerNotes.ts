/**
 * Speaker notes from footnotes.
 *
 * A slide's footnotes become its speaker notes. On a slide a marker with
 * nothing under it says nothing, and a definition drawn as body text puts a
 * source list where the audience reads it; in the notes a presenter has both.
 * Markdown keeps definitions at document level (usually after the last
 * heading), so each slide collects the identifiers it references, in reading
 * order, and looks them up in the whole document.
 */

import type {
  MarkdownBlockNode,
  MarkdownFootnoteDefinition,
  MarkdownInlineNode,
} from '@bendyline/squisq/markdown';
import { NS_DRAWINGML, NS_PML, NS_R } from '../ooxml/namespaces.js';
import { escapeXml, xmlDeclaration } from '../ooxml/xmlUtils.js';
import { extractPlainText } from '../shared/text.js';

type AnyNode = { type: string; children?: unknown; [key: string]: unknown };

function childNodes(node: AnyNode): AnyNode[] {
  return Array.isArray(node.children) ? (node.children as AnyNode[]) : [];
}

/** Every footnote definition in `nodes`, by identifier, as one line of plain text. */
export function collectFootnoteDefinitions(
  nodes: readonly MarkdownBlockNode[],
  into: Map<string, string> = new Map(),
): Map<string, string> {
  const visit = (node: AnyNode) => {
    if (node.type === 'footnoteDefinition') {
      const def = node as unknown as MarkdownFootnoteDefinition;
      if (!into.has(def.identifier)) into.set(def.identifier, definitionText(def));
      return;
    }
    for (const child of childNodes(node)) visit(child);
  };
  for (const node of nodes) visit(node as unknown as AnyNode);
  return into;
}

function definitionText(def: MarkdownFootnoteDefinition): string {
  const parts: string[] = [];
  const visit = (node: AnyNode) => {
    const kids = childNodes(node);
    if (kids.length > 0 && kids.every((kid) => !isBlockLike(kid))) {
      parts.push(extractPlainText(kids as unknown as MarkdownInlineNode[]));
      return;
    }
    for (const kid of kids) visit(kid);
  };
  for (const child of def.children) visit(child as unknown as AnyNode);
  return parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'list',
  'listItem',
  'blockquote',
  'table',
  'tableRow',
  'tableCell',
  'code',
]);

function isBlockLike(node: AnyNode): boolean {
  return BLOCK_TYPES.has(node.type);
}

/** The footnote identifiers `nodes` reference, first mention first, each once. */
export function footnoteIdentifiersIn(nodes: readonly unknown[]): string[] {
  const seen: string[] = [];
  const visit = (node: AnyNode) => {
    if (node.type === 'footnoteDefinition') return;
    if (node.type === 'footnoteReference') {
      const id = String(node.identifier ?? '');
      if (id && !seen.includes(id)) seen.push(id);
      return;
    }
    for (const child of childNodes(node)) visit(child);
  };
  for (const node of nodes) visit(node as AnyNode);
  return seen;
}

/** A copy of `nodes` without footnote definitions, which belong in the notes. */
export function withoutFootnoteDefinitions<T extends { type: string }>(nodes: readonly T[]): T[] {
  return nodes.filter((node) => node.type !== 'footnoteDefinition');
}

/**
 * The speaker-note lines for a slide that references `identifiers`, numbered
 * as the reader would count them on that slide. A reference with no
 * definition is skipped: there is nothing to say about it.
 */
export function speakerNoteLines(
  identifiers: readonly string[],
  definitions: ReadonlyMap<string, string>,
): string[] {
  const lines: string[] = [];
  for (const id of identifiers) {
    const text = definitions.get(id);
    if (text) lines.push(`[${lines.length + 1}] ${text}`);
  }
  return lines;
}

/**
 * A notes slide: the slide-image placeholder PowerPoint draws the slide into,
 * and the body placeholder holding one paragraph per note line.
 */
export function buildNotesSlideXml(lines: readonly string[]): string {
  const paragraphs = lines
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`,
    )
    .join('');
  return (
    xmlDeclaration() +
    `<p:notes xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:notes>`
  );
}

/**
 * The notes master every notes slide follows. PowerPoint requires one, with a
 * slide-image and a body placeholder and a color map, before it shows notes.
 * Sized for the 16:9 deck in portrait notes pages (7.5 x 10 in).
 */
export function buildNotesMasterXml(): string {
  const level = (n: number) =>
    `<a:lvl${n}pPr marL="${(n - 1) * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">` +
    `<a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>` +
    `<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr>` +
    `</a:lvl${n}pPr>`;
  return (
    xmlDeclaration() +
    `<p:notesMaster xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}">` +
    `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>` +
    `<a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/>` +
    `<a:lstStyle/><a:p><a:pPr lvl="0"/><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"` +
    ` accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"` +
    ` hlink="hlink" folHlink="folHlink"/>` +
    `<p:notesStyle>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(level).join('')}</p:notesStyle>` +
    `</p:notesMaster>`
  );
}
