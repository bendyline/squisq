/**
 * PlayPauseIcon Component
 *
 * The glyph inside every doc player's Play/Pause button: a triangle when
 * paused, two bars when playing, and, while playback has been requested but
 * no sound has started yet (`isBuffering`), smaller bars inside a spinning
 * ring. The button keeps its Pause meaning while loading, so a second press
 * still cancels the pending start.
 *
 * The animation is SVG-native (SMIL), not CSS, because hosts style the
 * control bars themselves and may not load this package's stylesheet. The
 * ring fades in after a short delay so a load that finishes quickly never
 * flickers a spinner, and it holds still for readers who ask for reduced
 * motion. An engine without SMIL support simply shows the bars without the
 * ring.
 *
 * Related Files:
 * - DocControlsBottom.tsx, DocControlsOverlay.tsx, DocControlsSidebar.tsx --
 *   the three control layouts that render this icon
 * - hooks/useAudioSync.ts -- derives `isBuffering` from the media element
 * - types.ts -- PlaybackState.isBuffering
 */

/** How long a start may take before the loading ring appears. */
const SPINNER_DELAY_SECONDS = 0.15;

/**
 * The glyph is decorative, so it never takes the click: the button does. A
 * fresh <svg> replaces the old one as soon as playback is requested, and a
 * click whose target was the replaced node would reach the player stage
 * detached from its button, which then reads it as a tap on the stage and
 * toggles playback a second time.
 */
const ICON_STYLE = { pointerEvents: 'none' } as const;

/** Circumference of the ring (r = 10.5), for the visible-arc dash pattern. */
const RING_CIRCUMFERENCE = 2 * Math.PI * 10.5;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface PlayPauseIconProps {
  isPlaying: boolean;
  isBuffering?: boolean;
  /** Rendered width and height in CSS pixels. */
  size: number;
}

export function PlayPauseIcon({ isPlaying, isBuffering = false, size }: PlayPauseIconProps) {
  if (isPlaying && isBuffering) {
    const arc = RING_CIRCUMFERENCE / 4;
    return (
      // A fresh <svg> per state restarts its animation timeline, so the
      // fade-in delay counts from the moment loading began.
      <svg
        key="buffering"
        viewBox="0 0 24 24"
        fill="currentColor"
        width={size}
        height={size}
        aria-hidden="true"
        style={ICON_STYLE}
        data-testid="play-pause-buffering"
      >
        <path d="M9 8h2v8H9zm4 0h2v8h-2z" />
        <g opacity="0">
          <animate
            attributeName="opacity"
            from="0"
            to="1"
            begin={`${SPINNER_DELAY_SECONDS}s`}
            dur="0.2s"
            fill="freeze"
          />
          <circle
            cx="12"
            cy="12"
            r="10.5"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="2"
          />
          <circle
            cx="12"
            cy="12"
            r="10.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${RING_CIRCUMFERENCE - arc}`}
          >
            {!prefersReducedMotion() && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 12 12"
                to="360 12 12"
                dur="0.9s"
                repeatCount="indefinite"
              />
            )}
          </circle>
        </g>
      </svg>
    );
  }

  return (
    <svg
      key={isPlaying ? 'pause' : 'play'}
      viewBox="0 0 24 24"
      fill="currentColor"
      width={size}
      height={size}
      aria-hidden="true"
      style={ICON_STYLE}
    >
      {isPlaying ? <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /> : <path d="M8 5v14l11-7z" />}
    </svg>
  );
}
