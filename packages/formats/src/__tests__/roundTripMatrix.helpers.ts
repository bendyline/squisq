import { expect } from 'vitest';
import type {
  MarkdownDocument,
  MarkdownNode,
  MarkdownBlockNode,
  MarkdownHeading,
} from '@bendyline/squisq/markdown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectText(node: unknown, out: string[]): void {
  if (!isRecord(node)) return;

  const maybeType = node.type;
  if (typeof maybeType === 'string') {
    if (maybeType === 'text' && typeof node.value === 'string') {
      out.push(node.value);
    }
    if ((maybeType === 'code' || maybeType === 'inlineCode') && typeof node.value === 'string') {
      out.push(node.value);
    }
    if (maybeType === 'link' && typeof node.url === 'string') {
      out.push(node.url);
    }
    if (maybeType === 'image') {
      if (typeof node.alt === 'string') out.push(node.alt);
      if (typeof node.url === 'string') out.push(node.url);
    }
  }

  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) collectText(child, out);
  }
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/[^a-z0-9%/.:\-\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(input: string): string {
  return normalizeText(input).replace(/\s+/g, '');
}

function extractDocumentText(doc: MarkdownDocument): string {
  const out: string[] = [];
  collectText(doc, out);
  return normalizeText(out.join(' '));
}

function extractHeadingTexts(doc: MarkdownDocument): string[] {
  return doc.children
    .filter((block): block is MarkdownHeading => block.type === 'heading')
    .map((heading) => {
      const out: string[] = [];
      collectText(heading, out);
      return normalizeText(out.join(' '));
    })
    .filter(Boolean);
}

function containsNodeType(node: unknown, wantedType: string): boolean {
  if (!isRecord(node)) return false;
  if (node.type === wantedType) return true;
  const children = node.children;
  if (!Array.isArray(children)) return false;
  return children.some((child) => containsNodeType(child, wantedType));
}

function retainRatio(source: string, roundTrip: string): number {
  const sourceTokens = source.split(' ').filter((t) => t.length >= 4);
  if (sourceTokens.length === 0) return 1;

  const targetSet = new Set(roundTrip.split(' ').filter((t) => t.length >= 4));
  let matched = 0;
  for (const token of sourceTokens) {
    if (targetSet.has(token)) matched++;
  }
  return matched / sourceTokens.length;
}

export interface HybridRoundTripAssertions {
  source: MarkdownDocument;
  roundTrip: MarkdownDocument;
  keyPhrases: string[];
  headingTexts?: string[];
  requireHeadingOrder?: boolean;
  requireListSurvival?: boolean;
  requireTableSurvival?: boolean;
  minRetainRatio?: number;
}

export function assertHybridRoundTrip(args: HybridRoundTripAssertions): void {
  const sourceText = extractDocumentText(args.source);
  const roundTripText = extractDocumentText(args.roundTrip);

  expect(roundTripText.length).toBeGreaterThan(0);

  const minRetainRatio = args.minRetainRatio ?? 0.5;
  expect(retainRatio(sourceText, roundTripText)).toBeGreaterThanOrEqual(minRetainRatio);

  for (const phrase of args.keyPhrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (roundTripText.includes(normalizedPhrase)) continue;
    expect(compactText(roundTripText)).toContain(compactText(normalizedPhrase));
  }

  if (args.requireHeadingOrder && args.headingTexts && args.headingTexts.length > 0) {
    const normalizedExpected = args.headingTexts.map((h) => normalizeText(h));
    const actualHeadings = extractHeadingTexts(args.roundTrip);

    let cursor = -1;
    for (const expectedHeading of normalizedExpected) {
      const next = actualHeadings.findIndex(
        (heading, index) => index > cursor && heading.includes(expectedHeading),
      );
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
  }

  if (args.requireListSurvival && containsNodeType(args.source, 'list')) {
    expect(containsNodeType(args.roundTrip, 'list')).toBe(true);
  }

  if (args.requireTableSurvival && containsNodeType(args.source, 'table')) {
    expect(containsNodeType(args.roundTrip, 'table')).toBe(true);
  }
}

export function extractNormalizedText(doc: MarkdownDocument): string {
  return extractDocumentText(doc);
}

export function docHasNodeType(doc: MarkdownDocument, wantedType: MarkdownNode['type']): boolean {
  return containsNodeType(doc, wantedType);
}

export function firstHeadingText(doc: MarkdownDocument): string | null {
  const firstHeading = doc.children.find(
    (block): block is MarkdownBlockNode & { type: 'heading' } => block.type === 'heading',
  );
  if (!firstHeading) return null;
  const out: string[] = [];
  collectText(firstHeading, out);
  return normalizeText(out.join(' '));
}
