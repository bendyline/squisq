/**
 * PreviewPanel
 *
 * Renders a live preview of the current markdown document as a slideshow
 * using the DocPlayer component from @bendyline/squisq-react. The
 * markdown → player-Doc conversion is delegated to the shared
 * `buildPreviewDoc` helper so live preview and the export pipeline stay
 * in sync.
 */

import { useState, useEffect } from 'react';
import { DocPlayer, LinearDocView } from '@bendyline/squisq-react';
import type { Doc } from '@bendyline/squisq/schemas';
import { applyTransform } from '@bendyline/squisq/transform';
import { resolveAudioMapping } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useEditorContext } from './EditorContext';
import { usePreviewSettings } from './PreviewControls';
import { buildPreviewDoc } from './buildPreviewDoc';

export interface PreviewPanelProps {
  /** Base path for resolving media URLs in DocPlayer */
  basePath?: string;
  /** Additional class name for the container */
  className?: string;
  /** Optional ContentContainer for audio mapping (MP3 discovery + timing.json) */
  container?: ContentContainer | null;
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Live preview panel that renders the current document as a slideshow
 * or document view. Controls (viewport, mode, theme, transform, captions)
 * are rendered in the main toolbar via PreviewToolbarControls.
 */
export function PreviewPanel({ basePath = '/', className, container }: PreviewPanelProps) {
  const { doc, parseError, isParsing } = useEditorContext();
  const {
    activeViewport,
    activeDisplayMode,
    activeTheme,
    activeTransformStyle,
    activeCaptionStyle,
  } = usePreviewSettings();

  // Build the player-ready Doc whenever the parsed doc changes.
  // Transform runs on the ORIGINAL doc (which has block.contents with
  // markdown body text) so the content extractor can analyze it.
  // Then buildPreviewDoc converts the result for DocPlayer.
  //
  // Audio mapping is async (reads container files), so we use a two-phase
  // approach: first build the base doc synchronously, then resolve audio
  // in an effect and update the state.
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null);

  useEffect(() => {
    if (!doc || !doc.blocks.length) {
      setPreviewDoc(null);
      return;
    }

    let sourceDoc = doc;
    if (activeTransformStyle) {
      const result = applyTransform(doc, activeTransformStyle);
      sourceDoc = result.doc;
    }

    // If we have a container, try to resolve audio mapping before building preview
    if (container) {
      let cancelled = false;
      resolveAudioMapping(sourceDoc, container).then((audioDoc) => {
        if (!cancelled) {
          setPreviewDoc(buildPreviewDoc(audioDoc));
        }
      });
      // Set an immediate preview without audio while mapping resolves
      setPreviewDoc(buildPreviewDoc(sourceDoc));
      return () => {
        cancelled = true;
      };
    }

    setPreviewDoc(buildPreviewDoc(sourceDoc));
  }, [doc, activeTransformStyle, container]);

  // Status overlays for non-ready states
  if (isParsing) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <p>Parsing…</p>
      </div>
    );
  }

  if (parseError) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <h3>Parse Error</h3>
        <pre>{parseError}</pre>
      </div>
    );
  }

  if (!previewDoc) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <p>No content to preview. Start typing in the editor.</p>
      </div>
    );
  }

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
      {/* Player / Document view */}
      <div
        className="squisq-preview-player"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: activeDisplayMode === 'linear' ? 'stretch' : 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {activeDisplayMode === 'linear' ? (
          <LinearDocView
            doc={doc!}
            basePath={basePath}
            viewport={activeViewport}
            theme={activeTheme}
          />
        ) : (
          <DocPlayer
            script={previewDoc}
            basePath={basePath}
            showControls
            muted
            forceViewport={activeViewport}
            displayMode={activeDisplayMode}
            theme={activeTheme}
            captionStyle={activeCaptionStyle}
          />
        )}
      </div>
    </div>
  );
}
