/**
 * PreviewPanel
 *
 * Renders a live preview of the current markdown document as a slideshow
 * using the DocPlayer component from @bendyline/squisq-react. The
 * markdown → player-Doc conversion is delegated to the shared
 * `buildPreviewDoc` helper so live preview and the export pipeline stay
 * in sync.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DashboardView, DocPlayer, LinearDocView, useMediaProvider } from '@bendyline/squisq-react';
import type { AudioController, CodeBlockCopyHandler, PlaybackState } from '@bendyline/squisq-react';
import { resolveTransformStyle } from '@bendyline/squisq/transform';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useEditorContext } from './EditorContext';
import { usePreviewSettings } from './PreviewControls';
import { usePreviewProjection } from './usePreviewProjection';
import { documentTitleFromFileName } from './buildPreviewDoc';
import { buildDocumentPreviewMarkdown } from './buildDocumentPreviewMarkdown';
import { PlainHtmlPreview } from './PlainHtmlPreview';
import { TeleprompterView } from './teleprompter/TeleprompterView';
import { usePresentationModeOptional } from './presentation/PresentationMode';
import { usePrintModeOptional } from './print/PrintMode';
import { PrintPreview } from './print/PrintPreview';

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
  /** Delegate authored link activation to the embedding host. */
  onLinkClick?: (href: string) => boolean | undefined;
  /** Show a Copy button on ordinary fenced code blocks (default: false). */
  showCodeCopyButton?: boolean;
  /** Optional host clipboard adapter; otherwise the browser Clipboard API is used. */
  onCopyCode?: CodeBlockCopyHandler;
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Live preview panel that renders the current document as a slideshow
 * or document view. Controls (viewport, mode, theme, transform, captions)
 * are rendered in the main toolbar via PreviewToolbarControls.
 */
export function PreviewPanel({
  basePath = '/',
  className,
  workspaceContainer,
  onLinkClick,
  showCodeCopyButton = false,
  onCopyCode,
}: PreviewPanelProps) {
  const {
    doc,
    parseError,
    isParsing,
    markdownSource,
    mediaRevision,
    setMarkdownSource,
    bumpMediaRevision,
    allowRecording,
    colorScheme,
    fileName,
    fenceRenderers,
  } = useEditorContext();
  const mediaProvider = useMediaProvider();
  const presentation = usePresentationModeOptional();
  const printMode = usePrintModeOptional();
  const {
    activeViewport,
    activeDisplayMode,
    activeTheme,
    activeTransformStyle,
    activeCaptionStyle,
    activeCaptionsEnabled,
    activeVideoPresentation,
    activePipSize,
    activePipShape,
    activePipPosition,
    activeVideoLoop,
    activeCoverSlide,
    activeCoverSlideTemplate,
    activeCoverSlideDuration,
    activeCoverSlidePlayback,
    activeDashboardLayout,
    activeDashboardTitle,
    activeDashboardStyle,
  } = usePreviewSettings();
  const mainSurfaceRef = useRef<HTMLDivElement>(null);
  const popupSurfaceRef = useRef<HTMLDivElement>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);

  const handlePlaybackStateChange = useCallback((next: PlaybackState) => {
    setPlaybackState(next);
  }, []);

  // Build the player-ready Doc whenever the parsed doc changes.
  // Transform runs on the ORIGINAL doc (which has block.contents with
  // markdown body text) so the content extractor can analyze it.
  // Then buildPreviewDoc converts the result for DocPlayer.
  //
  // Audio mapping is async (reads container files), so we use a two-phase
  // approach: first build the base doc synchronously, then resolve audio
  // in an effect and update the state.
  const previewProjection = usePreviewProjection(
    doc,
    activeTransformStyle,
    workspaceContainer,
    documentTitleFromFileName(fileName),
  );

  const previewDoc = previewProjection?.playerDoc ?? null;
  const contentDoc = previewProjection?.contentDoc ?? null;

  // The popup owns no clock, audio, or transport. It follows the primary
  // player's published state while all actions remain inert, keeping the
  // opener the single source of truth.
  const followerAudioController = useMemo<AudioController | null>(() => {
    if (!playbackState || !previewDoc) return null;
    const noOp = () => Promise.resolve();
    return {
      currentTime: playbackState.currentTime,
      isPlaying: playbackState.isPlaying,
      currentSegment: playbackState.currentSegmentIndex,
      totalDuration: playbackState.totalDuration,
      isEnded:
        playbackState.totalDuration > 0 && playbackState.currentTime >= playbackState.totalDuration,
      isReady: true,
      isAvailable: true,
      play: noOp,
      pause: noOp,
      toggle: noOp,
      seekTo: noOp,
      skipToSegment: noOp,
      restart: noOp,
    };
  }, [playbackState, previewDoc]);

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
  const isDashboardMode = activeDisplayMode === 'dashboard';

  useEffect(() => {
    if (presentation?.activeTarget === 'window') return;
    setPlaybackState(null);
  }, [presentation?.activeTarget]);

  // Page and Document have no playback clock, so mirror their normalized
  // scroll position instead. The popup remains pointer-inert: the editor view
  // is the controller and the audience window follows it.
  useEffect(() => {
    if (presentation?.activeTarget !== 'window' || !presentation.popupRoot) return;
    const mainRoot = mainSurfaceRef.current;
    const followerRoot = popupSurfaceRef.current;
    if (!mainRoot || !followerRoot) return;

    if (isPageMode) {
      const source = mainRoot.querySelector<HTMLElement>('.squisq-linear');
      const follower = followerRoot.querySelector<HTMLElement>('.squisq-linear');
      if (!source || !follower) return;
      const sync = () => {
        const sourceRange = Math.max(1, source.scrollHeight - source.clientHeight);
        const followerRange = Math.max(0, follower.scrollHeight - follower.clientHeight);
        follower.scrollTop = (source.scrollTop / sourceRange) * followerRange;
      };
      source.addEventListener('scroll', sync, { passive: true });
      sync();
      return () => source.removeEventListener('scroll', sync);
    }

    if (isDocumentMode) {
      const sourceFrame = mainRoot.querySelector<HTMLIFrameElement>('iframe');
      const followerFrame = followerRoot.querySelector<HTMLIFrameElement>('iframe');
      if (!sourceFrame || !followerFrame) return;
      let detachScroll: (() => void) | null = null;
      const attach = () => {
        detachScroll?.();
        try {
          const sourceWindow = sourceFrame.contentWindow;
          const followerWindow = followerFrame.contentWindow;
          if (!sourceWindow || !followerWindow) return;
          const sync = () => {
            const sourceDoc = sourceWindow.document.documentElement;
            const followerDoc = followerWindow.document.documentElement;
            const sourceRange = Math.max(1, sourceDoc.scrollHeight - sourceWindow.innerHeight);
            const followerRange = Math.max(
              0,
              followerDoc.scrollHeight - followerWindow.innerHeight,
            );
            followerWindow.scrollTo(0, (sourceWindow.scrollY / sourceRange) * followerRange);
          };
          sourceWindow.addEventListener('scroll', sync, { passive: true });
          detachScroll = () => sourceWindow.removeEventListener('scroll', sync);
          sync();
        } catch {
          // The srcDoc frames are same-origin, but a host may tighten their
          // sandbox. In that case the duplicate content remains useful even
          // though scroll mirroring is unavailable.
        }
      };
      sourceFrame.addEventListener('load', attach);
      followerFrame.addEventListener('load', attach);
      attach();
      return () => {
        sourceFrame.removeEventListener('load', attach);
        followerFrame.removeEventListener('load', attach);
        detachScroll?.();
      };
    }
  }, [
    contentDoc,
    documentMarkdown,
    isDocumentMode,
    isPageMode,
    presentation?.activeTarget,
    presentation?.popupRoot,
  ]);

  // Keep the last-good surface mounted while a source update is being parsed.
  // Narrate holds live mic/recording/pacing state, while preview settings such
  // as the theme are persisted through frontmatter; replacing either surface
  // for that brief parse would discard its current position. Initial loading
  // still shows the status because no projection exists yet.
  if (isParsing && !isNarrateMode && !previewDoc) {
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

  const fillsContainer =
    printMode?.active || isDocumentMode || isPageMode || isNarrateMode ? 'stretch' : 'center';
  const audienceWindowOpen = presentation?.activeTarget === 'window';

  const renderSurface = (audience: boolean): ReactNode => {
    if (!audience && printMode?.active) {
      return (
        <PrintPreview
          displayMode={activeDisplayMode}
          previewDoc={previewDoc}
          contentDoc={contentDoc ?? doc}
          documentMarkdown={documentMarkdown}
          basePath={basePath}
          viewport={activeViewport}
          theme={activeTheme}
          showCover={activeCoverSlide}
          transformStyle={activeTransformStyle}
          mediaRevision={mediaRevision}
        />
      );
    }

    if (isDocumentMode) {
      return (
        <PlainHtmlPreview
          markdown={documentMarkdown}
          title={(contentDoc?.frontmatter?.title as string | undefined) ?? undefined}
          mediaProvider={mediaProvider}
          mediaRevision={mediaRevision}
          theme={activeTheme}
          globalKeyboardShortcuts={!audience}
          onLinkClick={onLinkClick}
          showCodeCopyButton={showCodeCopyButton}
          onCopyCode={onCopyCode}
        />
      );
    }

    if (isNarrateMode) {
      if (audience) return null;
      // Narrate keeps one controller/microphone session in the main view and
      // portals only its display surface to the audience window.
      return (
        <TeleprompterView
          doc={doc}
          theme={activeTheme}
          workspaceContainer={workspaceContainer ?? null}
          basePath={basePath}
          presentationTarget={
            presentation?.activeTarget === 'window' ? presentation.popupRoot : null
          }
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
      );
    }

    if (isPageMode) {
      return (
        <LinearDocView
          doc={contentDoc ?? doc!}
          basePath={basePath}
          viewport={activeViewport}
          theme={activeTheme}
          globalKeyboardShortcuts={!audience}
          showCover={activeCoverSlide}
          transformPage={
            activeTransformStyle ? resolveTransformStyle(activeTransformStyle).page : undefined
          }
          showCodeCopyButton={showCodeCopyButton}
          onCopyCode={onCopyCode}
          fenceRenderers={fenceRenderers ?? undefined}
        />
      );
    }

    if (isDashboardMode) {
      // A static canvas: the audience window renders the identical view —
      // there is no clock or scroll position to mirror. `contentDoc` keeps
      // the transform applied while `materializeDashboard` runs its own
      // slide projection (image interleaving off) internally. The fit
      // wrapper contain-fits the canvas inside the preview surface (a
      // portrait dashboard scales down instead of clipping at the fold).
      return (
        <div className="squisq-dashboard-fit">
          <DashboardView
            doc={contentDoc ?? doc!}
            basePath={basePath}
            viewport={activeViewport}
            theme={activeTheme}
            layout={activeDashboardLayout}
            showTitle={activeDashboardTitle}
            style={activeDashboardStyle}
            documentTitle={documentTitleFromFileName(fileName)}
          />
        </div>
      );
    }

    if (audience && !followerAudioController) {
      return <div className="squisq-presentation-connecting">Connecting presentation...</div>;
    }

    const audienceCaptionMode = playbackState?.captionMode;
    // The primary preview owns audible playback. A synchronized audience
    // window follows its clock but stays silent to avoid echo.
    return (
      <DocPlayer
        // A style change replaces the slide sequence. Remounting clears state
        // belonging to the previous transformed deck in both render targets.
        key={`${audience ? 'audience' : 'primary'}-${activeTransformStyle || 'none'}`}
        doc={previewDoc!}
        basePath={basePath}
        audioMode={previewProjection?.contentDoc.audio?.segments?.length ? 'media' : 'synthetic'}
        showControls={!audience}
        muted={audience}
        forceViewport={activeViewport}
        displayMode={activeDisplayMode}
        theme={activeTheme}
        videoPresentation={activeVideoPresentation}
        pipSize={activePipSize}
        pipShape={activePipShape}
        pipPosition={activePipPosition}
        loop={!audience && activeDisplayMode === 'video' && activeVideoLoop}
        captionStyle={audienceCaptionMode === 'social' ? 'social' : activeCaptionStyle}
        captionsEnabled={
          audience && audienceCaptionMode ? audienceCaptionMode !== 'off' : activeCaptionsEnabled
        }
        showCoverSlide={activeCoverSlide}
        coverSlideTemplate={activeCoverSlideTemplate}
        coverSlideDuration={activeCoverSlideDuration}
        coverSlidePlayback={activeCoverSlidePlayback}
        coverVisible={audience ? playbackState?.isCoverVisible : undefined}
        audioController={audience ? followerAudioController! : undefined}
        enableSwipe={!audience}
        globalKeyboardShortcuts={!audience}
        showCodeCopyButton={showCodeCopyButton}
        onCopyCode={onCopyCode}
        onPlaybackStateChange={
          !audience && audienceWindowOpen ? handlePlaybackStateChange : undefined
        }
      />
    );
  };

  const surfaceStyle = {
    flex: 1,
    display: 'flex',
    alignItems: fillsContainer,
    justifyContent: 'center',
    overflow: 'hidden',
    minHeight: 0,
    background: presentation?.activeTarget ? activeTheme.colors.background : undefined,
  } as const;

  return (
    <>
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
        <div ref={mainSurfaceRef} className="squisq-preview-player" style={surfaceStyle}>
          {renderSurface(false)}
        </div>
      </div>
      {audienceWindowOpen && presentation?.popupRoot && !isNarrateMode
        ? createPortal(
            <div
              className="squisq-editor-shell squisq-presentation-window"
              data-theme={colorScheme}
            >
              <div className="squisq-preview-container squisq-presentation-window-preview">
                <div
                  ref={popupSurfaceRef}
                  className="squisq-preview-player squisq-presentation-window-surface"
                  style={surfaceStyle}
                  aria-label="Audience presentation"
                >
                  {renderSurface(true)}
                </div>
              </div>
            </div>,
            presentation.popupRoot,
          )
        : null}
    </>
  );
}
