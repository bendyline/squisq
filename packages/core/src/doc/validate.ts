/**
 * Markdown document validation.
 *
 * `validateMarkdownSource()` gives authors and agents fast, structural
 * feedback on a squisq markdown document — the same checks the renderer
 * applies, surfaced as diagnostics instead of degraded slides:
 *
 * - unknown template names (with a did-you-mean suggestion)
 * - unknown drawing shapes, and shape annotations used outside a `{[drawing]}`
 * - `{[…]}` text that was not recognized as an annotation (bad quoting,
 *   non-heading placement, unknown inline icon)
 * - malformed heading-attribute values (`x=abc`, bad `startTime`) and
 *   non-numeric drawing-shape geometry
 * - `connectsTo` / drawing `from`/`to` targets that don't resolve,
 *   duplicate block ids, unparseable data fences (reported by `markdownToDoc`)
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
import { coerceAnnotationValues, KNOWN_BLOCK_META_KEYS } from '../markdown/annotationCoercion.js';
import { markdownToDoc, flattenBlocks } from './markdownToDoc.js';
import { parseStandaloneAnnotation } from './standaloneAnnotation.js';
import { isDataFence, parseDataFence } from './structuredData.js';
import { deriveTemplateInputs } from './templateInputs.js';
import { lintTemplateParams } from './templates/inputDescriptors.js';
import {
  templateRegistry,
  TEMPLATE_ALIASES,
  resolveTemplateName,
  isShapeName,
  normalizeShapeKind,
  SHAPE_NAMES,
} from './templates/index.js';
import { nearestName } from './utils/nearest.js';

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
  infoCount: number;
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
  // Custom template names are skipped by the input linter — they carry
  // arbitrary author-defined inputs the built-in descriptors can't know about.
  const customNames = new Set<string>(doc.customTemplates?.map((t) => t.name) ?? []);

  // Parent-aware walk: a `{[shape]}` annotation is only meaningful on the
  // direct child of a `{[drawing]}` block, so the template check needs each
  // block's parent. Drawing connectors are validated against their siblings.
  const visit = (block: Block, parent: Block | undefined): void => {
    checkTemplate(block, parent, knownTemplates, diagnostics);
    checkAttributeCoercion(block, parent, diagnostics);
    checkConflictingAnnotationKeys(block, diagnostics);
    checkTemplateInputs(block, parent, customNames, diagnostics);
    checkPossibleDataFences(block, diagnostics);
    if (isDrawingBlock(block)) checkDrawingConnectors(block, diagnostics);
    for (const child of block.children ?? []) visit(child, block);
  };
  for (const block of doc.blocks) visit(block, undefined);

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
    infoCount: diagnostics.filter((d) => d.severity === 'info').length,
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

/** True when `block` is a `{[drawing]}` container (after alias resolution). */
function isDrawingBlock(block: Block): boolean {
  return resolveTemplateName(block.template ?? '') === 'drawing';
}

function checkTemplate(
  block: Block,
  parent: Block | undefined,
  known: Set<string>,
  diagnostics: DocDiagnostic[],
): void {
  // Heading blocks carry the requested name on the heading annotation;
  // heading-less standalone blocks carry it on `sourceAnnotation` (raw,
  // un-resolved) — read whichever is present.
  const requested =
    block.sourceHeading?.templateAnnotation?.template ?? block.sourceAnnotation?.template;
  if (!requested) return;

  // Inside a drawing, the annotation names a shape primitive, not a template.
  if (parent && isDrawingBlock(parent)) {
    if (isShapeName(requested)) return;
    const suggestion = nearestName(requested, new Set(SHAPE_NAMES), {
      map: resolveTemplateName,
    });
    diagnostics.push({
      severity: 'warning',
      code: 'unknown-shape',
      message:
        `Unknown shape "${requested}" in drawing — the child will be skipped` +
        (suggestion ? `. Did you mean "${suggestion}"?` : ''),
      blockId: block.id,
      ...lineOf(block),
    });
    return;
  }

  // A shape annotation outside a drawing has no parent to interpret it.
  if (isShapeName(requested)) {
    diagnostics.push({
      severity: 'warning',
      code: 'shape-outside-drawing',
      message: `Shape "${requested}" is only recognized on a child heading of a {[drawing]} block`,
      blockId: block.id,
      ...lineOf(block),
    });
    return;
  }

  if (known.has(requested) || known.has(resolveTemplateName(requested))) return;

  const suggestion = nearestName(requested, known, { map: resolveTemplateName });
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

/**
 * Lint a template block's `{[…]}` inputs against the built-in input
 * descriptors: unknown keys (with a did-you-mean), values outside a closed
 * enum / that fail coercion, and missing required inputs. All are warnings.
 *
 * Only built-in templates with descriptors are checked — shapes, drawing
 * children, custom templates, and not-yet-described built-ins are skipped
 * (`lintTemplateParams` returns `[]` for the latter). A `missing-input`
 * finding is suppressed when the value is actually satisfiable from the
 * block's own fields, structured data, or body derivation.
 */
function checkTemplateInputs(
  block: Block,
  parent: Block | undefined,
  customNames: ReadonlySet<string>,
  diagnostics: DocDiagnostic[],
): void {
  const requested = block.sourceHeading?.templateAnnotation?.template;
  if (!requested) return;
  // Inside a drawing, the annotation names a shape primitive, not a template.
  if (parent && isDrawingBlock(parent)) return;
  if (isShapeName(requested)) return;

  const canonical = resolveTemplateName(requested);
  if (customNames.has(requested) || customNames.has(canonical)) return;

  const params = block.sourceHeading?.templateAnnotation?.params ?? {};
  for (const finding of lintTemplateParams(canonical, params)) {
    if (finding.kind === 'missing-input' && isInputSatisfiable(canonical, block, finding.key)) {
      continue;
    }
    diagnostics.push({
      severity: 'warning',
      code: finding.kind,
      message: `Block "${block.id}": ${finding.message}`,
      blockId: block.id,
      ...lineOf(block),
    });
  }
}

/**
 * Whether a required template input is satisfiable even though it's absent
 * from the `{[…]}` params: present in a structured-data fence, carried as a
 * block-level field (e.g. `title` from the heading), or derivable from the
 * heading + body (`deriveTemplateInputs` in strict mode).
 */
function isInputSatisfiable(canonical: string, block: Block, key: string): boolean {
  if (block.templateData && key in block.templateData) return true;
  if ((block as unknown as Record<string, unknown>)[key] != null) return true;
  const derived = deriveTemplateInputs(canonical, block.title ?? '', block.contents);
  return derived != null && key in derived;
}

/** Numeric geometry keys carried in a shape's `{[…]}` params. */
const NUMERIC_SHAPE_KEYS = ['x', 'y', 'width', 'height', 'w', 'h', 'strokeWidth', 'borderRadius'];

/** Re-run heading-attribute coercion to surface its warnings with context. */
function checkAttributeCoercion(
  block: Block,
  parent: Block | undefined,
  diagnostics: DocDiagnostic[],
): void {
  // Pandoc `{#id key=value}` params (x/y/connectsTo/startTime/duration).
  const params = block.sourceHeading?.attributes?.params;
  if (params) {
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

  // A drawing shape's geometry lives in its `{[shape …]}` params
  // (templateOverrides), not the Pandoc block — validate those numerics too.
  if (parent && isDrawingBlock(parent) && isShapeName(block.template)) {
    const overrides = block.templateOverrides ?? {};
    for (const key of NUMERIC_SHAPE_KEYS) {
      const raw = overrides[key];
      if (raw == null) continue;
      const value = raw.replace(/,\s*$/, '').trim();
      if (value !== '' && !Number.isFinite(Number(value))) {
        diagnostics.push({
          severity: 'warning',
          code: 'invalid-attribute',
          message: `Drawing shape "${block.id}": "${key}" is not a number (${JSON.stringify(raw)})`,
          blockId: block.id,
          ...lineOf(block),
        });
      }
    }
  }
}

/**
 * A heading can carry the same block-meta key in both the Pandoc `{k=v}`
 * block and the squiggly `{[tpl k=v]}` annotation. The Pandoc value wins
 * (same precedence as `makeBlock` in markdownToDoc), which is easy to miss
 * when the two disagree — surface an info diagnostic so the author knows
 * which value is in effect.
 */
function checkConflictingAnnotationKeys(block: Block, diagnostics: DocDiagnostic[]): void {
  const annotationParams = block.sourceHeading?.templateAnnotation?.params;
  const pandocParams = block.sourceHeading?.attributes?.params;
  if (!annotationParams || !pandocParams) return;

  for (const key of Object.keys(KNOWN_BLOCK_META_KEYS)) {
    const fromAnnotation = annotationParams[key];
    const fromPandoc = pandocParams[key];
    if (fromAnnotation == null || fromPandoc == null || fromAnnotation === fromPandoc) continue;
    diagnostics.push({
      severity: 'info',
      code: 'conflicting-annotation-key',
      message:
        `"${key}" is set in both {[…]} (${fromAnnotation}) and {…} (${fromPandoc}) — ` +
        `the {…} value wins.`,
      blockId: block.id,
      ...lineOf(block),
    });
  }
}

/**
 * A drawing's `line`/`arrow` connectors reference sibling shapes by id via
 * `from`/`to`; flag any that don't resolve (mirrors the `connectsTo`
 * unresolved-connection check, but for the `{[…]}` param form).
 */
function checkDrawingConnectors(block: Block, diagnostics: DocDiagnostic[]): void {
  const children = block.children ?? [];
  const ids = new Set(children.map((c) => c.id));
  for (const child of children) {
    const kind = normalizeShapeKind(child.sourceHeading?.templateAnnotation?.template);
    if (kind !== 'line' && kind !== 'arrow') continue;
    const overrides = child.templateOverrides ?? {};
    for (const key of ['from', 'to'] as const) {
      const raw = overrides[key];
      if (raw == null) continue;
      const ref = raw.replace(/,\s*$/, '').trim();
      if (ref && !ids.has(ref)) {
        diagnostics.push({
          severity: 'warning',
          code: 'unresolved-connection',
          message: `Drawing connector "${child.id}" references unknown ${key} "${ref}"`,
          blockId: child.id,
          ...lineOf(child),
        });
      }
    }
  }
}

/**
 * A plain ```json / ```yaml fence (no `data` marker) inside a template-
 * annotated block, whose content parses as a top-level object, is almost
 * certainly meant as template input — surface an info nudge to add the
 * `data` marker. Deliberately scoped to *annotated* blocks so ordinary code
 * samples in prose sections never trigger it.
 */
function checkPossibleDataFences(block: Block, diagnostics: DocDiagnostic[]): void {
  const annotated = !!(
    block.sourceHeading?.templateAnnotation?.template || block.sourceAnnotation?.template
  );
  if (!annotated) return;

  for (const node of block.contents ?? []) {
    if (node.type !== 'code') continue;
    const lang = node.lang?.toLowerCase();
    if (lang !== 'json' && lang !== 'yaml' && lang !== 'yml') continue;
    if (isDataFence(node)) continue; // already a data fence — nothing to nudge

    const result = parseDataFence(node);
    if (!result.data || Object.keys(result.data).length === 0) continue;

    diagnostics.push({
      severity: 'info',
      code: 'possible-data-fence',
      message:
        `This ${lang} block renders as code — add "data" to the fence ` +
        `(\`\`\`${lang} data) if it's meant as template input.`,
      blockId: block.id,
      ...(node.position ? { line: node.position.start.line } : lineOf(block)),
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
  const walk = (node: MarkdownNode, headingLine: number | undefined, topLevel: boolean): void => {
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
    // A *top-level* paragraph that is exactly a `{[templateName …]}` /
    // `{[audio …]}` annotation is recognized (it becomes a standalone template
    // block or a media clip) — don't flag it, and don't descend into its text.
    // Nested paragraphs (inside a list / blockquote) are NOT extracted, so
    // they still warn.
    if (node.type === 'paragraph' && topLevel) {
      const parsed = parseStandaloneAnnotation(node);
      if (parsed && parsed.template != null) return;
    }
    if (node.type === 'text' && ANNOTATION_LIKE_RE.test(node.value)) {
      diagnostics.push({
        severity: 'warning',
        code: 'unparsed-annotation',
        message:
          `Body text contains "{[…]}" — template annotations are recognized on headings ` +
          `and as standalone paragraphs (or the token is not a known inline icon)`,
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
      walk(child, headingLine, false);
    }
  };

  for (const child of markdownDoc.children) {
    walk(child, child.position?.start.line, true);
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
// Helpers
// ============================================

function lineOf(block: Block): { line: number } | Record<string, never> {
  const line = block.sourceHeading?.position?.start.line;
  return line != null ? { line } : {};
}

function truncate(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
