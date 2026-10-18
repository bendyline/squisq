/**
 * SocialCaptionOverlay Component
 *
 * Social media-style captions (Instagram/TikTok): large centered words
 * showing 2-6 words at a time on at most two rows (SOCIAL_CAPTION_MAX_ROWS),
 * with the currently-spoken word highlighted as a filled pill in the theme's
 * primary color over a soft dark backdrop. Font and colors come from the
 * active theme; type is scaled to the frame's narrower axis, and the band
 * sits above the region short-form players cover with their UI. A third row
 * would climb into the middle of a portrait frame, over the picture.
 *
 * Words are gathered across all caption phrases into a continuous stream,
 * then chunked into uniform groups for smooth, consistent pacing. A chunk
 * closes early when its next word would need a third row or when the
 * narration moves to another audio segment (socialCaptionLayout.ts, which
 * predicts wrapping from a measured per-character width table). A single
 * word wider than a row shrinks its chunk.
 *
 * Supports two timing modes:
 * 1. Precise: uses per-word timestamps from CaptionPhrase.words
 * 2. Interpolated: distributes timing evenly within each phrase
 */

import { useMemo } from 'react';
import type { CaptionTrack, ViewportConfig } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import { resolveFontFamily } from '@bendyline/squisq/schemas';
import type { CaptionPosition } from './types';
import {
  buildWordStream,
  estimateSocialWordEm,
  SOCIAL_CAPTION_LAYOUT,
  type WordChunk,
} from './socialCaptionLayout';

const { wordPadEm, columnGapEm, chunkPadXEm, letterSpacingEm } = SOCIAL_CAPTION_LAYOUT;

/**
 * Frame placement for the overlay band. Portrait frames keep a larger bottom
 * inset: short-form players (Shorts, Reels, TikTok) cover roughly the lowest
 * fifth of the frame with their own UI, and image-credit strips sit at the
 * very bottom of many slides.
 */
function positionStyle(position: CaptionPosition, portrait: boolean): React.CSSProperties {
  switch (position) {
    case 'top':
      return { top: portrait ? '12%' : '8%' };
    case 'center':
      return { top: '50%', transform: 'translateY(-50%)' };
    default:
      return { bottom: portrait ? '24%' : '16%' };
  }
}

/** Highlight/primary colour needs readable text on top of it. */
function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma > 150 ? '#111111' : '#ffffff';
}

/**
 * How long a chunk stays up after its last word, in seconds. Bridges the
 * pauses between sentences without flicker, but clears the frame for silent
 * stretches — a long pause, or a closing card after the narration ends.
 */
export const SOCIAL_CAPTION_HOLD_SECONDS = 1;

interface SocialCaptionOverlayProps {
  captions: CaptionTrack | undefined;
  currentTime: number;
  enabled?: boolean;
  theme?: Theme;
  viewport?: ViewportConfig;
  /** Frame placement (default `'bottom'`). */
  position?: CaptionPosition;
}

export function SocialCaptionOverlay({
  captions,
  currentTime,
  enabled = true,
  theme,
  viewport,
  position = 'bottom',
}: SocialCaptionOverlayProps) {
  // Scale the type to the frame's narrower axis: ~5.5% of the height on a
  // landscape frame, ~6.8% of the width on a portrait one, where a chunk then
  // fits two rows of three or four words.
  const viewportWidth = viewport?.width ?? 1280;
  const viewportHeight = viewport?.height ?? 720;
  const portrait = viewportHeight > viewportWidth;
  const baseFontSize = Math.min(viewportHeight * 0.055, viewportWidth * 0.068);
  const fontSize = Math.max(22, Math.min(96, Math.round(baseFontSize)));
  const sidePadding = portrait ? 0.07 : 0.1;
  // Width of one caption row in em: the band less its side padding and the chunk's own.
  const rowEm = (viewportWidth * (1 - 2 * sidePadding)) / fontSize - 2 * chunkPadXEm;

  // Build the word stream once when captions or the row width change (memoized)
  const { chunks } = useMemo(
    () => (captions ? buildWordStream(captions, rowEm) : { words: [], chunks: [] }),
    [captions, rowEm],
  );

  if (!enabled || chunks.length === 0) {
    return (
      <div
        className="social-caption-overlay"
        style={{
          position: 'absolute',
          ...positionStyle(position, portrait),
          left: 0,
          right: 0,
          zIndex: 50,
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.15s ease-in-out',
        }}
      />
    );
  }

  // Find the active chunk and word using binary-style search
  let activeChunk: WordChunk | null = null;
  let activeWordIndex = -1;

  for (const chunk of chunks) {
    if (currentTime >= chunk.startTime && currentTime < chunk.endTime) {
      activeChunk = chunk;
      break;
    }
  }

  // Between chunks (a gap) or past the last one: keep the chunk we just left
  // up for a moment (feels more natural than blinking off), then clear.
  if (!activeChunk) {
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (currentTime >= chunks[i].endTime) {
        if (currentTime < chunks[i].endTime + SOCIAL_CAPTION_HOLD_SECONDS) {
          activeChunk = chunks[i];
          activeWordIndex = activeChunk.words.length - 1;
        }
        break;
      }
    }
  }

  if (!activeChunk) return null;

  // Find active word within chunk (if not already set from gap handling)
  if (activeWordIndex === -1) {
    for (let i = 0; i < activeChunk.words.length; i++) {
      const word = activeChunk.words[i];
      if (currentTime >= word.startTime && currentTime < word.endTime) {
        activeWordIndex = i;
        break;
      }
    }
    // Fallback: last word before currentTime
    if (activeWordIndex === -1) {
      for (let i = activeChunk.words.length - 1; i >= 0; i--) {
        if (currentTime >= activeChunk.words[i].startTime) {
          activeWordIndex = i;
          break;
        }
      }
    }
    // Final fallback
    if (activeWordIndex === -1) activeWordIndex = 0;
  }

  // Theme-derived styling
  const primaryColor = theme?.colors?.primary ?? '#5b9bd5';
  const fontFamily = theme?.typography?.titleFont
    ? resolveFontFamily(theme.typography.titleFont, '"PT Serif", Georgia, serif')
    : '"PT Serif", Georgia, serif';

  // A word wider than a whole row (a long compound, a URL) shrinks this chunk
  // until it fits, rather than overflowing the frame or taking a third row.
  const widestEm = Math.max(...activeChunk.words.map((w) => estimateSocialWordEm(w.text)));
  const chunkFontSize =
    widestEm > rowEm ? Math.max(16, Math.floor((fontSize * rowEm) / widestEm)) : fontSize;

  return (
    <div
      className="social-caption-overlay"
      style={{
        position: 'absolute',
        ...positionStyle(position, portrait),
        left: 0,
        right: 0,
        zIndex: 50,
        pointerEvents: 'none',
        display: 'flex',
        justifyContent: 'center',
        padding: `0 ${sidePadding * 100}%`,
        boxSizing: 'border-box',
        opacity: 1,
        transition: 'opacity 0.15s ease-in-out',
      }}
    >
      <div
        className="social-caption-overlay__chunk"
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'baseline',
          maxWidth: '100%',
          rowGap: '0.12em',
          columnGap: `${columnGapEm}em`,
          padding: `0.22em ${chunkPadXEm}em`,
          borderRadius: '0.4em',
          background: 'rgba(10, 10, 12, 0.42)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          fontFamily,
          fontSize: `${chunkFontSize}px`,
          lineHeight: 1.18,
          textTransform: 'uppercase',
          letterSpacing: `${letterSpacingEm}em`,
          whiteSpace: 'normal',
        }}
      >
        {activeChunk.words.map((word, i) => {
          const isActive = i === activeWordIndex;
          return (
            <span
              key={`${word.startTime}-${i}`}
              className={
                isActive ? 'social-caption-overlay__word is-active' : 'social-caption-overlay__word'
              }
              style={{
                display: 'inline-block',
                whiteSpace: 'nowrap',
                padding: `0 ${wordPadEm}em`,
                borderRadius: '0.18em',
                fontWeight: 800,
                color: isActive ? contrastText(primaryColor) : 'rgba(255, 255, 255, 0.95)',
                background: isActive ? primaryColor : 'transparent',
                textShadow: isActive
                  ? 'none'
                  : '0 2px 6px rgba(0,0,0,0.75), 0 0 18px rgba(0,0,0,0.45)',
                transform: isActive ? 'scale(1.05)' : 'none',
                transition: 'color 0.1s ease, background-color 0.1s ease, transform 0.1s ease',
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
