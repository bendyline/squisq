/**
 * Block template recommendations.
 *
 * Given a slice of markdown block nodes (the body underneath a heading),
 * profile the content for image / video / quote / list / table / date /
 * stat signals, then map that profile to the set of templates that make
 * sense for the block. Used by the editor's template picker to surface a
 * "Recommended for this block" section above the full template list.
 */

import { extractPlainText, findNodesByType, walkMarkdownTree } from '../markdown/utils.js';
import type {
  HtmlElement,
  HtmlNode,
  MarkdownBlockNode,
  MarkdownCodeBlock,
  MarkdownHtmlBlock,
  MarkdownNode,
} from '../markdown/types.js';
import {
  detectAsciiDiagram,
  isEligibleAsciiFenceLang,
  isExplicitDiagramLang,
} from '../doc/asciiDiagram/detect.js';
import {
  detectAsciiTimeline,
  isEligibleAsciiTimelineFenceLang,
  isExplicitTimelineLang,
} from '../doc/asciiTimeline/detect.js';
import { detectTree, isEligibleTreeFenceLang, isExplicitTreeLang } from '../doc/treeview/detect.js';
import { matchNumberHighlight } from './numberHighlight.js';

export interface BlockContentProfile {
  hasImage: boolean;
  imageCount: number;
  hasVideo: boolean;
  hasBlockquote: boolean;
  hasList: boolean;
  hasTable: boolean;
  hasDate: boolean;
  hasNumberHighlight: boolean;
  wordCount: number;
  /**
   * True when the body is dominated by exactly one code fence whose content
   * is an ASCII box-and-line diagram (see `doc/asciiDiagram/detect.ts`).
   * Optional so externally-constructed profiles keep compiling.
   */
  hasAsciiDiagram?: boolean;
  /** True when a dominant code fence is an authored marker+axis timeline. */
  hasTimeline?: boolean;
  /**
   * True when the body is dominated by exactly one code fence whose content
   * is an ASCII file-tree / outline (see `doc/treeview/detect.ts`). Mutually
   * exclusive with `hasAsciiDiagram`.
   */
  hasTree?: boolean;
}

export interface RecommendationResult {
  recommended: string[];
  rest: string[];
}

const EMPTY_PROFILE: BlockContentProfile = Object.freeze({
  hasImage: false,
  imageCount: 0,
  hasVideo: false,
  hasBlockquote: false,
  hasList: false,
  hasTable: false,
  hasDate: false,
  hasNumberHighlight: false,
  wordCount: 0,
});

const DATE_PATTERNS: RegExp[] = [
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2},?\s+)?\d{4}\b/i,
  /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\bQ[1-4]\s+\d{4}\b/,
  /\b\d{4}s\b/,
  /\b\d{1,2}(st|nd|rd|th)\s+century\b/i,
];

const VIDEO_HOST_RE = /(youtube\.com|youtu\.be|vimeo\.com|wistia\.|loom\.com)/i;

function htmlElementsByTag(root: MarkdownNode, tagNames: Set<string>): HtmlElement[] {
  const blocks = findNodesByType<MarkdownHtmlBlock>(root, 'htmlBlock');
  // Inline HTML (htmlInline) also carries htmlChildren; include both.
  const inline = findNodesByType<MarkdownNode>(root, 'htmlInline') as Array<
    MarkdownNode & { htmlChildren?: HtmlNode[] }
  >;
  const out: HtmlElement[] = [];
  const visit = (n: HtmlNode): void => {
    if (n.type === 'htmlElement') {
      if (tagNames.has(n.tagName.toLowerCase())) out.push(n);
      for (const c of n.children) visit(c);
    }
  };
  for (const b of blocks) for (const c of b.htmlChildren) visit(c);
  for (const i of inline) {
    if (Array.isArray(i.htmlChildren)) for (const c of i.htmlChildren) visit(c);
  }
  return out;
}

/**
 * Walk a slice of block nodes and summarize what kinds of content it
 * contains. Cheap to run — no markdown parsing, just AST traversal.
 */
export function profileBlockContents(nodes: MarkdownBlockNode[]): BlockContentProfile {
  if (!nodes || nodes.length === 0) return { ...EMPTY_PROFILE };

  let imageCount = 0;
  let hasBlockquote = false;
  let hasList = false;
  let hasTable = false;

  const plainParts: string[] = [];

  for (const node of nodes) {
    imageCount += findNodesByType(node, 'image').length;
    imageCount += findNodesByType(node, 'imageReference').length;
    if (findNodesByType(node, 'blockquote').length > 0) hasBlockquote = true;
    if (findNodesByType(node, 'list').length > 0) hasList = true;
    if (findNodesByType(node, 'table').length > 0) hasTable = true;
    plainParts.push(extractPlainText(node));
  }

  // HTML embeds: <img>, <video>, <iframe src=…video host>
  const root: MarkdownNode = { type: 'document', children: nodes };
  const imgTags = htmlElementsByTag(root, new Set(['img']));
  imageCount += imgTags.length;

  const videoTags = htmlElementsByTag(root, new Set(['video', 'iframe', 'source']));
  let hasVideo = false;
  for (const el of videoTags) {
    if (el.tagName.toLowerCase() === 'video') {
      hasVideo = true;
      break;
    }
    const src = el.attributes.src || el.attributes.href || '';
    if (VIDEO_HOST_RE.test(src)) {
      hasVideo = true;
      break;
    }
  }

  // Link-only video embeds (markdown link to a known video host).
  if (!hasVideo) {
    const links = findNodesByType<MarkdownNode & { url?: string }>(root, 'link');
    for (const link of links) {
      if (link.url && VIDEO_HOST_RE.test(link.url)) {
        hasVideo = true;
        break;
      }
    }
  }

  const plainText = plainParts.join(' ').trim();
  const wordCount = plainText ? plainText.split(/\s+/).length : 0;

  let hasDate = false;
  for (const re of DATE_PATTERNS) {
    if (re.test(plainText)) {
      hasDate = true;
      break;
    }
  }

  // Number highlight: a paragraph that's mostly a single prominent figure.
  let hasNumberHighlight = false;
  walkMarkdownTree(root, (n) => {
    if (hasNumberHighlight) return true;
    if (n.type !== 'paragraph') return;
    const text = extractPlainText(n).trim();
    if (!text) return true;
    const m = matchNumberHighlight(text);
    if (!m) return true;
    // Paragraph qualifies when its word count is small AND a prominent
    // number occupies a meaningful chunk of it. Keeps "the company grew
    // 50% last year" from triggering, but accepts "$2.3M raised".
    const words = text.split(/\s+/).length;
    if (words <= 8) hasNumberHighlight = true;
    return true;
  });

  // ASCII diagram: exactly one code fence with an eligible (inert) language
  // whose content detects as box-and-line art, in a body it dominates — no
  // competing table/image/video signal and at most a little surrounding
  // prose. The diagram template replaces the whole slide, so hiding a real
  // table or a second fence is the costly failure this guards against.
  let hasAsciiDiagram = false;
  const codeNodes: MarkdownCodeBlock[] = [];
  for (const node of nodes) codeNodes.push(...findNodesByType<MarkdownCodeBlock>(node, 'code'));
  if (
    codeNodes.length === 1 &&
    isEligibleAsciiFenceLang(codeNodes[0].lang) &&
    !hasTable &&
    imageCount === 0 &&
    !hasVideo
  ) {
    const nonCodeChars = Math.max(0, plainText.length - codeNodes[0].value.length);
    const explicit = isExplicitDiagramLang(codeNodes[0].lang);
    if (nonCodeChars <= 400 && detectAsciiDiagram(codeNodes[0].value, { explicit }).isDiagram) {
      hasAsciiDiagram = true;
    }
  }

  // ASCII timeline: after the more specific closed-box diagram gate and
  // before tree connector detection.
  let hasTimeline = false;
  if (
    !hasAsciiDiagram &&
    codeNodes.length === 1 &&
    isEligibleAsciiTimelineFenceLang(codeNodes[0].lang) &&
    !hasTable &&
    imageCount === 0 &&
    !hasVideo
  ) {
    const nonCodeChars = Math.max(0, plainText.length - codeNodes[0].value.length);
    const explicit = isExplicitTimelineLang(codeNodes[0].lang);
    if (nonCodeChars <= 400 && detectAsciiTimeline(codeNodes[0].value, { explicit }).isTimeline) {
      hasTimeline = true;
    }
  }

  // Tree detection comes last: timeline callout elbows can otherwise look
  // like connector branches to the deliberately lenient tree parser.
  let hasTree = false;
  if (
    !hasAsciiDiagram &&
    !hasTimeline &&
    codeNodes.length === 1 &&
    isEligibleTreeFenceLang(codeNodes[0].lang) &&
    !hasTable &&
    imageCount === 0 &&
    !hasVideo
  ) {
    const nonCodeChars = Math.max(0, plainText.length - codeNodes[0].value.length);
    const explicit = isExplicitTreeLang(codeNodes[0].lang);
    if (nonCodeChars <= 400 && detectTree(codeNodes[0].value, { explicit }).isTree) {
      hasTree = true;
    }
  }

  return {
    hasImage: imageCount > 0,
    imageCount,
    hasVideo,
    hasBlockquote,
    hasList,
    hasTable,
    hasDate,
    hasNumberHighlight,
    wordCount,
    hasAsciiDiagram,
    hasTimeline,
    hasTree,
  };
}

// ── Recommendation rules ───────────────────────────────────────────

const UNIVERSAL_DEFAULTS = ['title', 'sectionHeader', 'factCard', 'twoColumn'];

/**
 * Given a content profile, return the canonical template-name list that
 * should appear in the "Recommended" bucket. Caller is responsible for
 * preserving deduplication / ordering when intersecting with the full
 * template list (see {@link recommendTemplatesForBlock}).
 */
function recommendedNamesForProfile(profile: BlockContentProfile): string[] {
  const names = new Set<string>();
  let anyContentSignal = false;

  if (profile.hasAsciiDiagram) {
    anyContentSignal = true;
    names.add('diagram');
  }

  if (profile.hasTimeline) {
    anyContentSignal = true;
    names.add('timeline');
  }

  if (profile.hasTree) {
    anyContentSignal = true;
    names.add('tree');
  }

  if (profile.hasImage) {
    anyContentSignal = true;
    names.add('imageWithCaption');
    names.add('leftFeature');
    names.add('rightFeature');
    if (profile.imageCount >= 2) names.add('photoGrid');
  }

  if (profile.hasVideo) {
    anyContentSignal = true;
    names.add('videoWithCaption');
    if (profile.hasBlockquote) names.add('videoPullQuote');
  }

  if (profile.hasBlockquote) {
    anyContentSignal = true;
    names.add('quote');
    names.add('pullQuote');
    names.add('fullBleedQuote');
  }

  if (profile.hasList) {
    anyContentSignal = true;
    names.add('list');
  }

  if (profile.hasTable) {
    anyContentSignal = true;
    names.add('dataTable');
    names.add('comparisonBar');
    // Chart family: recommend the four primary kinds (donut/area/scatter
    // stay findable in the full gallery without flooding the recommended set).
    names.add('columnChart');
    names.add('barChart');
    names.add('lineChart');
    names.add('pieChart');
  }

  if (profile.hasDate) {
    anyContentSignal = true;
    names.add('dateEvent');
  }

  if (profile.hasNumberHighlight) {
    anyContentSignal = true;
    names.add('statHighlight');
  }

  if (anyContentSignal) {
    // Universal pair only — keep recommended focused.
    names.add('title');
    names.add('sectionHeader');
  } else {
    for (const n of UNIVERSAL_DEFAULTS) names.add(n);
  }

  return Array.from(names);
}

/**
 * Deterministic single-template choice for an unannotated heading block,
 * from strong content signals only. Returns `undefined` when no signal is
 * decisive — the caller keeps its structural default (`sectionHeader`).
 *
 * Precedence favors the most specific/structured content: a table beats
 * a video beats an image beats a blockquote beats a stat-looking line. `blockIndex`
 * alternates left/right feature composition for single-image blocks so a
 * run of image sections doesn't stack the same layout.
 *
 * Used by `markdownToDoc`'s auto template picking (see its `autoTemplates`
 * option); the multi-candidate `recommendTemplatesForBlock` below serves
 * the editor's template-picker UI instead.
 */
export function pickAutoTemplate(profile: BlockContentProfile, blockIndex = 0): string | undefined {
  if (profile.hasAsciiDiagram) return 'diagram';
  if (profile.hasTimeline) return 'timeline';
  if (profile.hasTree) return 'tree';
  if (profile.hasTable) return 'dataTable';
  if (profile.hasVideo) return 'videoWithCaption';
  if (profile.imageCount >= 2) return 'photoGrid';
  if (profile.hasImage) return blockIndex % 2 === 0 ? 'leftFeature' : 'rightFeature';
  if (profile.hasBlockquote) return 'quote';
  if (profile.hasNumberHighlight) return 'statHighlight';
  if (profile.hasList) return 'list';
  return undefined;
}

/**
 * Split a flat list of template names into a "Recommended" bucket
 * (matches the active block's content profile) and a "rest" bucket
 * (everything else). Both buckets preserve the input ordering of
 * `allNames`, so the visual layout stays predictable as templates are
 * added.
 */
export function recommendTemplatesForBlock(
  profile: BlockContentProfile,
  allNames: readonly string[],
): RecommendationResult {
  const desired = new Set(recommendedNamesForProfile(profile));
  const recommended: string[] = [];
  const rest: string[] = [];
  for (const name of allNames) {
    if (desired.has(name)) recommended.push(name);
    else rest.push(name);
  }
  return { recommended, rest };
}
