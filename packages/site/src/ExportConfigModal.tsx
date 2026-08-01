/**
 * ExportConfigModal — Modal for configuring theme, transform, format,
 * rendering mode, and aspect ratio before exporting a document.
 *
 * The host supplies its resolved color scheme so this portaled dialog stays
 * visually consistent with the page that opened it.
 */

import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { stringifyMarkdown, inferDocumentTitle } from '@bendyline/squisq/markdown';
import { markdownToDoc, resolveAudioMapping } from '@bendyline/squisq/doc';
import { getThemeSummaries, resolveTheme } from '@bendyline/squisq/schemas';
import { getTransformStyleSummaries } from '@bendyline/squisq/transform';
import type { Doc, MediaProvider, Theme } from '@bendyline/squisq/schemas';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { VideoExportModal } from '@bendyline/squisq-video-react';
import { buildPreviewDoc, PlainHtmlPreview } from '@bendyline/squisq-editor-react';
import JSZip from 'jszip';
import { collectAudioForHtmlExport, collectImagesForHtmlExport } from './exportHelpers';
import { slugifyTitle } from './exportFilename';
import { SITE_FFMPEG_WASM_CONFIG } from './ffmpegWasmConfig';
import {
  createEntryAwareDocumentReader,
  prepareExportDoc,
  prepareExportMarkdown,
  prepareVideoExportDoc,
} from './exportPreparation';

// ── Types ──────────────────────────────────────────────────────────

export interface ExportConfigModalProps {
  currentSource: string;
  mediaProvider: MediaProvider | null;
  /** Resolved host color scheme. Defaults to light for standalone callers. */
  colorScheme?: 'light' | 'dark';
  /**
   * Optional workspace-scoped ContentContainer — when supplied, unlocks
   * the "Export linked documents" toggle for the plain-HTML+zip path.
   * The bundle exporter uses `workspaceContainer.readFile()` to load
   * sibling `.md` files and their image assets. Without it the toggle
   * stays hidden so authors don't see broken settings.
   */
  workspaceContainer?: ContentContainer | null;
  onClose: () => void;
}

type ExportFormat = 'docx' | 'pptx' | 'pdf' | 'html' | 'htmlzip' | 'zip' | 'video';
type RenderMode = 'document' | 'slideshow';
/** HTML output flavor: 'rendered' uses SquisqPlayer + SVG cards; 'plain'
 *  produces semantic HTML matching the "Page" preview. */
type HtmlStyle = 'rendered' | 'plain';

// ── Styles ─────────────────────────────────────────────────────────

interface ExportDialogPalette {
  overlay: string;
  surface: string;
  control: string;
  border: string;
  text: string;
  heading: string;
  label: string;
  muted: string;
  secondary: string;
  primary: string;
  primaryBorder: string;
  danger: string;
}

const EXPORT_DIALOG_PALETTES: Record<'light' | 'dark', ExportDialogPalette> = {
  light: {
    overlay: 'rgba(0, 0, 0, 0.5)',
    surface: '#FFFDF7',
    control: '#ffffff',
    border: '#c9b98a',
    text: '#4a3c1f',
    heading: '#2d2310',
    label: '#5a4a2a',
    muted: '#8a7a5a',
    secondary: '#E8DFC6',
    primary: '#8B6914',
    primaryBorder: '#7a5c10',
    danger: '#c53030',
  },
  dark: {
    overlay: 'rgba(2, 6, 23, 0.72)',
    surface: '#111827',
    control: '#0f172a',
    border: '#475569',
    text: '#e5e7eb',
    heading: '#f8fafc',
    label: '#cbd5e1',
    muted: '#94a3b8',
    secondary: '#1e293b',
    primary: '#9a7416',
    primaryBorder: '#d1a73b',
    danger: '#fca5a5',
  },
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalStyle: React.CSSProperties = {
  borderRadius: 0,
  padding: '24px 28px',
  minWidth: 380,
  maxWidth: 480,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

/** Wider variant used when the plain-HTML preview pane is on. */
const modalStyleWide: React.CSSProperties = {
  ...modalStyle,
  maxWidth: 960,
  minWidth: 720,
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: 18,
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  borderRadius: 0,
  marginBottom: 12,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  color: '#fff',
  borderRadius: 0,
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  borderRadius: 0,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  marginTop: -8,
  marginBottom: 12,
};

// ── Helpers ────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Collect images referenced from a parsed markdown document and return a
 * map of `original-url → data-URI`. Used by the single-file plain HTML
 * export so the .html is self-contained. Both markdown `![]()` images
 * and raw `<img src>` (from resized WYSIWYG images) are picked up.
 */
async function collectInlineImages(
  mdDoc: MarkdownDocument,
  mediaProvider: MediaProvider | null,
): Promise<Map<string, string> | undefined> {
  if (!mediaProvider) return undefined;
  const refs = collectMarkdownImageRefs(mdDoc);
  if (refs.size === 0) return undefined;
  const map = new Map<string, string>();
  await Promise.all(
    Array.from(refs).map(async (ref) => {
      if (isExternalRef(ref)) return;
      try {
        const url = await mediaProvider.resolveUrl(ref);
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const mime = res.headers.get('content-type') || guessMimeFromPath(ref);
        map.set(ref, arrayBufferToDataUri(buf, mime));
      } catch {
        // Best-effort — leave the ref unresolved and the <img> will 404.
      }
    }),
  );
  return map.size > 0 ? map : undefined;
}

/**
 * Build a zip with `index.html` + image assets at their original
 * relative paths, mirroring the `<img src>` references in the source.
 * Mirrors what `docToHtmlZip` does for the rendered path, but produces
 * a plain semantic page.
 */
/**
 * Recursive plain-HTML bundle export. Delegates to the formats package's
 * `markdownDocsToPlainHtmlBundle`, supplying it with `ContentContainer.readFile`
 * as both the document and binary loader. The container abstracts the
 * storage layer (FileSystem in docblocks, in-memory in the site's
 * sample picker), so the bundler can't know the difference.
 *
 * The container's "primary document" (whatever `getDocumentPath()`
 * resolves to, falling back to `index.md`) is the entry point.
 */
async function downloadLinkedHtmlBundle(
  container: ContentContainer,
  currentMarkdown: string,
  title: string,
  filename: string,
  theme?: Theme,
): Promise<void> {
  const { markdownDocsToPlainHtmlBundle } = await import('@bendyline/squisq-formats/html');
  const entryPath = (await container.getDocumentPath()) ?? 'index.md';
  const readDocument = createEntryAwareDocumentReader(container, entryPath, currentMarkdown);
  const blob = await markdownDocsToPlainHtmlBundle({
    entryPath,
    readDocument,
    readBinary: (p) => container.readFile(p),
    title,
    theme,
  });
  downloadBlob(blob, filename);
}

async function downloadPlainHtmlZip(
  mdDoc: MarkdownDocument,
  title: string,
  mediaProvider: MediaProvider | null,
  filename: string,
  theme?: Theme,
): Promise<void> {
  const { markdownDocToPlainHtml } = await import('@bendyline/squisq-formats/html');
  const html = markdownDocToPlainHtml(mdDoc, { title, theme });
  const zip = new JSZip();
  zip.file('index.html', html);
  if (mediaProvider) {
    const refs = collectMarkdownImageRefs(mdDoc);
    await Promise.all(
      Array.from(refs).map(async (ref) => {
        if (isExternalRef(ref)) return;
        try {
          const url = await mediaProvider.resolveUrl(ref);
          const res = await fetch(url);
          if (!res.ok) return;
          const data = new Uint8Array(await res.arrayBuffer());
          const cleanPath = ref.replace(/^\/+/, '').replace(/\\/g, '/');
          if (cleanPath.split('/').some((seg) => seg === '..')) return;
          zip.file(cleanPath, data);
        } catch {
          // skip
        }
      }),
    );
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  downloadBlob(blob, filename);
}

function isExternalRef(url: string): boolean {
  return (
    !url ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('//')
  );
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

function guessMimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function arrayBufferToDataUri(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Walk a markdown document for every image reference — both `![]()`
 * (type `image`, `url` field) and raw HTML `<img src>` (parsed into
 * `htmlChildren`). The WYSIWYG editor serializes resized images via
 * the HTML form, so missing it would silently drop them from the
 * export.
 */
function collectMarkdownImageRefs(doc: MarkdownDocument): Set<string> {
  const refs = new Set<string>();
  function visitHtml(nodes: unknown[]): void {
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const node = n as Record<string, unknown>;
      if (node.type !== 'htmlElement') continue;
      if ((node.tagName as string).toLowerCase() === 'img') {
        const attrs = node.attributes as Record<string, string> | undefined;
        const src = attrs?.src;
        if (typeof src === 'string' && src) refs.add(src);
      }
      if (Array.isArray(node.children)) visitHtml(node.children);
    }
  }
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'image' && typeof n.url === 'string' && n.url) refs.add(n.url);
    if ((n.type === 'htmlBlock' || n.type === 'htmlInline') && Array.isArray(n.htmlChildren)) {
      visitHtml(n.htmlChildren);
    }
    if (Array.isArray(n.children)) for (const c of n.children) visit(c);
  }
  for (const child of doc.children) visit(child);
  return refs;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  docx: 'Word (.docx)',
  pptx: 'PowerPoint (.pptx)',
  pdf: 'PDF (.pdf)',
  html: 'Standalone HTML (.html)',
  htmlzip: 'HTML + Assets (.zip)',
  zip: 'Content Zip (.zip)',
  video: 'Video / Animated GIF',
};

/** Formats that support render mode (document vs slideshow) selection */
const VISUAL_FORMATS: ExportFormat[] = ['html', 'htmlzip'];

// ── Component ──────────────────────────────────────────────────────

export function ExportConfigModal({
  currentSource,
  mediaProvider,
  colorScheme = 'light',
  workspaceContainer,
  onClose,
}: ExportConfigModalProps) {
  const [format, setFormat] = useState<ExportFormat>('html');
  const [renderMode, setRenderMode] = useState<RenderMode>('document');
  const [htmlStyle, setHtmlStyle] = useState<HtmlStyle>('rendered');
  const [followLinks, setFollowLinks] = useState<boolean>(false);
  const [themeId, setThemeId] = useState<string>('');
  const [transformStyle, setTransformStyle] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoExportDoc, setVideoExportDoc] = useState<Doc | null>(null);

  const playerScriptRef = useRef<string | null>(null);

  const themes = getThemeSummaries();
  const transforms = getTransformStyleSummaries();
  const palette = EXPORT_DIALOG_PALETTES[colorScheme];
  const modalColorStyle: React.CSSProperties = {
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    color: palette.text,
    colorScheme,
  };
  const themedTitleStyle: React.CSSProperties = { ...titleStyle, color: palette.heading };
  const themedLabelStyle: React.CSSProperties = { ...labelStyle, color: palette.label };
  const themedSelectStyle: React.CSSProperties = {
    ...selectStyle,
    border: `1px solid ${palette.border}`,
    background: palette.control,
    color: palette.text,
    colorScheme,
  };
  const themedHintStyle: React.CSSProperties = { ...hintStyle, color: palette.muted };
  const themedPrimaryButtonStyle: React.CSSProperties = {
    ...btnPrimary,
    background: palette.primary,
    border: `1px solid ${palette.primaryBorder}`,
  };
  const themedSecondaryButtonStyle: React.CSSProperties = {
    ...btnSecondary,
    background: palette.secondary,
    color: palette.text,
    border: `1px solid ${palette.border}`,
  };

  const isHtmlFormat = VISUAL_FORMATS.includes(format);
  // Plain HTML doesn't need the rendered-vs-slideshow Mode selector
  // (it's always a flowing document). Hiding it when style=plain keeps
  // the dialog from offering settings that won't apply.
  const showModeSelector = isHtmlFormat && htmlStyle !== 'plain';
  const showStyleSelector = isHtmlFormat;
  const showPreview = isHtmlFormat && htmlStyle === 'plain';
  /** Collect raw images by mediaProvider name (for pptx and other formats). */
  const collectImagesByName = useCallback(async () => {
    const images = new Map<string, ArrayBuffer>();
    if (!mediaProvider) return images;
    const entries = await mediaProvider.listMedia();
    const fetched = await Promise.all(
      entries.map(async (entry) => {
        const url = await mediaProvider.resolveUrl(entry.name);
        const res = await fetch(url);
        if (!res.ok) return null;
        return { name: entry.name, data: await res.arrayBuffer() };
      }),
    );
    for (const f of fetched) {
      if (f) images.set(f.name, f.data);
    }
    return images;
  }, [mediaProvider]);

  /** Apply transform and return final MarkdownDocument */
  const prepareMarkdown = useCallback((): MarkdownDocument => {
    return prepareExportMarkdown(currentSource, {
      transformStyle,
      themeId,
      applyTransform: !(isHtmlFormat && htmlStyle === 'plain'),
    });
  }, [currentSource, transformStyle, themeId, isHtmlFormat, htmlStyle]);

  const handleExport = useCallback(async () => {
    // Video format delegates to VideoExportModal
    if (format === 'video') {
      setBusy(true);
      setError(null);
      try {
        const docPromise = prepareVideoExportDoc(
          currentSource,
          { transformStyle, themeId },
          workspaceContainer,
        );
        if (!playerScriptRef.current) {
          const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
          playerScriptRef.current = PLAYER_BUNDLE;
        }
        setVideoExportDoc(await docPromise);
        setShowVideoModal(true);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const mdDoc = prepareMarkdown();
      const ts = new Date().toISOString().slice(0, 10);
      // Filename stem: title slug + ISO date. Falls back to "document"
      // when no title can be inferred, preserving the historical
      // download name for untitled drafts. The per-format ext is
      // appended at each downloadBlob call below.
      const filenameStem = `${slugifyTitle(inferDocumentTitle(mdDoc) ?? 'document')}-${ts}`;
      const exportThemeId = themeId || undefined;

      switch (format) {
        case 'docx': {
          const { markdownDocToDocx } = await import('@bendyline/squisq-formats/docx');
          const buf = await markdownDocToDocx(mdDoc, { themeId: exportThemeId });
          downloadBlob(
            new Blob([buf], {
              type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            }),
            `${filenameStem}.docx`,
          );
          break;
        }
        case 'pptx': {
          // A .pptx is the slideshow rendition, so export the Doc rather than
          // the markdown: `docToPptx` runs the same projection the preview
          // player does, one authored block per slide plus the cover. The
          // markdown path segmented on H1/H2 headings only, so `###` slides
          // were folded into their parent section.
          const { docToPptx } = await import('@bendyline/squisq-formats/pptx');
          const images = await collectImagesByName();
          const exportDoc = prepareExportDoc(currentSource, {
            transformStyle,
            themeId,
          });
          const buf = await docToPptx(exportDoc, { themeId: exportThemeId, images });
          downloadBlob(
            new Blob([buf], {
              type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            }),
            `${filenameStem}.pptx`,
          );
          break;
        }
        case 'pdf': {
          const { markdownDocToPdf } = await import('@bendyline/squisq-formats/pdf');
          const buf = await markdownDocToPdf(mdDoc, { themeId: exportThemeId });
          downloadBlob(new Blob([buf], { type: 'application/pdf' }), `${filenameStem}.pdf`);
          break;
        }
        case 'html':
        case 'htmlzip': {
          if (htmlStyle === 'plain') {
            // Plain semantic HTML — no SquisqPlayer, no SVG cards. The
            // shared `markdownDocToPlainHtml` is also what the Page
            // preview renders, so the downloaded file matches the
            // preview byte-for-byte.
            const { markdownDocToPlainHtml } = await import('@bendyline/squisq-formats/html');
            const docTitle = inferDocumentTitle(mdDoc) ?? 'Document';
            const themeForExport = exportThemeId ? resolveTheme(exportThemeId) : undefined;
            if (format === 'html') {
              const inlineImages = await collectInlineImages(mdDoc, mediaProvider);
              const html = markdownDocToPlainHtml(mdDoc, {
                title: docTitle,
                images: inlineImages,
                theme: themeForExport,
              });
              downloadBlob(
                new Blob([html], { type: 'text/html;charset=utf-8' }),
                `${filenameStem}.html`,
              );
            } else if (followLinks && workspaceContainer) {
              // Recursive multi-doc export: pull every linked sibling
              // / child .md file via the workspace container, render
              // them all, rewrite `.md` → `.html` cross-doc references.
              await downloadLinkedHtmlBundle(
                workspaceContainer,
                stringifyMarkdown(mdDoc),
                docTitle,
                `${filenameStem}.html.zip`,
                themeForExport,
              );
            } else {
              await downloadPlainHtmlZip(
                mdDoc,
                docTitle,
                mediaProvider,
                `${filenameStem}.html.zip`,
                themeForExport,
              );
            }
            break;
          }

          const [{ docToHtml, docToHtmlZip }, { PLAYER_BUNDLE }] = await Promise.all([
            import('@bendyline/squisq-formats/html'),
            import('@bendyline/squisq-react/standalone-source'),
          ]);
          // Narration timing + audio mapping ride the workspace container;
          // without this the exported player paces on reading-time estimates.
          const parsedDoc = markdownToDoc(mdDoc);
          const rawDoc = workspaceContainer
            ? await resolveAudioMapping(parsedDoc, workspaceContainer)
            : parsedDoc;
          const doc = renderMode === 'slideshow' ? buildPreviewDoc(rawDoc) : rawDoc;
          const images = await collectImagesForHtmlExport(doc, mediaProvider);
          const audio = await collectAudioForHtmlExport(doc, workspaceContainer);
          const options = {
            playerScript: PLAYER_BUNDLE,
            images,
            ...(audio ? { audio } : {}),
            mode: renderMode === 'slideshow' ? ('slideshow' as const) : ('static' as const),
            themeId: exportThemeId,
            title: inferDocumentTitle(mdDoc),
          };
          if (format === 'html') {
            const html = docToHtml(doc, options);
            downloadBlob(
              new Blob([html], { type: 'text/html;charset=utf-8' }),
              `${filenameStem}.html`,
            );
          } else {
            const blob = await docToHtmlZip(doc, options);
            downloadBlob(blob, `${filenameStem}.html.zip`);
          }
          break;
        }
        case 'zip': {
          const { containerToZip } = await import('@bendyline/squisq-formats/container');
          const container = new MemoryContentContainer();
          await container.writeDocument(stringifyMarkdown(mdDoc));
          if (mediaProvider) {
            const entries = await mediaProvider.listMedia();
            for (const entry of entries) {
              const url = await mediaProvider.resolveUrl(entry.name);
              const res = await fetch(url);
              if (res.ok) {
                const data = await res.arrayBuffer();
                await container.writeFile(entry.name, data, entry.mimeType);
              }
            }
          }
          const blob = await containerToZip(container);
          downloadBlob(blob, `${filenameStem}.zip`);
          break;
        }
      }

      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [
    format,
    renderMode,
    htmlStyle,
    followLinks,
    workspaceContainer,
    themeId,
    transformStyle,
    currentSource,
    mediaProvider,
    onClose,
    collectImagesByName,
    prepareMarkdown,
  ]);

  return (
    <>
      <div
        style={{ ...overlayStyle, background: palette.overlay }}
        data-color-scheme={colorScheme}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div style={{ ...(showPreview ? modalStyleWide : modalStyle), ...modalColorStyle }}>
          <h2 style={themedTitleStyle}>Export with Options</h2>

          <div
            style={{
              display: 'flex',
              gap: 20,
              alignItems: 'stretch',
            }}
          >
            <div style={{ flex: showPreview ? '0 0 320px' : '1 1 auto', minWidth: 0 }}>
              {/* Format */}
              <label style={themedLabelStyle}>Format</label>
              <select
                style={themedSelectStyle}
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                disabled={busy}
              >
                {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>

              {/* HTML style — Plain vs Rendered */}
              {showStyleSelector && (
                <>
                  <label style={themedLabelStyle}>Style</label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {(['rendered', 'plain'] as const).map((s) => {
                      const active = htmlStyle === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setHtmlStyle(s)}
                          disabled={busy}
                          style={{
                            flex: 1,
                            padding: '6px 10px',
                            fontSize: 13,
                            fontFamily: 'inherit',
                            cursor: busy ? 'default' : 'pointer',
                            background: active ? palette.primary : palette.secondary,
                            color: active ? '#fff' : palette.text,
                            border: `1px solid ${active ? palette.primaryBorder : palette.border}`,
                            borderRadius: 0,
                          }}
                        >
                          {s === 'rendered' ? 'Rendered' : 'Plain'}
                        </button>
                      );
                    })}
                  </div>
                  <div style={themedHintStyle}>
                    {htmlStyle === 'rendered'
                      ? 'Uses SquisqPlayer with SVG block cards, themes, and animations.'
                      : 'Plain semantic HTML — no JS, no SVG cards. Matches the Document preview.'}
                  </div>
                </>
              )}

              {/* Export linked documents — only meaningful for plain
                  HTML+zip when a workspace container is available. We
                  hide the toggle entirely otherwise so authors don't
                  see a setting that can't do anything. */}
              {format === 'htmlzip' && htmlStyle === 'plain' && workspaceContainer && (
                <>
                  <label
                    style={{
                      ...themedLabelStyle,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 4,
                      marginBottom: 4,
                      cursor: busy ? 'default' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={followLinks}
                      onChange={(e) => setFollowLinks(e.target.checked)}
                      disabled={busy}
                    />
                    <span>Export linked documents</span>
                  </label>
                  <div style={themedHintStyle}>
                    Recursively bundles every `.md` file the entry document links to (within its
                    folder or any subfolder). Cross-doc links are rewritten from `.md` to `.html` so
                    the result browses as a static site.
                  </div>
                </>
              )}

              {/* Render Mode — for HTML and Video formats (rendered only) */}
              {showModeSelector && (
                <>
                  <label style={themedLabelStyle}>Mode</label>
                  <select
                    style={themedSelectStyle}
                    value={renderMode}
                    onChange={(e) => setRenderMode(e.target.value as RenderMode)}
                    disabled={busy}
                  >
                    <option value="document">Document (scrollable page)</option>
                    <option value="slideshow">Slideshow (interactive player)</option>
                  </select>
                  <div style={themedHintStyle}>
                    {renderMode === 'document'
                      ? 'Renders as a readable flowing document with embedded images.'
                      : 'Renders as an interactive slideshow with animated block transitions.'}
                  </div>
                </>
              )}

              {/* Theme — applied to both rendered and plain HTML output */}
              <label style={themedLabelStyle}>Theme</label>
              <select
                style={themedSelectStyle}
                value={themeId}
                onChange={(e) => setThemeId(e.target.value)}
                disabled={busy}
              >
                <option value="">Default (no theme)</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              {/* Transform — plain HTML preserves markdown as-is, no transform */}
              {htmlStyle !== 'plain' || !isHtmlFormat ? (
                <>
                  <label style={themedLabelStyle}>Transform</label>
                  <select
                    style={themedSelectStyle}
                    value={transformStyle}
                    onChange={(e) => setTransformStyle(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">None</option>
                    {transforms.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}

              {/* Error */}
              {error && (
                <div style={{ color: palette.danger, fontSize: 13, marginBottom: 12 }}>
                  Export failed: {error}
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button style={themedSecondaryButtonStyle} onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button style={themedPrimaryButtonStyle} onClick={handleExport} disabled={busy}>
                  {busy ? 'Exporting...' : 'Export'}
                </button>
              </div>
            </div>

            {showPreview && (
              <div
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  border: `1px solid ${palette.border}`,
                  background: palette.control,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 480,
                }}
              >
                <div
                  style={{
                    padding: '6px 10px',
                    borderBottom: `1px solid ${palette.border}`,
                    fontSize: 12,
                    color: palette.muted,
                    background: palette.surface,
                  }}
                >
                  Preview
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <PlainHtmlPreview
                    markdown={currentSource}
                    mediaProvider={mediaProvider}
                    theme={themeId ? resolveTheme(themeId) : undefined}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Video export modal — opened when format is 'video' */}
      {showVideoModal &&
        videoExportDoc &&
        playerScriptRef.current &&
        createPortal(
          <VideoExportModal
            doc={videoExportDoc}
            playerScript={playerScriptRef.current}
            mediaProvider={mediaProvider ?? undefined}
            defaultConfig={{ ffmpegWasm: SITE_FFMPEG_WASM_CONFIG }}
            colorScheme={colorScheme}
            onClose={() => {
              setShowVideoModal(false);
              setVideoExportDoc(null);
              onClose();
            }}
          />,
          document.body,
        )}
    </>
  );
}
