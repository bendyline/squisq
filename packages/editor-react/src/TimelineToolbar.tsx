/** Horizontal controls for Timeline-only companion panes. */

export interface TimelineToolbarProps {
  literalVideoVisible: boolean;
  compositionVisible: boolean;
  videoAvailable: boolean;
  compositionAvailable: boolean;
  onToggleLiteralVideo: () => void;
  onToggleComposition: () => void;
}

export function TimelineToolbar({
  literalVideoVisible,
  compositionVisible,
  videoAvailable,
  compositionAvailable,
  onToggleLiteralVideo,
  onToggleComposition,
}: TimelineToolbarProps) {
  return (
    <div
      className="squisq-timeline-toolbar"
      role="toolbar"
      aria-label="Timeline view controls"
      data-testid="timeline-toolbar"
    >
      <span className="squisq-timeline-toolbar-title">Preview panes</span>
      <button
        type="button"
        className="squisq-timeline-pane-toggle"
        onClick={onToggleLiteralVideo}
        disabled={!videoAvailable}
        aria-pressed={literalVideoVisible}
        data-testid="timeline-literal-video-toggle"
        data-tooltip={literalVideoVisible ? 'Hide literal video' : 'Show literal video'}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
          <rect
            x="1.5"
            y="3"
            width="8.5"
            height="9"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M10 5.5 13.5 4v7L10 9.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span>Video monitor</span>
      </button>
      <button
        type="button"
        className="squisq-timeline-pane-toggle"
        onClick={onToggleComposition}
        disabled={!compositionAvailable}
        aria-pressed={compositionVisible}
        data-testid="timeline-composition-toggle"
        data-tooltip={compositionVisible ? 'Hide video composition' : 'Show video composition'}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
          <rect
            x="1.5"
            y="2"
            width="12"
            height="9"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M5 13h5M7.5 11v2" stroke="currentColor" strokeWidth="1.4" />
          <path d="m6.3 5 3 1.5-3 1.5z" fill="currentColor" />
        </svg>
        <span>Video composition</span>
      </button>
    </div>
  );
}
