/**
 * TimelineVideoPanel
 *
 * A docked, timeline-driven video monitor for block-at-a-time editing. It
 * deliberately exposes no native video controls: the timeline clock is the
 * single source of truth, so clicking or dragging the playhead always selects
 * the displayed frame.
 */

import { useMemo } from 'react';
import type { ScheduledClip } from '@bendyline/squisq/schemas';
import { MediaClipLayer } from '@bendyline/squisq-react';

export interface TimelineVideoPanelProps {
  schedule: ScheduledClip[];
  currentTime: number;
  isPlaying: boolean;
  basePath?: string;
  onClose?: () => void;
}

export function TimelineVideoPanel({
  schedule,
  currentTime,
  isPlaying,
  basePath = '/',
  onClose,
}: TimelineVideoPanelProps) {
  const videos = useMemo(() => schedule.filter((clip) => clip.kind === 'video'), [schedule]);
  const activeVideos = videos.filter(
    (clip) => currentTime >= clip.absoluteStart && currentTime < clip.absoluteEnd,
  );
  const activeLabel =
    activeVideos.length === 1
      ? clipName(activeVideos[0].src)
      : activeVideos.length > 1
        ? `${activeVideos.length} video clips`
        : 'No video at this time';

  return (
    <aside
      className="squisq-timeline-preview-panel squisq-timeline-video-panel"
      data-testid="timeline-video-panel"
      aria-label="Timeline video preview"
    >
      <header className="squisq-timeline-video-header">
        <span className="squisq-timeline-video-title">Literal video</span>
        <span className="squisq-timeline-video-label" title={activeLabel}>
          {activeLabel}
        </span>
        <span className="squisq-timeline-video-time">{formatClock(currentTime)}</span>
        {onClose && (
          <button
            type="button"
            className="squisq-timeline-video-close"
            onClick={onClose}
            aria-label="Hide video preview"
            data-tooltip="Hide video preview"
          >
            ×
          </button>
        )}
      </header>
      <div className="squisq-timeline-video-body">
        <div className="squisq-timeline-video-stage">
          <MediaClipLayer
            schedule={videos}
            currentTime={currentTime}
            isPlaying={isPlaying}
            basePath={basePath}
            presentation="full-frame"
            honorClipPresentation={false}
            muted
          />
          {activeVideos.length === 0 && (
            <div className="squisq-timeline-video-empty">Move the playhead onto a video clip</div>
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

function clipName(src: string): string {
  return src.split('/').pop() ?? src;
}
