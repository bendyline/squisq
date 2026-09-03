/**
 * CaptionOverlay Component
 *
 * Displays closed captions synchronized with audio playback.
 * Supports two styles:
 *
 * - `'standard'` (default): Traditional broadcast captions — small white text
 *   on a semi-transparent black badge at the top of the player.
 * - `'social'`: Social media-style (Instagram/TikTok) — large centered words
 *   with the active word highlighted in the theme's primary color.
 */

import type { CaptionTrack, ViewportConfig } from '@bendyline/squisq/schemas';
import { getCaptionAtTime } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import type { CaptionPosition, CaptionStyle } from './types';
import { SocialCaptionOverlay } from './SocialCaptionOverlay';

interface CaptionOverlayProps {
  /** Caption track with timestamped phrases */
  captions: CaptionTrack | undefined;
  /** Current playback time in seconds */
  currentTime: number;
  /** Whether captions are enabled */
  enabled?: boolean;
  /** Font size in pixels for standard style (default: 16) */
  fontSize?: number;
  /** Caption display style (default: 'standard') */
  captionStyle?: CaptionStyle;
  /**
   * Frame placement. Omitted → each style's classic spot: standard at the
   * top edge, social in the lower band.
   */
  captionPosition?: CaptionPosition;
  /** Theme for social-style caption colors and fonts */
  theme?: Theme;
  /** Viewport config for social-style font scaling */
  viewport?: ViewportConfig;
}

/** Standard-style band placement. */
function standardPositionStyle(position: CaptionPosition): React.CSSProperties {
  switch (position) {
    case 'bottom':
      return { bottom: '6px', left: '50%', transform: 'translateX(-50%)' };
    case 'center':
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    default:
      return { top: '6px', left: '50%', transform: 'translateX(-50%)' };
  }
}

export function CaptionOverlay({
  captions,
  currentTime,
  enabled = true,
  fontSize = 16,
  captionStyle = 'standard',
  captionPosition,
  theme,
  viewport,
}: CaptionOverlayProps) {
  // Delegate to social overlay when that style is active
  if (captionStyle === 'social') {
    return (
      <SocialCaptionOverlay
        captions={captions}
        currentTime={currentTime}
        enabled={enabled}
        theme={theme}
        viewport={viewport}
        position={captionPosition ?? 'bottom'}
      />
    );
  }

  // Standard caption rendering
  const phrase = enabled && captions ? getCaptionAtTime(captions, currentTime) : null;
  const captionText = phrase?.text ?? null;

  return (
    <div
      className="caption-overlay"
      style={{
        position: 'absolute',
        ...standardPositionStyle(captionPosition ?? 'top'),
        zIndex: 50,
        pointerEvents: 'none',
        maxWidth: '100%',
        width: '100%',
        textAlign: 'center',
        opacity: captionText ? 1 : 0,
        transition: 'opacity 0.15s ease-in-out',
        padding: '0 4px',
        boxSizing: 'border-box',
      }}
    >
      {captionText && (
        <div
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            background: 'rgba(0, 0, 0, 0.65)',
            borderRadius: '4px',
            backdropFilter: 'blur(4px)',
          }}
        >
          <span
            style={{
              color: '#ffffff',
              fontSize: `${fontSize}px`,
              fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
              fontWeight: 500,
              lineHeight: 1.25,
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
            }}
          >
            {captionText}
          </span>
        </div>
      )}
    </div>
  );
}

export default CaptionOverlay;
