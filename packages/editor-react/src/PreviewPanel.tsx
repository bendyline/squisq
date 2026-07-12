/**
 * PreviewPanel
 *
 * Renders a live preview of the current markdown document as a slideshow
 * using the DocPlayer component from @bendyline/squisq-react. The
 * markdown → player-Doc conversion is delegated to the shared
 * `buildPreviewDoc` helper so live preview and the export pipeline stay
 * in sync.
 */

import { useState, useEffect, useMemo } from 'react';
import { DocPlayer, LinearDocView, useMediaProvider } from '@bendyline/squisq-react';
import type { Doc } from '@bendyline/squisq/schemas';
import { applyTransform } from '@bendyline/squisq/transform';
import { resolveAudioMapping } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useEditorContext } from './EditorContext';
import { usePreviewSettings } from './PreviewControls';
import { buildPreviewDoc } from './buildPreviewDoc';
import { buildDocumentPreviewMarkdown } from './buildDocumentPreviewMarkdown';
import { PlainHtmlPreview } from './PlainHtmlPreview';
import { TeleprompterView } from './teleprompter/TeleprompterView';

export interface PreviewPanelProps {
  /** Base path for resolving media URLs in DocPlayer */
  basePath?: string;
  /** Additional class name for the container */
  className?: string;
  /**
   * Workspace-scoped `ContentContainer` (the folder holding the doc and
   * its siblings). Used here for audio mapping — MP3 discovery and
   * `timing.json` reading.
   */
  workspaceContainer?: ContentContainer | null;
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Live preview panel that renders the current document as a slideshow
 * or document view. Controls (viewport, mode, theme, transform, captions)
 * are rendered in the main toolbar via PreviewToolbarControls.
 */
export function PreviewPanel({ basePath = '/', className, workspaceContainer }: PreviewPanelProps) {
  const {
    doc,
    parseError,
    isParsing,
    markdownSource,
    mediaRevision,
    setMarkdownSource,
    bumpMediaRevision,
    allowRecording,
  } = useEditorContext();
  const mediaProvider = useMediaProvider();
  const {
    activeViewport,
    activeDisplayMode,
    activeTheme,
    activeTransformStyle,
    activeCaptionStyle,
    activeCaptionsEnabled,
    activeCoverSlide,
  } = usePreviewSettings();

  // Build the player-ready Doc whenever the parsed doc changes.
  // Transform runs on the ORIGINAL doc (which has block.contents with
  // markdown body text) so the content extractor can analyze it.
  // Then buildPreviewDoc converts the result for DocPlayer.
  //
  // Audio mapping is async (reads container files), so we use a two-phase
  // approach: first build the base doc synchronously, then resolve audio
  // in an effect and update the state.
  const [previewProjection, setPreviewProjection] = useState<{
    /** Transformed content model shared by Page and Document. */
    contentDoc: Doc;
    /** Flattened/timed player model shared by Slideshow and Video. */
    playerDoc: Doc;
  } | null>(null);

  useEffect(() => {
    if (!doc || !doc.blocks.length) {
      setPreviewProjection(null);
      return;
    }

    // Audio resolution runs BEFORE the transform: a document-anchored
    // narration take re-times the SOURCE blocks, and the transform's
    // provenance (`sourceStartTime` in seconds) is derived from those
    // times — so summarized slides land where the words are spoken.
    const build = (sourceDoc: Doc) => {
      const contentDoc = activeTransformStyle
        ? applyTransform(sourceDoc, activeTransformStyle).doc
        : sourceDoc;
      return { contentDoc, playerDoc: buildPreviewDoc(contentDoc) };
    };

    if (workspaceContainer) {
      let cancelled = false;
      resolveAudioMapping(doc, workspaceContainer).then(
        (audioDoc) => {
          if (!cancelled) setPreviewProjection(build(audioDoc));
        },
        () => {
          // The synchronous preview below remains valid when optional audio
          // discovery fails; consume the rejection rather than leaking it.
        },
      );
      // Set an immediate preview without audio while mapping resolves
      setPreviewProjection(build(doc));
      return () => {
        cancelled = true;
      };
    }

    setPreviewProjection(build(doc));
  }, [doc, activeTransformStyle, workspaceContainer]);

  const previewDoc = previewProjection?.playerDoc ?? null;
  const contentDoc = previewProjection?.contentDoc ?? null;
  const documentMarkdown = useMemo(
    () =>
      activeTransformStyle && contentDoc
        ? buildDocumentPreviewMarkdown(contentDoc)
        : markdownSource,
    [activeTransformStyle, contentDoc, markdownSource],
  );

  // The public DisplayMode values predate the current labels: raw `page`
  // is the plain Document preview, while raw `linear` is the styled Page view.
  const isDocumentMode = activeDisplayMode === 'page';
  const isPageMode = activeDisplayMode === 'linear';
  const isNarrateMode = activeDisplayMode === 'narrate';

  // Status overlays for non-ready states. Narrate is exempt: the
  // teleprompter holds live state (mic capture, an in-flight recording,
  // pacing position) that an unmount would destroy — e.g. saving a take
  // rewrites the markdown, which triggers exactly this reparse. It keeps
  // rendering the last-good doc until the new parse lands.
  if (isParsing && !isNarrateMode) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <p>Parsing…</p>
      </div>
    );
  }

  if (parseError && !isNarrateMode) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <h3>Parse Error</h3>
        <pre>{parseError}</pre>
      </div>
    );
  }

  // Document mode renders a text-first markdown projection, and Narrate
  // builds its script from the parsed source doc (showing its own empty
  // state). Neither depends on the player projection, so let them fall
  // through even when that isn't ready yet.
  if (!previewDoc && !isDocumentMode && !isNarrateMode) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <p>No content to preview. Start typing in the editor.</p>
      </div>
    );
  }

  const fillsContainer = isDocumentMode || isPageMode || isNarrateMode ? 'stretch' : 'center';

  return (
    <div
      className={`squisq-preview-container ${className || ''}`}
      data-testid="preview-panel"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--squisq-bg, #f5f5f5)',
      }}
    >
      {/* Player / Document / Page view */}
      <div
        className="squisq-preview-player"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: fillsContainer,
          justifyContent: 'center',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {isDocumentMode ? (
          <PlainHtmlPreview
            markdown={documentMarkdown}
            title={(contentDoc?.frontmatter?.title as string | undefined) ?? undefined}
            mediaProvider={mediaProvider}
            mediaRevision={mediaRevision}
            theme={activeTheme}
            globalKeyboardShortcuts
          />
        ) : isNarrateMode ? (
          // Narrate consumes the UN-transformed doc: the teleprompter must
          // show the author's actual words, not a summarized slideshow.
          <TeleprompterView
            doc={doc}
            theme={activeTheme}
            workspaceContainer={workspaceContainer ?? null}
            basePath={basePath}
            recording={
              allowRecording && mediaProvider
                ? {
                    mediaProvider,
                    container: workspaceContainer ?? null,
                    markdownSource,
                    setMarkdownSource,
                    bumpMediaRevision,
                  }
                : null
            }
          />
        ) : isPageMode ? (
          <LinearDocView
            doc={contentDoc ?? doc!}
            basePath={basePath}
            viewport={activeViewport}
            theme={activeTheme}
            globalKeyboardShortcuts
          />
        ) : (
          <DocPlayer
            // A style change replaces the slide sequence. Remounting clears
            // slideshow navigation/transition state that belongs to the old
            // sequence and guarantees the newly transformed deck is used.
            key={activeTransformStyle || 'none'}
            doc={previewDoc!}
            basePath={basePath}
            showControls
            muted
            forceViewport={activeViewport}
            displayMode={activeDisplayMode}
            theme={activeTheme}
            captionStyle={activeCaptionStyle}
            captionsEnabled={activeCaptionsEnabled}
            showCoverSlide={activeCoverSlide}
            globalKeyboardShortcuts
          />
        )}
      </div>
    </div>
  );
}
