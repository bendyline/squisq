/**
 * TimelineCompositionPanel
 *
 * A compact Video-mode DocPlayer driven by the Timeline clock. It uses the
 * same projection and preview settings as the primary Video surface, showing
 * the authored slide and scheduled video as one composed frame.
 */

import { useMemo } from 'react';
import type { Doc } from '@bendyline/squisq/schemas';
import { getDocPlaybackDuration, resolveMediaSchedule } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { DocPlayer, type AudioController } from '@bendyline/squisq-react';
import { usePreviewSettings } from './PreviewControls';
import type { TimelineClock } from './useTimelineClock';
import { usePreviewProjection } from './usePreviewProjection';
import { documentTitleFromFileName } from './buildPreviewDoc';
import { useEditorContext } from './EditorContext';

export interface TimelineCompositionPanelProps {
  doc: Doc | null;
  clock: TimelineClock;
  basePath?: string;
  workspaceContainer?: ContentContainer | null;
  onClose?: () => void;
}

export function TimelineCompositionPanel({
  doc,
  clock,
  basePath = '/',
  workspaceContainer,
  onClose,
}: TimelineCompositionPanelProps) {
  const {
    activeViewport,
    activeTheme,
    activeTransformStyle,
    activeCaptionStyle,
    activeCaptionsEnabled,
    activeVideoPresentation,
    activePipShape,
    activePipPosition,
    activeCoverSlide,
  } = usePreviewSettings();
  const { fileName } = useEditorContext();
  const projection = usePreviewProjection(
    doc,
    activeTransformStyle,
    workspaceContainer,
    documentTitleFromFileName(fileName),
  );
  const playerDoc = projection?.playerDoc ?? null;
  const totalDuration = useMemo(
    () => (playerDoc ? getDocPlaybackDuration(playerDoc) : 0),
    [playerDoc],
  );
  const effectiveVideoPresentation = useMemo(() => {
    if (!playerDoc) return activeVideoPresentation;
    const activeVideo = resolveMediaSchedule(playerDoc).find(
      (clip) =>
        clip.kind === 'video' &&
        clock.currentTime >= clip.absoluteStart &&
        clock.currentTime < clip.absoluteEnd,
    );
    if (activeVideo?.placement === 'picture-in-picture') return 'picture-in-picture';
    if (activeVideo?.placement === 'overlay') return 'full-frame';
    return activeVideoPresentation;
  }, [activeVideoPresentation, clock.currentTime, playerDoc]);

  const audioController = useMemo<AudioController>(
    () => ({
      currentTime: clock.currentTime,
      isPlaying: clock.isPlaying,
      currentSegment: 0,
      totalDuration,
      isEnded: totalDuration > 0 && clock.currentTime >= totalDuration,
      isReady: true,
      isAvailable: true,
      play: async () => clock.play(),
      pause: async () => clock.pause(),
      toggle: async () => clock.toggle(),
      seekTo: async (time) => clock.seek(time),
      skipToSegment: async () => undefined,
      restart: async () => clock.seek(0),
    }),
    [clock, totalDuration],
  );

  return (
    <aside
      className="squisq-timeline-preview-panel squisq-timeline-composition-panel"
      data-testid="timeline-composition-panel"
      aria-label="Timeline video composition preview"
    >
      <header className="squisq-timeline-video-header">
        <span className="squisq-timeline-video-title">Video composition</span>
        <span className="squisq-timeline-video-label">
          {formatPresentation(effectiveVideoPresentation)}
        </span>
        <span className="squisq-timeline-video-time">{formatClock(clock.currentTime)}</span>
        {onClose && (
          <button
            type="button"
            className="squisq-timeline-video-close"
            onClick={onClose}
            aria-label="Hide video composition"
            data-tooltip="Hide video composition"
          >
            ×
          </button>
        )}
      </header>
      <div className="squisq-timeline-video-body">
        <div className="squisq-timeline-composition-stage">
          {playerDoc ? (
            <DocPlayer
              doc={playerDoc}
              basePath={basePath}
              audioController={audioController}
              showControls={false}
              showScrubber={false}
              muted
              forceViewport={activeViewport}
              displayMode="video"
              theme={activeTheme}
              videoPresentation={activeVideoPresentation}
              pipShape={activePipShape}
              pipPosition={activePipPosition}
              captionStyle={activeCaptionStyle}
              captionsEnabled={activeCaptionsEnabled}
              showCoverSlide={activeCoverSlide}
              coverVisible={false}
              enableSwipe={false}
              globalKeyboardShortcuts={false}
            />
          ) : (
            <div className="squisq-timeline-video-empty">Preparing video composition…</div>
          )}
        </div>
      </div>
    </aside>
  );
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

function formatPresentation(presentation: string): string {
  if (presentation === 'picture-in-picture') return 'Picture in picture';
  if (presentation === 'full-frame') return 'Overlay';
  return 'Background';
}
