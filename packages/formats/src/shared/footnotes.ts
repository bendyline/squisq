/**
 * Shared footnote collection and numbering for the HTML-family exporters.
 *
 * GFM footnotes are two separate nodes — a `footnoteReference` in the prose and
 * a `footnoteDefinition` at block level — and the mapping between them is by
 * identifier, while the NUMBER a reader sees is the order of first reference.
 * An exporter that renders each node where it stands therefore gets it wrong in
 * both directions: the reference has no number and the definition appears
 * wherever the author happened to put it.
 *
 * That is what the static-HTML and EPUB exporters used to do — `[^1]` rendered
 * as nothing at all and the definition became a stray unmarked paragraph, so a
 * document's footnote markers silently vanished on export. This module owns the
 * numbering pass so both exporters agree, and so a DOCX imported with real Word
 * footnotes survives a trip out to HTML.
 */

import type {
  MarkdownDocument,
  MarkdownFootnoteDefinition,
  MarkdownNode,
} from '@bendyline/squisq/markdown';

/** One footnote, resolved to the number a reader will see. */
export interface NumberedFootnote {
  identifier: string;
  /** 1-based, in order of first reference; unreferenced ones sort last. */
  number: number;
  definition: MarkdownFootnoteDefinition | undefined;
  /** How many times the prose cites it — one backlink is owed per citation. */
  citations: number;
}

/** A single citation of a footnote, as rendered at one point in the prose. */
export interface FootnoteCitation {
  number: number;
  /** 1-based index among citations OF THIS footnote. */
  occurrence: number;
}

/**
 * Footnote numbering for one document.
 *
 * Built once up front so a reference can be numbered the moment it is rendered,
 * long before the definitions section is emitted.
 */
export class FootnoteIndex {
  private readonly numbers = new Map<string, number>();
  private readonly definitions = new Map<string, MarkdownFootnoteDefinition>();
  /** Citations rendered so far, per identifier — see {@link cite}. */
  private readonly citations = new Map<string, number>();

  constructor(doc: MarkdownDocument) {
    collectReferences(doc.children as MarkdownNode[], (id) => {
      if (!this.numbers.has(id)) this.numbers.set(id, this.numbers.size + 1);
    });
    collectDefinitions(doc.children as MarkdownNode[], (def) => {
      this.definitions.set(def.identifier, def);
      // A definition nobody references still gets a number so its content is
      // not dropped on the floor. GFM's reference implementation omits it, but
      // these are CONVERTERS: a footnote whose marker was lost upstream (an
      // unlabelled spreadsheet caption, a malformed import) is exactly the
      // content a reader most needs to still see.
      if (!this.numbers.has(def.identifier))
        this.numbers.set(def.identifier, this.numbers.size + 1);
    });
  }

  /** Whether the document has any footnotes at all. */
  get isEmpty(): boolean {
    return this.numbers.size === 0;
  }

  /** The reader-facing number for an identifier (assigning one if unseen). */
  numberFor(identifier: string): number {
    const existing = this.numbers.get(identifier);
    if (existing !== undefined) return existing;
    const next = this.numbers.size + 1;
    this.numbers.set(identifier, next);
    return next;
  }

  /**
   * Record one citation and return how to anchor it.
   *
   * Prose may cite the same footnote repeatedly. Every citation needs its own
   * element id — reusing one id would emit duplicate ids, which is invalid HTML
   * and leaves the backlink pointing at whichever copy the browser found first.
   * Call this exactly once per rendered reference, in document order.
   */
  cite(identifier: string): FootnoteCitation {
    const number = this.numberFor(identifier);
    const occurrence = (this.citations.get(identifier) ?? 0) + 1;
    this.citations.set(identifier, occurrence);
    return { number, occurrence };
  }

  /** Every footnote in reading order. */
  ordered(): NumberedFootnote[] {
    return [...this.numbers.entries()]
      .map(([identifier, number]) => ({
        identifier,
        number,
        definition: this.definitions.get(identifier),
        citations: this.citations.get(identifier) ?? 0,
      }))
      .sort((a, b) => a.number - b.number);
  }
}

/** Whether a node is a footnote definition, without importing the guard. */
export function isFootnoteDefinition(node: MarkdownNode): node is MarkdownFootnoteDefinition {
  return node.type === 'footnoteDefinition';
}

function childrenOf(node: MarkdownNode): MarkdownNode[] {
  return 'children' in node && Array.isArray(node.children)
    ? (node.children as MarkdownNode[])
    : [];
}

/** Depth-first walk calling back for each `footnoteReference` identifier. */
function collectReferences(nodes: MarkdownNode[], visit: (identifier: string) => void): void {
  for (const node of nodes) {
    // A definition's own body is walked separately: a footnote that cites
    // another footnote must not steal the citing order of the main text.
    if (node.type === 'footnoteDefinition') continue;
    if (node.type === 'footnoteReference') {
      visit(node.identifier);
      continue;
    }
    collectReferences(childrenOf(node), visit);
  }
}

/** Depth-first walk calling back for each `footnoteDefinition`. */
function collectDefinitions(
  nodes: MarkdownNode[],
  visit: (definition: MarkdownFootnoteDefinition) => void,
): void {
  for (const node of nodes) {
    if (isFootnoteDefinition(node)) {
      visit(node);
      continue;
    }
    collectDefinitions(childrenOf(node), visit);
  }
}

/**
 * Ids for the anchor pair that links a reference to its definition.
 *
 * `occurrence` distinguishes repeat citations of the same footnote; the first
 * keeps the bare id so the common single-citation case reads cleanly.
 */
export function footnoteIds(identifier: string, occurrence = 1): { ref: string; def: string } {
  const safe = identifier.replace(/[^A-Za-z0-9_-]/g, '-');
  const suffix = occurrence > 1 ? `-${occurrence}` : '';
  return { ref: `fnref-${safe}${suffix}`, def: `fn-${safe}` };
}

/**
 * Renumber a document's footnotes to `1..n` in order of first reference.
 *
 * For importers whose source format has no footnote LABELS — Word numbers its
 * notes and nothing more — so the identifier is invented by the importer. Left
 * alone those inventions leak into the markdown (`[^fn1]`, `[^endnote2]`) and a
 * markdown → DOCX → markdown trip comes back spelled differently from how it
 * went in. Numbering by reference order is both what a reader expects and what
 * an author would have typed, so the common case round-trips unchanged.
 *
 * Also collapses the separate footnote/endnote id spaces into one sequence,
 * which is the only way to guarantee `fn1` and `endnote1` cannot collide once
 * their prefixes are gone.
 *
 * Mutates in place. Safe to call on a document with no footnotes.
 */
export function renumberFootnotes(doc: MarkdownDocument): void {
  const index = new FootnoteIndex(doc);
  if (index.isEmpty) return;
  const renamed = new Map<string, string>();
  for (const fn of index.ordered()) renamed.set(fn.identifier, String(fn.number));
  // A no-op rename would still churn every node, so skip when nothing changes.
  if ([...renamed].every(([from, to]) => from === to)) return;

  const walk = (nodes: MarkdownNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'footnoteReference' || node.type === 'footnoteDefinition') {
        const next = renamed.get(node.identifier);
        if (next !== undefined) {
          node.identifier = next;
          // The label is the text a renderer prints; a stale one would show the
          // old invented id beside the new number.
          if ('label' in node && node.label !== undefined) node.label = next;
        }
      }
      if ('children' in node && Array.isArray(node.children)) walk(node.children as MarkdownNode[]);
    }
  };
  walk(doc.children as MarkdownNode[]);
}
