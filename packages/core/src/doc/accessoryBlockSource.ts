/**
 * Writing accessory blocks into a document's markdown.
 *
 * The building blocks every accessory block writer shares (the Custom summary
 * design, study cards): where a new block goes under its owner, at what depth
 * and whether it must name its owner with `of=`; deleting a block with what is
 * under it; editing a block's heading tag; building a block as markdown nodes
 * so its text is escaped; and finishing a set of edits so the document still
 * ends with its content and one line ending.
 *
 * New blocks go after the owner's own text, before its first sub-section, in
 * the run of accessory blocks already there, ordered by type
 * (`AccessoryBlockTypeInfo.order`). Blocks already in a document are edited
 * where they are, never moved.
 */

import type { Block, Doc } from '../schemas/Doc.js';
import type { MarkdownBlockNode, MarkdownDocument, MarkdownHeading } from '../markdown/types.js';
import { parseMarkdown } from '../markdown/parse.js';
import { stringifyMarkdown } from '../markdown/stringify.js';
import { setHeadingLineParams } from '../markdown/headingTags.js';
import {
  applySourceTextEdits,
  coalesceSourceTextEdits,
  sortSourceTextEdits,
  type SourceTextEdit,
} from '../markdown/sourceTextEdits.js';
import { markdownToDoc, flattenBlocks } from './markdownToDoc.js';
import { flattenContentBlocks } from './accessoryBlocks.js';
import {
  ACCESSORY_BLOCK_OWNER_PARAM,
  accessoryBlockTypeInfo,
  isAccessoryBlockType,
  type AccessoryBlockType,
} from './accessoryBlockTypes.js';

/** Where new accessory blocks of one type go under an owner. */
export interface AccessoryBlockZone {
  /** Node index of the start of the owner's accessory blocks (after its own text). */
  start: number;
  /** Node index just after the owner's last accessory block that comes before this type's new ones. */
  end: number;
  /** Heading depth a new block is written at. */
  depth: number;
}

/** A document's markdown, located for accessory block edits. */
export interface AccessoryBlockSource {
  readonly source: string;
  readonly markdown: MarkdownDocument;
  readonly doc: Doc;
  /** Every block, accessory blocks and their parts included, by id. */
  readonly byId: ReadonlyMap<string, Block>;
  /** The top-level markdown nodes, which source node indexes refer to. */
  readonly nodes: readonly MarkdownBlockNode[];
  /** Accessory blocks themselves (not the headings nested inside one), in document order. */
  blocks(type?: AccessoryBlockType): Block[];
  /** Text with this document's line endings. */
  toEol(text: string): string;
  /** Node index of a block's heading, or -1. */
  headingIndex(block: Block): number;
  /** Source offset of node `index` (the document's end past the last node). */
  offsetAt(index: number): number;
  /** Index of the first heading node at or after `index`. */
  nextHeadingIndex(index: number): number;
  /** Index of the node that ends a heading's block: the next heading at its level or shallower. */
  extentEndIndex(index: number): number;
  /** Set or clear parameters on a block's heading tag; null when its heading cannot hold them. */
  headingEdit(block: Block, updates: Record<string, string | null>): SourceTextEdit | null;
  /** Remove a block's heading and everything under it. */
  deletion(block: Block): SourceTextEdit | null;
  /** The real block an accessory heading at `depth`, placed before node `index`, would belong to. */
  ownerAt(index: number, depth: number): string | undefined;
  /** Where new blocks of `type` go under `ownerId`; null when the owner is not in the document. */
  zone(ownerId: string, type: AccessoryBlockType): AccessoryBlockZone | null;
  /**
   * Insert blocks before node `at`. `render` is given the owner to name with
   * `of=` (undefined when the position already makes `ownerId` the owner) and
   * returns each block's markdown.
   */
  insertion(
    at: number,
    depth: number,
    ownerId: string,
    render: (of: string | undefined) => string[],
  ): SourceTextEdit | null;
  /**
   * The edits sorted, merged where they touch, and with the end of the
   * document tidied, applied to the source.
   */
  finish(edits: readonly SourceTextEdit[]): { edits: SourceTextEdit[]; result: string };
}

/** Locate `source` for accessory block edits. */
export function openAccessoryBlockSource(source: string): AccessoryBlockSource {
  const markdown = parseMarkdown(source);
  const doc = markdownToDoc(markdown);
  const nodes = markdown.children;
  const all = flattenBlocks(doc.blocks);
  const byId = new Map(all.map((block) => [block.id, block]));
  const blockOf = new Map<MarkdownHeading, Block>();
  for (const block of all) if (block.sourceHeading) blockOf.set(block.sourceHeading, block);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const toEol = (text: string) => (eol === '\n' ? text : text.replace(/\r?\n/g, eol));

  const startOf = (node: MarkdownBlockNode) => node.position?.start.offset ?? -1;
  const indexOf = (heading: MarkdownHeading | undefined) =>
    heading ? nodes.indexOf(heading as MarkdownBlockNode) : -1;
  const isHeading = (node: MarkdownBlockNode | undefined): node is MarkdownHeading =>
    node?.type === 'heading';
  /** The accessory block a heading node starts, when it starts one (not a nested part). */
  const accessoryAt = (node: MarkdownBlockNode | undefined): Block | undefined => {
    if (!isHeading(node)) return undefined;
    const block = blockOf.get(node);
    return block?.accessoryBlock && block.accessoryBlock.within === undefined ? block : undefined;
  };
  const orderOf = (block: Block): number => {
    const type = block.accessoryBlock?.type;
    return isAccessoryBlockType(type) ? accessoryBlockTypeInfo(type).order : Infinity;
  };

  const extentEndIndex = (index: number): number => {
    const depth = (nodes[index] as MarkdownHeading).depth;
    for (let i = index + 1; i < nodes.length; i++) {
      const node = nodes[i];
      if (isHeading(node) && node.depth <= depth) return i;
    }
    return nodes.length;
  };
  const offsetAt = (index: number) =>
    index < nodes.length ? startOf(nodes[index]!) : source.length;
  const nextHeadingIndex = (index: number): number => {
    for (let i = index; i < nodes.length; i++) if (isHeading(nodes[i])) return i;
    return nodes.length;
  };
  /** Where content ends before `offset`, trailing whitespace left out. */
  const contentEndBefore = (offset: number): number => {
    let at = offset;
    while (at > 0 && /\s/.test(source[at - 1]!)) at--;
    return at;
  };

  function blocks(type?: AccessoryBlockType): Block[] {
    return all.filter(
      (block) =>
        block.accessoryBlock !== undefined &&
        block.accessoryBlock.within === undefined &&
        (type === undefined || block.accessoryBlock.type === type),
    );
  }

  function headingEdit(block: Block, updates: Record<string, string | null>) {
    const heading = block.sourceHeading;
    if (!heading?.position) return null;
    const start = heading.position.start.offset!;
    const end = heading.position.end.offset!;
    const line = source.slice(start, end);
    const next = setHeadingLineParams(line, updates);
    if (next === null) return null;
    return next === line ? null : { start, end, text: next };
  }

  function deletion(block: Block): SourceTextEdit | null {
    const index = indexOf(block.sourceHeading);
    if (index < 0) return null;
    return { start: startOf(nodes[index]!), end: offsetAt(extentEndIndex(index)), text: '' };
  }

  function ownerAt(index: number, depth: number): string | undefined {
    for (let i = Math.min(index, nodes.length) - 1; i >= 0; i--) {
      const node = nodes[i];
      if (isHeading(node) && node.depth < depth) {
        const block = blockOf.get(node);
        return block?.accessoryBlock ? undefined : block?.id;
      }
    }
    return byId.get('preamble')?.sourceHeading
      ? undefined
      : byId.has('preamble')
        ? 'preamble'
        : undefined;
  }

  function zone(ownerId: string, type: AccessoryBlockType): AccessoryBlockZone | null {
    const owner = byId.get(ownerId);
    if (!owner) return null;
    // The heading whose body holds the owner: itself, or for a section made by
    // a standalone tag the heading it sits under; the document's top for the
    // text before the first heading.
    let host: Block | undefined = owner.sourceHeading ? owner : undefined;
    if (!host && ownerId !== 'preamble') {
      const content = flattenContentBlocks(doc.blocks);
      for (let i = content.indexOf(owner) - 1; i >= 0; i--) {
        if (content[i]!.sourceHeading) {
          host = content[i];
          break;
        }
      }
    }
    const hostIndex = host ? indexOf(host.sourceHeading) : -1;
    if (host && hostIndex < 0) return null;
    // After the host's own text: at its first following heading, in the run of
    // accessory blocks already there, after those that come before this type.
    const start = nextHeadingIndex(hostIndex + 1);
    const order = accessoryBlockTypeInfo(type).order;
    let end = start;
    for (let at = start; at < nodes.length;) {
      const block = accessoryAt(nodes[at]);
      if (!block) break;
      const next = extentEndIndex(at);
      if (orderOf(block) <= order) end = next;
      at = next;
    }
    const first = nodes[start];
    const hostDepth = host?.sourceHeading?.depth;
    const depth = accessoryAt(first)
      ? (first as MarkdownHeading).depth
      : hostDepth === undefined
        ? isHeading(first)
          ? first.depth
          : (nodes.find(isHeading)?.depth ?? 2)
        : isHeading(first) && first.depth > hostDepth
          ? first.depth
          : hostDepth + 1;
    return { start, end, depth: Math.min(depth, 6) };
  }

  function insertion(
    at: number,
    depth: number,
    ownerId: string,
    render: (of: string | undefined) => string[],
  ): SourceTextEdit | null {
    const parts = render(ownerAt(at, depth) === ownerId ? undefined : ownerId);
    if (!parts.length) return null;
    const body = parts.join('\n\n');
    return {
      start: offsetAt(at),
      end: offsetAt(at),
      text: toEol(at < nodes.length ? `${body}\n\n` : `\n\n${body}\n`),
    };
  }

  function tidyEnd(edits: SourceTextEdit[]): SourceTextEdit[] {
    const last = edits[edits.length - 1];
    if (!last || last.end !== source.length) return edits;
    const previousEnd = edits.length > 1 ? edits[edits.length - 2]!.end : 0;
    const start = Math.max(previousEnd, contentEndBefore(last.start));
    const body = last.text.replace(/^\s+|\s+$/g, '');
    const text = start === 0 ? (body ? body + eol : '') : body ? eol + eol + body + eol : eol;
    return [...edits.slice(0, -1), { start, end: source.length, text }];
  }

  function finish(edits: readonly SourceTextEdit[]) {
    const merged = tidyEnd(coalesceSourceTextEdits(sortSourceTextEdits([...edits])));
    return { edits: merged, result: applySourceTextEdits(source, merged) };
  }

  return {
    source,
    markdown,
    doc,
    byId,
    nodes,
    blocks,
    toEol,
    headingIndex: (block) => indexOf(block.sourceHeading),
    offsetAt,
    nextHeadingIndex,
    extentEndIndex,
    headingEdit,
    deletion,
    ownerAt,
    zone,
    insertion,
    finish,
  };
}

/** One accessory block as markdown: its heading line, and its body when it has one. */
export function accessoryBlockMarkdown(block: {
  type: AccessoryBlockType;
  depth: number;
  /** The heading's text, as inline nodes or plain text (escaped when written). */
  title: string | MarkdownHeading['children'];
  /** Tag parameters, written in this order. */
  params: Record<string, string>;
  /** Names the owner with `of=` when given. */
  of?: string;
  body?: MarkdownBlockNode[];
}): { heading: string; body?: string } {
  const params = { ...block.params };
  if (block.of) params[ACCESSORY_BLOCK_OWNER_PARAM] = block.of;
  const children =
    typeof block.title === 'string'
      ? block.title
        ? [{ type: 'text' as const, value: block.title }]
        : []
      : block.title;
  const heading: MarkdownHeading = {
    type: 'heading',
    depth: Math.min(Math.max(block.depth, 1), 6) as MarkdownHeading['depth'],
    children,
    templateAnnotation: { template: block.type, params },
  };
  const headingText = stringifyMarkdown(markdownDocument([heading])).trim();
  if (!block.body?.length) return { heading: headingText };
  return { heading: headingText, body: stringifyMarkdown(markdownDocument(block.body)).trim() };
}

/** Remove accessory blocks by id (of one type when given), each with what is under its heading. */
export function removeAccessoryBlocks(
  source: string,
  accessoryBlockIds: readonly string[],
  type?: AccessoryBlockType,
): { edits: SourceTextEdit[]; result: string } {
  const located = openAccessoryBlockSource(source);
  const ids = new Set(accessoryBlockIds);
  const edits: SourceTextEdit[] = [];
  for (const block of located.blocks(type)) {
    if (!ids.has(block.id)) continue;
    const edit = located.deletion(block);
    if (edit) edits.push(edit);
  }
  const sorted = sortSourceTextEdits(edits);
  return { edits: sorted, result: applySourceTextEdits(source, sorted) };
}

function markdownDocument(children: MarkdownBlockNode[]): MarkdownDocument {
  return { type: 'document', children };
}
