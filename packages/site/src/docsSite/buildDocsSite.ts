/**
 * Documentation site build.
 *
 * Turns the Markdown under `docs/` into the static documentation published at
 * `/docs/` beside the demo editor. It is built with Squisq itself:
 *
 * - every page is rendered by `markdownDocToPlainHtmlParts` and placed into
 *   `docs/_theme/page.html` by `applyHtmlPageTemplate` — the same HTML page
 *   template feature the docs describe;
 * - every ` ```markdown preview ` fence becomes a live example the standalone
 *   player renders from a Doc built here with `markdownToDoc` +
 *   `buildPreviewDoc`, the projection the editor's preview uses;
 * - reference tables (template parameters, block settings, themes) are
 *   generated from core's catalogs.
 *
 * The build is pure: it reads through a {@link DocsFileSource} and returns the
 * output files, so the Vite plugin (dev server + production build) and the
 * unit tests share one implementation. Problems — broken links, missing
 * anchors, examples that fail to convert — are collected, never thrown.
 */

import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownBlockNode, MarkdownDocument } from '@bendyline/squisq/markdown';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import type { Doc } from '@bendyline/squisq/schemas';
import { applyHtmlPageTemplate, markdownDocToPlainHtmlParts } from '@bendyline/squisq-formats/html';
import { encodeSharedMarkdown } from '../sharedMarkdown.ts';
import { escapeHtml, highlightEscapedCode } from './highlight.ts';
import {
  asLoose,
  collectHeadings,
  collectImageUrls,
  collectLinkUrls,
  declaredNames,
  githubSlug,
  plainText,
  proseText,
  Slugger,
  walk,
  type LooseNode,
} from './markdownTools.ts';
import {
  blockSettingsMarkdown,
  bodyPolicySummary,
  groupedTemplateIds,
  templateDescription,
  templateIds,
  templateLabel,
  templateListMarkdown,
  templateParamsMarkdown,
  themeChoices,
  themeListMarkdown,
} from './generated.ts';

// ── Public types ───────────────────────────────────────────────────

/** Read access to the repository, by repo-relative POSIX path. */
export interface DocsFileSource {
  readText(path: string): string | null;
  readBinary(path: string): Uint8Array | null;
  /** Whether a file or directory exists. */
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  /** Every file under a directory, as repo-relative paths. */
  listFiles(dir: string): string[];
}

export interface BuildDocsSiteOptions {
  source: DocsFileSource;
  /** Repo-relative documentation root. Default `docs`. */
  docsRoot?: string;
  /** The standalone player IIFE (`PLAYER_BUNDLE`); live examples need it. */
  playerScript?: string;
  /** Where unpublished repository files are linked. */
  repoUrl?: string;
  /** The site's base path, for example images the editor opens. Default `/`. */
  siteBase?: string;
}

export interface DocsProblem {
  page: string;
  message: string;
}

export interface DocsPageInfo {
  /** Output path under the docs output directory, e.g. `guide/tags.html`. */
  path: string;
  title: string;
  source: string;
  tab: string | null;
  previews: number;
}

export interface DocsSiteBuild {
  /** Output files keyed by path under the docs output directory. */
  files: Map<string, string | Uint8Array>;
  pages: DocsPageInfo[];
  problems: DocsProblem[];
}

// ── Navigation manifest (docs/_theme/nav.json) ─────────────────────

type NavPageRef = string | { path: string; label?: string };

type NavSectionSpec =
  | { title: string; pages: NavPageRef[] }
  | { generate: 'blocks' }
  | { title: string; split: string; dir: string };

interface NavManifest {
  title: string;
  home: string;
  tabs: Array<{ id: string; label: string; sections: NavSectionSpec[] }>;
}

// ── Internal model ─────────────────────────────────────────────────

interface Page {
  /** Output path, e.g. `guide/tags.html`. */
  out: string;
  /** Repo-relative source file. Split pages share their source. */
  source: string;
  doc: MarkdownDocument;
  title: string;
  navLabel: string;
  description: string;
  tab: string | null;
  section: string;
  /** Built-in template id this page documents (block gallery pages). */
  template?: string;
  anchors: Set<string>;
  kind: 'home' | 'page' | 'block' | 'api';
  /** Generated HTML spliced in at `@@squisq-docs-html-N@@` placeholders. */
  html: Array<{ name: string; arg?: string }>;
  previews: Preview[];
  /** Template id → index in {@link previews} of its gallery thumbnail. */
  thumbs: Map<string, number>;
}

interface NavTab {
  id: string;
  label: string;
  sections: Array<{ title: string; pages: Page[] }>;
}

interface Preview {
  mode: 'slideshow' | 'page' | 'dashboard';
  doc: Doc;
  images: Record<string, string>;
  aspect: (typeof ASPECTS)[string];
  /** The snippet as the editor opens it. */
  editor: string;
}

const DEFAULT_REPO_URL = 'https://github.com/bendyline/squisq';
const THEME_DIR = '_theme';
const IMAGE_DIR = 'images';
/** Stands in for the relative path to the site root; resolved per page. */
const ROOT_PLACEHOLDER = 'squisq-docs-root:/';
const GENERATED_FENCE = 'squisq-docs';
const PREVIEW_LANGS = new Set(['markdown', 'md']);
const PREVIEW_MODES = new Set(['slideshow', 'page', 'dashboard']);
/** Stage shapes: the CSS aspect ratio and the viewport the player composes for. */
const ASPECTS: Record<string, { css: string; width: number; height: number }> = {
  landscape: { css: '16 / 9', width: 1920, height: 1080 },
  portrait: { css: '9 / 16', width: 1080, height: 1920 },
  square: { css: '1 / 1', width: 1080, height: 1080 },
  tall: { css: '4 / 5', width: 1080, height: 1350 },
};

// ── Path helpers ───────────────────────────────────────────────────

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

/** Resolve `relative` against directory `base`; null when it climbs out of the repo. */
function joinPath(base: string, relative: string): string | null {
  const parts = base ? base.split('/') : [];
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(segment);
  }
  return parts.join('/');
}

/** Relative URL from output page `from` to output file `to`. */
function relativeHref(from: string, to: string): string {
  const fromParts = dirname(from).split('/').filter(Boolean);
  const toParts = to.split('/');
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }
  return [...fromParts.slice(common).map(() => '..'), ...toParts.slice(common)].join('/');
}

/** Relative prefix from an output page to the site root (the folder above `docs/`). */
function siteRootPrefix(out: string): string {
  return '../'.repeat(out.split('/').length);
}

function isExternal(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

function splitFragment(url: string): [path: string, fragment: string] {
  const hash = url.indexOf('#');
  const withoutHash = hash < 0 ? url : url.slice(0, hash);
  const query = withoutHash.indexOf('?');
  return [
    query < 0 ? withoutHash : withoutHash.slice(0, query),
    hash < 0 ? '' : url.slice(hash + 1),
  ];
}

// ── Build ──────────────────────────────────────────────────────────

export function buildDocsSite(options: BuildDocsSiteOptions): DocsSiteBuild {
  const { source, playerScript } = options;
  const docsRoot = options.docsRoot ?? 'docs';
  const repoUrl = (options.repoUrl ?? DEFAULT_REPO_URL).replace(/\/$/, '');
  const siteBase = options.siteBase ?? '/';
  const files = new Map<string, string | Uint8Array>();
  const problems: DocsProblem[] = [];
  const problem = (page: string, message: string) => problems.push({ page, message });

  const manifestText = source.readText(`${docsRoot}/${THEME_DIR}/nav.json`);
  const template = source.readText(`${docsRoot}/${THEME_DIR}/page.html`);
  if (!manifestText || !template) {
    problem(THEME_DIR, `missing ${THEME_DIR}/nav.json or ${THEME_DIR}/page.html`);
    return { files, pages: [], problems };
  }
  const manifest = JSON.parse(manifestText) as NavManifest;

  const pages: Page[] = [];
  const pagesBySource = new Map<string, Page>();
  /** Split sources: heading id → the page holding it, plus the overview page. */
  const splitAnchors = new Map<string, Map<string, Page>>();
  const splitIndex = new Map<string, Page>();
  const copiedAssets = new Set<string>();
  /** Pages whose author placed the parameter table themselves. */
  const placedParams = new Set<Page>();

  const newPage = (fields: Omit<Page, 'anchors' | 'html' | 'previews' | 'thumbs'>): Page => {
    const page: Page = { ...fields, anchors: new Set(), html: [], previews: [], thumbs: new Map() };
    pages.push(page);
    return page;
  };

  const loadPage = (
    repoPath: string,
    tab: string | null,
    section: string,
    label?: string,
  ): Page | null => {
    const existing = pagesBySource.get(repoPath);
    if (existing) return existing;
    const text = source.readText(repoPath);
    if (text === null) {
      problem(repoPath, 'listed in nav.json but the file does not exist');
      return null;
    }
    const doc = parseDocsMarkdown(text);
    const h1 = collectHeadings(asLoose(doc)).find((heading) => heading.depth === 1);
    const frontmatter = (doc.frontmatter ?? {}) as Record<string, unknown>;
    const text_ = (key: string) =>
      typeof frontmatter[key] === 'string' ? (frontmatter[key] as string) : '';
    const title = text_('title') || plainText(h1) || repoPath.split('/').pop()!;
    const templateId = text_('template') || undefined;
    const page = newPage({
      out: repoPath.slice(docsRoot.length + 1).replace(/\.md$/i, '.html'),
      source: repoPath,
      doc,
      title,
      navLabel: label ?? (text_('nav') || title),
      description: text_('description'),
      tab,
      section,
      template: templateId,
      kind: tab === null ? 'home' : templateId ? 'block' : 'page',
    });
    pagesBySource.set(repoPath, page);
    return page;
  };

  // ── Navigation ───────────────────────────────────────────────────

  const homePage = loadPage(`${docsRoot}/${manifest.home}`, null, '');
  const tabs: NavTab[] = manifest.tabs.map((tabSpec) => {
    const sections: NavTab['sections'] = [];
    for (const spec of tabSpec.sections) {
      if ('generate' in spec) {
        for (const group of groupedTemplateIds()) {
          const groupPages = group.ids.map((id) =>
            loadPage(`${docsRoot}/blocks/${id}.md`, tabSpec.id, group.title, templateLabel(id)),
          );
          sections.push({ title: group.title, pages: groupPages.filter(isPage) });
        }
      } else if ('split' in spec) {
        const split = splitReference(`${docsRoot}/${spec.split}`, spec.dir, tabSpec.id, spec.title);
        sections.push({ title: spec.title, pages: split });
      } else {
        const sectionPages = spec.pages.map((ref) =>
          typeof ref === 'string'
            ? loadPage(`${docsRoot}/${ref}`, tabSpec.id, spec.title)
            : loadPage(`${docsRoot}/${ref.path}`, tabSpec.id, spec.title, ref.label),
        );
        sections.push({ title: spec.title, pages: sectionPages.filter(isPage) });
      }
    }
    return { id: tabSpec.id, label: tabSpec.label, sections };
  });
  const tabPages = (tab: NavTab) => tab.sections.flatMap((section) => section.pages);
  const pageOrder = [homePage, ...tabs.flatMap(tabPages)].filter(isPage);

  for (const id of templateIds()) {
    if (!pagesBySource.has(`${docsRoot}/blocks/${id}.md`)) {
      problem(`blocks/${id}.md`, `template "${id}" has no gallery page`);
    }
  }

  // ── Passes: generated content, heading ids, previews ─────────────

  for (const page of pages) expandGeneratedFences(page);

  for (const page of pages) {
    const slugger = new Slugger();
    for (const heading of collectHeadings(asLoose(page.doc))) {
      // Docs pages document tags; they are not slides.
      delete heading.templateAnnotation;
      const explicit = heading.attributes?.id;
      const id =
        page.kind === 'api' && explicit
          ? explicit
          : explicit
            ? slugger.claim(explicit)
            : slugger.slug(plainText(heading));
      heading.attributes = { ...heading.attributes, id };
      page.anchors.add(id);
    }
  }

  for (const page of pages) extractPreviews(page);
  for (const page of pages) {
    if (!page.html.some((entry) => entry.name === 'block-cards')) continue;
    // Gallery thumbnails reuse each block page's first example.
    for (const id of templateIds()) {
      const example = pagesBySource.get(`${docsRoot}/blocks/${id}.md`)?.previews[0];
      if (!example) continue;
      page.thumbs.set(id, page.previews.length);
      page.previews.push({ ...example, images: rebaseImages(example.images, page) });
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  const searchEntries: unknown[] = [];
  const pageInfos: DocsPageInfo[] = [];

  for (const page of pages) {
    const tab = tabs.find((candidate) => candidate.id === page.tab) ?? null;
    const parts = markdownDocToPlainHtmlParts(page.doc, {
      title: page.title,
      links: resolveLinks(page),
      images: resolveImages(page),
      htmlPolicy: 'sanitize',
      externalResources: 'deny',
    });
    const body = decorateBody(parts.bodyHtml, page)
      .replace(/<p>@@squisq-docs-preview-(\d+)@@<\/p>/g, (_match, index: string) =>
        previewFigure(page.previews[Number(index)], Number(index)),
      )
      .replace(/<p>@@squisq-docs-html-(\d+)@@<\/p>/g, (_match, index: string) =>
        generatedHtml(page, Number(index)),
      );

    const article = [
      `<article class="sq-article" data-kind="${page.kind}">`,
      breadcrumb(page),
      body,
      pager(page),
      `</article>`,
      page.previews.length > 0 ? previewData(page) : '',
    ].join('\n');

    const html = applyHtmlPageTemplate(
      template,
      {
        bodyHtml: article,
        headHtml: parts.featureHeadHtml,
        title: page.kind === 'home' ? manifest.title : `${page.title} · ${manifest.title}`,
        values: { description: page.description || descriptionFallback(page) },
      },
      { templatePath: `${THEME_DIR}/page.html`, outputPath: page.out },
    )
      .replace('<!--docs:tabs-->', tabsHtml(page))
      .replace('<!--docs:sidebar-->', tab ? sidebarHtml(page, tab) : '')
      .replace('<!--docs:toc-->', tocHtml(page))
      .replace('__DOCS_LAYOUT__', tab ? 'sq-layout--nav' : 'sq-layout--home')
      .split(ROOT_PLACEHOLDER)
      .join(siteRootPrefix(page.out));
    files.set(page.out, html);

    searchEntries.push(searchEntry(page));
    pageInfos.push({
      path: page.out,
      title: page.title,
      source: page.source,
      tab: page.tab,
      previews: page.previews.length,
    });
  }

  // ── Assets ───────────────────────────────────────────────────────

  for (const path of source.listFiles(`${docsRoot}/${THEME_DIR}`)) {
    const name = path.slice(docsRoot.length + 1);
    if (/\.(?:html|md)$/.test(name) || name.endsWith('nav.json')) continue;
    const text = source.readText(path);
    if (text !== null) files.set(name, text);
  }
  for (const asset of copiedAssets) {
    const bytes = source.readBinary(asset);
    if (bytes) files.set(asset.slice(docsRoot.length + 1), bytes);
  }
  if (playerScript) files.set(`${THEME_DIR}/squisq-player.js`, playerScript);
  files.set(`${THEME_DIR}/search-index.json`, JSON.stringify(searchEntries));

  return { files, pages: pageInfos, problems };

  // ── Split reference: one source file → one page per H2 ───────────

  function splitReference(repoPath: string, dir: string, tab: string, section: string): Page[] {
    const text = source.readText(repoPath);
    if (text === null) {
      problem(repoPath, 'split source does not exist');
      return [];
    }
    const whole = parseDocsMarkdown(text);
    // Slug the whole file at once so ids match the anchors GitHub gives it.
    const slugger = new Slugger();
    for (const heading of collectHeadings(asLoose(whole))) {
      const explicit = heading.attributes?.id;
      const id = explicit ? slugger.claim(explicit) : slugger.slug(plainText(heading));
      heading.attributes = { ...heading.attributes, id };
    }

    const children = whole.children;
    const starts = children
      .map((node, index) => ({ node: asLoose(node), index }))
      .filter(({ node }) => node.type === 'heading' && node.depth === 2);
    const intro = children.slice(0, starts[0]?.index ?? children.length);
    const anchors = new Map<string, Page>();
    const packagePages: Page[] = [];
    const packageList: string[] = [];

    starts.forEach(({ node, index }, i) => {
      const title = plainText(node);
      if (/^table of contents$/i.test(title)) return;
      const nodes = children.slice(index, starts[i + 1]?.index ?? children.length);
      // Each section's own H2 becomes its page's H1.
      for (const child of nodes) {
        walk({ type: 'root', children: [asLoose(child)] }, (descendant) => {
          if (descendant.type === 'heading' && descendant.depth) {
            descendant.depth = Math.max(1, descendant.depth - 1);
          }
        });
      }
      const packageName = (node.children ?? []).find(
        (child) => child.type === 'inlineCode' && child.value?.startsWith('@'),
      )?.value;
      const slug = packageName ? packageName.replace(/^@[^/]+\//, '') : githubSlug(title);
      const summary = plainText(nodes.map(asLoose).find((child) => child.type === 'paragraph'));
      const description = summary.length > 220 ? `${summary.slice(0, 217)}…` : summary;
      const page = newPage({
        out: `${dir}/${slug}.html`,
        source: repoPath,
        doc: { type: 'document', children: nodes },
        title,
        navLabel: packageName ?? title,
        description,
        tab,
        section,
        kind: 'api',
      });
      packagePages.push(page);
      // The overview's package list links each page by a virtual `.md` path.
      pagesBySource.set(`${dirname(repoPath)}/${dir}/${slug}.md`, page);
      packageList.push(
        `- [${packageName ? `\`${packageName}\`` : title}](${dir}/${slug}.md)${
          description ? ` — ${description}` : ''
        }`,
      );
    });

    const overview = newPage({
      out: `${dir}/index.html`,
      source: repoPath,
      doc: {
        type: 'document',
        children: [
          ...intro,
          ...parseDocsMarkdown(`## Packages\n\n${packageList.join('\n')}`).children,
        ],
      },
      title: 'API reference',
      navLabel: 'Overview',
      description: 'Every published package, its subpath entries, and their exports.',
      tab,
      section,
      kind: 'api',
    });
    const overviewHeadings = collectHeadings(asLoose(overview.doc));
    const packagesHeading = overviewHeadings[overviewHeadings.length - 1];
    if (packagesHeading) packagesHeading.attributes = { id: 'packages' };

    for (const page of [overview, ...packagePages]) {
      for (const heading of collectHeadings(asLoose(page.doc))) {
        if (heading.attributes?.id) anchors.set(heading.attributes.id, page);
      }
    }
    splitAnchors.set(repoPath, anchors);
    splitIndex.set(repoPath, overview);
    pagesBySource.set(repoPath, overview);
    return [overview, ...packagePages];
  }

  // ── Generated fences ─────────────────────────────────────────────

  function expandGeneratedFences(page: Page): void {
    const blocksDir = page.out.startsWith('blocks/')
      ? ''
      : `${relativeHref(page.out, 'blocks/x').slice(0, -1)}`;
    spliceBlocks(asLoose(page.doc), (node) => {
      if (node.type !== 'code' || node.lang !== GENERATED_FENCE) return null;
      const [name, arg] = (node.value ?? '').trim().split(/\s+/);
      let markdown: string | null = null;
      if (name === 'template-params') {
        const id = arg ?? page.template;
        if (id && id === page.template) placedParams.add(page);
        markdown = id ? templateParamsMarkdown(id) : null;
      } else if (name === 'block-settings') markdown = blockSettingsMarkdown();
      else if (name === 'template-list') markdown = templateListMarkdown(blocksDir);
      else if (name === 'theme-list') markdown = themeListMarkdown();
      else if (name === 'block-gallery') {
        return groupedTemplateIds().flatMap((group, index) => [
          ...parseDocsMarkdown(`## ${group.title}`).children.map(asLoose),
          htmlPlaceholder(page, 'block-cards', String(index)),
        ]);
      }
      if (markdown === null) {
        problem(page.out, `unknown generated fence "${node.value?.trim()}"`);
        return [];
      }
      return parseDocsMarkdown(markdown).children.map(asLoose);
    });

    if (page.kind !== 'block' || !page.template) return;
    if (!placedParams.has(page)) {
      const params = `## Parameters\n\n${templateParamsMarkdown(page.template)}`;
      page.doc.children.push(...parseDocsMarkdown(params).children);
    }
    // The template's tag and body policy sit under the H1.
    const h1 = page.doc.children.findIndex((node) => {
      const loose = asLoose(node);
      return loose.type === 'heading' && loose.depth === 1;
    });
    page.doc.children.splice(h1 + 1, 0, toBlock(htmlPlaceholder(page, 'block-summary')));
  }

  function htmlPlaceholder(page: Page, name: string, arg?: string): LooseNode {
    page.html.push({ name, arg });
    return paragraph(`@@squisq-docs-html-${page.html.length - 1}@@`);
  }

  function generatedHtml(page: Page, index: number): string {
    const entry = page.html[index];
    if (entry?.name === 'block-summary' && page.template) {
      const id = page.template;
      return [
        `<div class="sq-block-summary">`,
        `<p class="sq-lede">${escapeHtml(templateDescription(id))}</p>`,
        `<dl class="sq-block-facts">`,
        `<div><dt>Tag</dt><dd><code>{[${escapeHtml(id)}]}</code></dd></div>`,
        `<div><dt>Body</dt><dd>${escapeHtml(bodyPolicySummary(id))}</dd></div>`,
        `</dl></div>`,
      ].join('');
    }
    if (entry?.name === 'block-cards') {
      const group = groupedTemplateIds()[Number(entry.arg)];
      const cards = (group?.ids ?? []).map((id) => {
        const target = pagesBySource.get(`${docsRoot}/blocks/${id}.md`);
        if (!target) return '';
        const thumb = page.thumbs.get(id);
        return [
          `<a class="sq-card" href="${escapeHtml(relativeHref(page.out, target.out))}">`,
          thumb === undefined
            ? `<span class="sq-card-thumb"></span>`
            : `<span class="sq-card-thumb" data-thumb="${thumb}"></span>`,
          `<span class="sq-card-title">${escapeHtml(templateLabel(id))}</span>`,
          `<code class="sq-card-tag">{[${escapeHtml(id)}]}</code>`,
          `<span class="sq-card-text">${escapeHtml(templateDescription(id))}</span>`,
          `</a>`,
        ].join('');
      });
      return `<div class="sq-cards">${cards.join('')}</div>`;
    }
    return '';
  }

  // ── Live previews ────────────────────────────────────────────────

  function extractPreviews(page: Page): void {
    spliceBlocks(asLoose(page.doc), (node) => {
      if (node.type !== 'code' || !PREVIEW_LANGS.has((node.lang ?? '').toLowerCase())) return null;
      const meta = parseFenceMeta(node.meta ?? '');
      if (!('preview' in meta)) return null;
      const mode = (meta.preview || 'slideshow') as Preview['mode'];
      if (!PREVIEW_MODES.has(mode)) {
        problem(page.out, `unknown preview mode "${mode}"`);
        return null;
      }
      const snippet = node.value ?? '';
      let doc: Doc;
      try {
        doc = markdownToDoc(parseMarkdown(snippet));
        if (mode === 'slideshow') doc = buildPreviewDoc(doc);
        // The projection's preview clock is a timer, not media: an empty-src
        // segment would send the standalone player looking for audio.
        doc = {
          ...doc,
          audio: { ...doc.audio, segments: doc.audio.segments.filter((s) => s.src) },
        };
        // An example is about its blocks; the synthesized cover only gets in the way.
        if (!('cover' in meta)) doc = { ...doc, startBlock: undefined };
        if (meta.theme) doc = { ...doc, themeId: meta.theme };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        problem(page.out, `preview ${page.previews.length + 1} failed to convert: ${message}`);
        return null;
      }
      const index = page.previews.length;
      page.previews.push({
        mode,
        doc,
        images: previewImages(page, snippet),
        aspect: ASPECTS[meta.aspect ?? 'landscape'] ?? ASPECTS.landscape,
        editor: snippet.replace(/(?<![\w/.])images\//g, `${siteBase}docs/images/`),
      });
      const placeholder = paragraph(`@@squisq-docs-preview-${index}@@`);
      return 'nosource' in meta ? [placeholder] : [node, placeholder];
    });
  }

  /** Example images (`images/…`) resolve from the docs images folder. */
  function previewImages(page: Page, snippet: string): Record<string, string> {
    const images: Record<string, string> = {};
    for (const match of snippet.matchAll(
      /(?<![\w/.])images\/[\w./-]+\.(?:svg|png|jpe?g|webp|gif)/g,
    )) {
      const repoPath = `${docsRoot}/${match[0]}`;
      if (!source.exists(repoPath)) {
        problem(page.out, `example image ${match[0]} does not exist`);
        continue;
      }
      copiedAssets.add(repoPath);
      images[match[0]] = relativeHref(page.out, match[0]);
    }
    return images;
  }

  function rebaseImages(images: Record<string, string>, page: Page): Record<string, string> {
    return Object.fromEntries(Object.keys(images).map((key) => [key, relativeHref(page.out, key)]));
  }

  function previewFigure(preview: Preview | undefined, index: number): string {
    if (!preview) return '';
    const editorHref = `${ROOT_PLACEHOLDER}${encodeSharedMarkdown(preview.editor)}`;
    const label =
      preview.mode === 'page'
        ? 'Live preview · Page view'
        : preview.mode === 'dashboard'
          ? 'Live preview · Dashboard'
          : 'Live preview · Slideshow';
    // Page view scrolls inside a fixed-height stage; the canvases keep their shape.
    const stageStyle =
      preview.mode === 'page' ? '' : ` style="aspect-ratio: ${preview.aspect.css}"`;
    return [
      `<figure class="sq-preview sq-preview--${preview.mode}" data-preview="${index}">`,
      `<div class="sq-preview-stage"${stageStyle}></div>`,
      `<figcaption class="sq-preview-bar"><span class="sq-preview-label">${label}</span>`,
      `<a class="sq-preview-open" href="${escapeHtml(editorHref)}" target="_blank" rel="noopener">Open in editor ↗</a>`,
      `</figcaption></figure>`,
    ].join('');
  }

  function previewData(page: Page): string {
    const payload = {
      themes: themeChoices(),
      previews: page.previews.map((preview) => ({
        mode: preview.mode,
        images: preview.images,
        // Compose for the stage's shape whatever its size on screen.
        viewport:
          preview.mode === 'slideshow'
            ? { width: preview.aspect.width, height: preview.aspect.height }
            : undefined,
        doc: preview.doc,
      })),
    };
    // Markdown source positions are editor bookkeeping the player never reads.
    // Only those go: layers and timeline events carry a `position` of their own.
    const json = JSON.stringify(payload, (key, value: unknown) =>
      key === 'position' && isSourcePosition(value) ? undefined : value,
    ).replace(/</g, '\\u003c');
    return `<script type="application/json" id="sq-previews">${json}</script>`;
  }

  // ── Links and images ─────────────────────────────────────────────

  function resolveLinks(page: Page): Map<string, string> {
    const links = new Map<string, string>();
    for (const url of collectLinkUrls(asLoose(page.doc))) {
      if (links.has(url)) continue;
      const href = resolveHref(page, url);
      if (href !== null) links.set(url, href);
    }
    return links;
  }

  function resolveHref(page: Page, url: string): string | null {
    if (isExternal(url)) return null;
    // Root-relative links address the site (the editor lives at `/`).
    if (url.startsWith('/')) return siteRootPrefix(page.out) + url.slice(1);
    const [path, fragment] = splitFragment(url);
    const hash = fragment ? `#${fragment}` : '';
    if (!path) {
      const owner = splitOwner(page.source, fragment) ?? page;
      if (!owner.anchors.has(fragment)) problem(page.out, `link "${url}" names a missing anchor`);
      return owner === page ? null : relativeHref(page.out, owner.out) + hash;
    }
    const resolved = joinPath(dirname(page.source), decodeURIComponent(path));
    if (resolved === null) {
      problem(page.out, `link "${url}" climbs out of the repository`);
      return null;
    }
    const target =
      (fragment ? splitOwner(resolved, fragment) : undefined) ?? pagesBySource.get(resolved);
    if (target) {
      if (fragment && !target.anchors.has(fragment)) {
        problem(page.out, `link "${url}" names a missing anchor`);
      }
      return target === page ? hash || '#' : relativeHref(page.out, target.out) + hash;
    }
    if (!source.exists(resolved)) {
      problem(page.out, `broken link "${url}"`);
      return null;
    }
    if (resolved.startsWith(`${docsRoot}/${IMAGE_DIR}/`)) {
      copiedAssets.add(resolved);
      return relativeHref(page.out, resolved.slice(docsRoot.length + 1));
    }
    // Top-level docs/*.md files may be internal notes, linked on GitHub; a page
    // in a published folder that is missing from the navigation is a mistake.
    if (resolved.endsWith('.md') && dirname(resolved).startsWith(`${docsRoot}/`)) {
      problem(page.out, `link "${url}" points at a page missing from nav.json`);
    }
    const kind = source.isDirectory(resolved) ? 'tree' : 'blob';
    return `${repoUrl}/${kind}/main/${resolved}${hash}`;
  }

  function splitOwner(repoPath: string, fragment: string): Page | undefined {
    const anchors = splitAnchors.get(repoPath);
    if (!anchors) return undefined;
    return fragment ? anchors.get(fragment) : splitIndex.get(repoPath);
  }

  function resolveImages(page: Page): Map<string, string> {
    const images = new Map<string, string>();
    for (const url of collectImageUrls(asLoose(page.doc))) {
      if (isExternal(url) || url.startsWith('/')) continue;
      const resolved = joinPath(dirname(page.source), splitFragment(url)[0]);
      if (resolved === null || !source.exists(resolved)) {
        problem(page.out, `missing image "${url}"`);
      } else if (!resolved.startsWith(`${docsRoot}/`)) {
        problem(page.out, `image "${url}" lives outside ${docsRoot}/`);
      } else {
        copiedAssets.add(resolved);
        images.set(url, relativeHref(page.out, resolved.slice(docsRoot.length + 1)));
      }
    }
    return images;
  }

  // ── Page chrome ──────────────────────────────────────────────────

  function tabsHtml(page: Page): string {
    return tabs
      .map((tab) => {
        const first = tabPages(tab)[0];
        if (!first) return '';
        const current = tab.id === page.tab ? ' aria-current="true"' : '';
        return `<a class="sq-tab" href="${escapeHtml(relativeHref(page.out, first.out))}"${current}>${escapeHtml(tab.label)}</a>`;
      })
      .join('');
  }

  function sidebarHtml(page: Page, tab: NavTab): string {
    return tab.sections
      .map((section) => {
        const items = section.pages.map((target) => {
          const current = target === page ? ' aria-current="page"' : '';
          return `<li><a href="${escapeHtml(relativeHref(page.out, target.out))}"${current}>${escapeHtml(target.navLabel)}</a></li>`;
        });
        return `<div class="sq-nav-section"><p class="sq-nav-title">${escapeHtml(section.title)}</p><ul>${items.join('')}</ul></div>`;
      })
      .join('');
  }

  function tocHtml(page: Page): string {
    const entries = collectHeadings(asLoose(page.doc))
      .filter((heading) => heading.depth === 2 || heading.depth === 3)
      .map(
        (heading) =>
          `<li class="sq-toc-${heading.depth}"><a href="#${escapeHtml(heading.attributes?.id ?? '')}">${escapeHtml(plainText(heading))}</a></li>`,
      );
    if (entries.length < 2) return '';
    return `<p class="sq-toc-title">On this page</p><ul>${entries.join('')}</ul>`;
  }

  function breadcrumb(page: Page): string {
    if (page.kind === 'home') return '';
    const tab = tabs.find((candidate) => candidate.id === page.tab);
    const parts = [tab?.label, page.section].filter((part): part is string => Boolean(part));
    return `<p class="sq-breadcrumb">${parts.map(escapeHtml).join(' <span aria-hidden="true">›</span> ')}</p>`;
  }

  function pager(page: Page): string {
    const edit = `<a class="sq-edit" href="${escapeHtml(`${repoUrl}/edit/main/${page.source}`)}">Edit this page on GitHub</a>`;
    if (page.kind === 'home') return `<footer class="sq-page-footer">${edit}</footer>`;
    const order = pageOrder.filter((candidate) => candidate.tab === page.tab);
    const index = order.indexOf(page);
    const link = (target: Page | undefined, rel: 'prev' | 'next') =>
      target
        ? `<a class="sq-pager-${rel}" rel="${rel}" href="${escapeHtml(relativeHref(page.out, target.out))}"><span>${rel === 'prev' ? 'Previous' : 'Next'}</span>${escapeHtml(target.navLabel)}</a>`
        : '<span></span>';
    return [
      `<footer class="sq-page-footer">`,
      `<nav class="sq-pager" aria-label="Previous and next pages">${link(order[index - 1], 'prev')}${link(order[index + 1], 'next')}</nav>`,
      edit,
      `</footer>`,
    ].join('');
  }

  function descriptionFallback(page: Page): string {
    if (page.template) return templateDescription(page.template);
    const first = asLoose(page.doc).children?.find((node) => node.type === 'paragraph');
    return plainText(first).slice(0, 200);
  }

  function searchEntry(page: Page): unknown {
    const loose = asLoose(page.doc);
    const tab = tabs.find((candidate) => candidate.id === page.tab);
    return {
      t: page.title,
      u: page.out,
      s: [tab?.label, page.section].filter(Boolean).join(' › '),
      h: collectHeadings(loose)
        .filter((heading) => (heading.depth ?? 1) > 1 && (heading.depth ?? 1) <= 4)
        .map((heading) => [plainText(heading), heading.attributes?.id ?? '']),
      k: declaredNames(loose).join(' '),
      x: proseText(loose).slice(0, 6000),
    };
  }
}

// ── Markdown helpers ───────────────────────────────────────────────

/**
 * Parse documentation Markdown. Directives are off: prose like `key:value`
 * would otherwise lose `:value` to a text directive.
 */
function parseDocsMarkdown(text: string): MarkdownDocument {
  return parseMarkdown(text, { directive: false });
}

/** A Markdown AST node's `{ start: { line, … }, end: { line, … } }`. */
function isSourcePosition(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const { start, end } = value as { start?: { line?: unknown }; end?: { line?: unknown } };
  return typeof start?.line === 'number' && typeof end?.line === 'number';
}

function isPage<T>(value: T | null): value is T {
  return value !== null;
}

function paragraph(text: string): LooseNode {
  return { type: 'paragraph', children: [{ type: 'text', value: text }] };
}

function toBlock(node: LooseNode): MarkdownBlockNode {
  return node as unknown as MarkdownBlockNode;
}

/** Parse `preview=page theme=documentary nosource` into a key → value map. */
function parseFenceMeta(meta: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const token of meta.trim().split(/\s+/).filter(Boolean)) {
    const equals = token.indexOf('=');
    if (equals < 0) result[token] = '';
    else result[token.slice(0, equals)] = token.slice(equals + 1).replace(/^["']|["']$/g, '');
  }
  return result;
}

/**
 * Replace block nodes anywhere in the tree. `replace` returns the nodes to put
 * in place of `node`, or null to keep it and descend into it.
 */
function spliceBlocks(root: LooseNode, replace: (node: LooseNode) => LooseNode[] | null): void {
  const children = root.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const replacement = replace(children[index]);
    if (replacement === null) {
      spliceBlocks(children[index], replace);
      continue;
    }
    children.splice(index, 1, ...replacement);
    index += replacement.length - 1;
  }
}

// ── HTML post-processing ───────────────────────────────────────────

/**
 * Give headings their ids and anchor links, turn `> [!NOTE]` quotes into
 * callouts, and highlight code. The exporter writes `<hN>` with no attributes,
 * in the document order {@link collectHeadings} walks.
 */
function decorateBody(html: string, page: Page): string {
  const ids = collectHeadings(asLoose(page.doc)).map((heading) => heading.attributes?.id ?? '');
  let headingIndex = 0;
  return html
    .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (match, depth: string, inner: string) => {
      const id = ids[headingIndex++];
      if (!id) return match;
      const anchor =
        depth === '1'
          ? ''
          : `<a class="sq-anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a>`;
      return `<h${depth} id="${escapeHtml(id)}">${inner}${anchor}</h${depth}>`;
    })
    .replace(
      /<blockquote><p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/g,
      (_match, kind: string) => {
        const label = kind.charAt(0) + kind.slice(1).toLowerCase();
        return `<blockquote class="sq-callout sq-callout--${kind.toLowerCase()}"><p class="sq-callout-title">${label}</p><p>`;
      },
    )
    .replace(
      /<pre class="squisq-code-block"><code(?: class="language-([\w+-]+)")?>([\s\S]*?)<\/code><\/pre>/g,
      (_match, lang: string | undefined, code: string) => {
        const langAttr = lang ? ` class="language-${lang}"` : '';
        const dataLang = lang ? ` data-lang="${lang}"` : '';
        return `<div class="sq-code"${dataLang}><pre class="squisq-code-block"><code${langAttr}>${highlightEscapedCode(code, lang)}</code></pre></div>`;
      },
    )
    .replace(/<p><\/p>/g, '');
}
