/**
 * Markdown document validation.
 *
 * `validateMarkdownSource()` gives authors and agents fast, structural
 * feedback on a squisq markdown document — the same checks the renderer
 * applies, surfaced as diagnostics instead of degraded slides:
 *
 * - unknown template names (with a did-you-mean suggestion)
 * - `{[…]}` text that was not recognized as an annotation (bad quoting,
 *   non-heading placement, unknown inline icon)
 * - malformed heading-attribute values (`x=abc`, bad `startTime`)
 * - `connectsTo` targets that don't resolve, duplicate block ids,
 *   unparseable data fences (reported by `markdownToDoc`)
 * - image references missing from the provided asset set (.dbk contents)
 *
 * The CLI exposes this as `squisq validate <input>`; agents can also call
 * it directly and iterate until the diagnostics list is empty.
 */

import type { Doc, Block, DocDiagnostic } from '../schemas/Doc.js';
import type {
  MarkdownDocument,
  MarkdownHeading,
  MarkdownNode,
  HtmlNode,
} from '../markdown/types.js';
import { parseMarkdown } from '../markdown/parse.js';
import { getChildren, extractPlainText } from '../markdown/utils.js';
import { coerceAnnotationValues } from '../markdown/annotationCoercion.js';
import { markdownToDoc, flattenBlocks } from './markdownToDoc.js';
import { templateRegistry, TEMPLATE_ALIASES, resolveTemplateName } from './templates/index.js';

// ============================================
// Options & result
// ============================================

export interface ValidateOptions {
  /**
   * Known asset paths for image/video reference checks — typically the
   * file list of a .dbk container or the document's folder. Relative
   * references not present here produce a `missing-asset` warning.
   * When omitted, asset checks are skipped.
   */
  assets?: ReadonlySet<string> | ((path: string) => boolean);

  /**
   * Additional template names to accept beyond the built-in registry and
   * the document's own `customTemplates` (e.g. app-registered templates).
   */
  extraTemplates?: readonly string[];
}

export interface MarkdownValidationResult {
  /** All findings, in source order where line information exists. */
  diagnostics: DocDiagnostic[];
  errorCount: number;
  warningCount: number;
  /** The converted Doc (conversion diagnostics are included above). */
  doc: Doc;
}

// ============================================
// Entry points
// ============================================

/**
 * Validate a squisq markdown source string. Parses, converts (collecting
 * the conversion's own diagnostics), and runs the structural checks above.
 */
export function validateMarkdownSource(
  source: string,
  options?: ValidateOptions,
): MarkdownValidationResult {
  return validateMarkdownDoc(parseMarkdown(source), options);
}

/**
 * Validate an already-parsed MarkdownDocument. See {@link validateMarkdownSource}.
 */
export function validateMarkdownDoc(
  markdownDoc: MarkdownDocument,
  options?: ValidateOptions,
): MarkdownValidationResult {
  const doc = markdownToDoc(markdownDoc);
  const diagnostics: DocDiagnostic[] = [...(doc.diagnostics ?? [])];
  const blocks = flattenBlocks(doc.blocks);

  const knownTemplates = collectKnownTemplates(doc, options);

  for (const block of blocks) {
    checkTemplate(block, knownTemplates, diagnostics);
    checkAttributeCoercion(block, diagnostics);
  }

  checkUnrecognizedAnnotations(markdownDoc, diagnostics);

  if (options?.assets) {
    const hasAsset = normalizeAssetCheck(options.assets);
    checkAssets(markdownDoc, blocks, hasAsset, diagnostics);
  }

  diagnostics.sort(
    (a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    diagnostics,
    errorCount: diagnostics.filter((d) => d.severity === 'error').length,
    warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
    doc,
  };
}

// ============================================
// Template checks
// ============================================

function collectKnownTemplates(doc: Doc, options?: ValidateOptions): Set<string> {
  return new Set<string>([
    ...Object.keys(templateRegistry),
    ...Object.keys(TEMPLATE_ALIASES),
    ...(doc.customTemplates?.map((t) => t.name) ?? []),
    ...(options?.extraTemplates ?? []),
  ]);
}

function checkTemplate(block: Block, known: Set<string>, diagnostics: DocDiagnostic[]): void {
  const requested = block.sourceHeading?.templateAnnotation?.template;
  if (!requested) return;
  if (known.has(requested) || known.has(resolveTemplateName(requested))) return;

  const suggestion = nearestName(requested, known);
  diagnostics.push({
    severity: 'warning',
    code: 'unknown-template',
    message:
      `Unknown template "${requested}" — the block will render as a plain fallback card` +
      (suggestion ? `. Did you mean "${suggestion}"?` : ''),
    blockId: block.id,
    ...lineOf(block),
  });
}

/** Re-run heading-attribute coercion to surface its warnings with context. */
function checkAttributeCoercion(block: Block, diagnostics: DocDiagnostic[]): void {
  const params = block.sourceHeading?.attributes?.params;
  if (!params) return;
  const { warnings } = coerceAnnotationValues(params);
  for (const warning of warnings) {
    diagnostics.push({
      severity: 'warning',
      code: 'invalid-attribute',
      message: `Block "${block.id}": ${warning}`,
      blockId: block.id,
      ...lineOf(block),
    });
  }
}

// ============================================
// Unrecognized `{[…]}` text
// ============================================

const ANNOTATION_LIKE_RE = /\{\[/;

/**
 * Flag literal `{[` text that survived parsing. On a heading this usually
 * means broken quoting; in body content it usually means the author
 * expected list-item/paragraph annotations, which only headings support
 * (or referenced an unknown inline icon).
 */
function checkUnrecognizedAnnotations(
  markdownDoc: MarkdownDocument,
  diagnostics: DocDiagnostic[],
): void {
  const walk = (node: MarkdownNode, headingLine: number | undefined): void => {
    if (node.type === 'heading') {
      const heading = node as MarkdownHeading;
      const text = extractPlainText(heading);
      if (ANNOTATION_LIKE_RE.test(text)) {
        diagnostics.push({
          severity: 'warning',
          code: 'unparsed-annotation',
          message:
            `Heading "${truncate(text)}" contains "{[…]}" text that was not recognized — ` +
            `check the quoting, or whether the token is a known inline icon`,
          ...(heading.position ? { line: heading.position.start.line } : {}),
        });
      }
      return; // heading inline children already covered by extractPlainText
    }
    if (node.type === 'text' && ANNOTATION_LIKE_RE.test(node.value)) {
      diagnostics.push({
        severity: 'warning',
        code: 'unparsed-annotation',
        message:
          `Body text contains "{[…]}" — template annotations are only recognized on ` +
          `headings (or the token is not a known inline icon)`,
        ...(node.position
          ? { line: node.position.start.line }
          : headingLine != null
            ? { line: headingLine }
            : {}),
      });
      return;
    }
    if (node.type === 'code') return; // code blocks legitimately contain {[
    for (const child of getChildren(node)) {
      walk(child, headingLine);
    }
  };

  for (const child of markdownDoc.children) {
    walk(child, child.position?.start.line);
  }
}

// ============================================
// Asset checks
// ============================================

function normalizeAssetCheck(
  assets: ReadonlySet<string> | ((path: string) => boolean),
): (path: string) => boolean {
  if (typeof assets === 'function') return assets;
  return (path: string) => assets.has(path) || assets.has(path.replace(/^\.\//, ''));
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** A reference that should resolve inside the bundle: relative, no scheme. */
function isBundleRelative(url: string): boolean {
  return (
    url.length > 0 && !URL_SCHEME_RE.test(url) && !url.startsWith('//') && !url.startsWith('#')
  );
}

/** Template param keys whose values reference media assets. */
const ASSET_PARAM_KEYS = ['src', 'imageSrc', 'videoSrc', 'poster', 'backgroundImage'];

function checkAssets(
  markdownDoc: MarkdownDocument,
  blocks: Block[],
  hasAsset: (path: string) => boolean,
  diagnostics: DocDiagnostic[],
): void {
  const report = (url: string, line?: number, blockId?: string) => {
    if (!isBundleRelative(url) || hasAsset(url)) return;
    diagnostics.push({
      severity: 'warning',
      code: 'missing-asset',
      message: `Referenced asset "${url}" was not found in the bundle`,
      ...(blockId ? { blockId } : {}),
      ...(line != null ? { line } : {}),
    });
  };

  // Markdown image nodes + raw-HTML <img src>.
  const walk = (node: MarkdownNode): void => {
    if (node.type === 'image') {
      report(node.url, node.position?.start.line);
    }
    if (node.type === 'htmlBlock' || node.type === 'htmlInline') {
      walkHtmlImages(node.htmlChildren, (src) => report(src, node.position?.start.line));
    }
    for (const child of getChildren(node)) walk(child);
  };
  for (const child of markdownDoc.children) walk(child);

  // Media references in template params / structured data.
  for (const block of blocks) {
    const sources: Array<Record<string, unknown> | undefined> = [
      block.templateOverrides,
      block.templateData,
    ];
    for (const source of sources) {
      if (!source) continue;
      for (const key of ASSET_PARAM_KEYS) {
        const value = source[key];
        if (typeof value === 'string') {
          report(value, block.sourceHeading?.position?.start.line, block.id);
        }
      }
      const images = source['images'];
      const list =
        typeof images === 'string'
          ? images.split(',').map((s) => s.trim())
          : Array.isArray(images)
            ? images.filter((i): i is string => typeof i === 'string')
            : [];
      for (const img of list) {
        report(img, block.sourceHeading?.position?.start.line, block.id);
      }
    }
  }
}

function walkHtmlImages(nodes: HtmlNode[], report: (src: string) => void): void {
  for (const node of nodes) {
    if (node.type !== 'htmlElement') continue;
    if (node.tagName === 'img' && node.attributes.src) {
      report(node.attributes.src);
    }
    walkHtmlImages(node.children, report);
  }
}

// ============================================
// Did-you-mean
// ============================================

/**
 * Nearest known name by edit distance. Returns undefined when nothing is
 * plausibly close (distance > 2 and > 40% of the input length).
 */
function nearestName(input: string, candidates: Set<string>): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  const lower = input.toLowerCase();
  for (const candidate of candidates) {
    const dist = levenshtein(lower, candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  if (best && (bestDist <= 2 || bestDist <= Math.ceil(input.length * 0.4))) {
    return resolveTemplateName(best);
  }
  return undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ============================================
// Helpers
// ============================================

function lineOf(block: Block): { line: number } | Record<string, never> {
  const line = block.sourceHeading?.position?.start.line;
  return line != null ? { line } : {};
}

function truncate(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
