/**
 * SocialCaptionOverlay Component
 *
 * Social media-style captions (Instagram/TikTok): large centered words
 * showing 3-5 words at a time, wrapped onto as many rows as the frame needs,
 * with the currently-spoken word highlighted as a filled pill in the theme's
 * primary color over a soft dark backdrop. Font and colors come from the
 * active theme; type is scaled to the frame's narrower axis so portrait
 * frames get two or three short rows instead of one overflowing line, and
 * the band sits above the region short-form players cover with their UI.
 *
 * Words are gathered across all caption phrases into a continuous stream,
 * then chunked into uniform groups for smooth, consistent pacing.
 *
 * Supports two timing modes:
 * 1. Precise: uses per-word timestamps from CaptionPhrase.words
 * 2. Interpolated: distributes timing evenly within each phrase
 */

import { useMemo } from 'react';
import type { CaptionTrack, CaptionPhrase, ViewportConfig } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import { resolveFontFamily } from '@bendyline/squisq/schemas';
import type { CaptionPosition } from './types';

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

/** Target words per visible chunk. */
const TARGET_CHUNK_SIZE = 4;
const MIN_CHUNK_SIZE = 2;
const MAX_CHUNK_SIZE = 6;

/** A timed word derived from phrase data. */
interface TimedWord {
  text: string;
  startTime: number;
  endTime: number;
}

/** A chunk of words displayed together. */
interface WordChunk {
  words: TimedWord[];
  startTime: number;
  endTime: number;
}

/**
 * Resolve per-word timing for a single phrase.
 * Uses precise word timestamps when available, otherwise interpolates.
 */
function resolvePhraseTiming(phrase: CaptionPhrase): TimedWord[] {
  // Use precise timing when available
  if (phrase.words && phrase.words.length > 0) {
    return phrase.words.map((w) => ({
      text: w.text,
      startTime: w.startTime,
      endTime: w.endTime,
    }));
  }

  // Interpolate: split text into words, distribute evenly
  const rawWords = phrase.text.split(/\s+/).filter((w) => w.length > 0);
  if (rawWords.length === 0) return [];

  const duration = phrase.endTime - phrase.startTime;
  const wordDuration = duration / rawWords.length;

  return rawWords.map((text, i) => ({
    text,
    startTime: phrase.startTime + i * wordDuration,
    endTime: phrase.startTime + (i + 1) * wordDuration,
  }));
}

/**
 * Build a continuous stream of timed words from ALL caption phrases,
 * then group into uniform display chunks. This eliminates the "pulsy"
 * feeling caused by per-phrase chunking with variable phrase lengths.
 */
function buildWordStream(captions: CaptionTrack): { words: TimedWord[]; chunks: WordChunk[] } {
  // Gather all words across all phrases
  const allWords: TimedWord[] = [];
  for (const phrase of captions.phrases) {
    allWords.push(...resolvePhraseTiming(phrase));
  }

  if (allWords.length === 0) return { words: [], chunks: [] };

  // Determine uniform chunk size
  let chunkSize = TARGET_CHUNK_SIZE;
  if (allWords.length > chunkSize) {
    const numChunks = Math.ceil(allWords.length / chunkSize);
    chunkSize = Math.ceil(allWords.length / numChunks);
    chunkSize = Math.min(MAX_CHUNK_SIZE, Math.max(MIN_CHUNK_SIZE, chunkSize));
  } else {
    chunkSize = Math.max(MIN_CHUNK_SIZE, allWords.length);
  }

  // Build chunks
  const chunks: WordChunk[] = [];
  for (let i = 0; i < allWords.length; i += chunkSize) {
    const chunkWords = allWords.slice(i, i + chunkSize);
    chunks.push({
      words: chunkWords,
      startTime: chunkWords[0].startTime,
      endTime: chunkWords[chunkWords.length - 1].endTime,
    });
  }

  return { words: allWords, chunks };
}

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
  // Build the word stream once when captions change (memoized)
  const { chunks } = useMemo(
    () => (captions ? buildWordStream(captions) : { words: [], chunks: [] }),
    [captions],
  );

  if (!enabled || chunks.length === 0) {
    return (
      <div
        className="social-caption-overlay"
        style={{
          position: 'absolute',
          ...positionStyle(position, (viewport?.height ?? 0) > (viewport?.width ?? 1)),
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

  // If between chunks (gap), show the nearest chunk
  if (!activeChunk) {
    for (let i = 0; i < chunks.length - 1; i++) {
      if (currentTime >= chunks[i].endTime && currentTime < chunks[i + 1].startTime) {
        // In a gap — show the chunk we just left (feels more natural)
        activeChunk = chunks[i];
        activeWordIndex = activeChunk.words.length - 1;
        break;
      }
    }
    // Past all chunks
    if (!activeChunk && chunks.length > 0 && currentTime >= chunks[chunks.length - 1].startTime) {
      activeChunk = chunks[chunks.length - 1];
      activeWordIndex = activeChunk.words.length - 1;
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

  // Scale the type to the frame's narrower axis so a chunk wraps onto two or
  // three short rows in portrait instead of overflowing the width: ~5.5% of
  // the height on a landscape frame, ~8.2% of the width on a portrait one.
  const viewportWidth = viewport?.width ?? 1280;
  const viewportHeight = viewport?.height ?? 720;
  const portrait = viewportHeight > viewportWidth;
  const baseFontSize = Math.min(viewportHeight * 0.055, viewportWidth * 0.082);
  const fontSize = Math.max(22, Math.min(96, Math.round(baseFontSize)));

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
        padding: portrait ? '0 7%' : '0 10%',
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
          columnGap: '0.28em',
          padding: '0.22em 0.55em',
          borderRadius: '0.4em',
          background: 'rgba(10, 10, 12, 0.42)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          fontFamily,
          fontSize: `${fontSize}px`,
          lineHeight: 1.18,
          textTransform: 'uppercase',
          letterSpacing: '0.01em',
          whiteSpace: 'normal',
        }}
      >
        {activeChunk.words.map((word, i) => {
          const isActive = i === activeWordIndex;
          return (
            <span
              key={`${word.startTime}-${i}`}
              className={isActive ? 'social-caption-overlay__word is-active' : 'social-caption-overlay__word'}
              style={{
                display: 'inline-block',
                whiteSpace: 'nowrap',
                padding: '0 0.16em',
                borderRadius: '0.18em',
                fontWeight: 800,
                color: isActive ? contrastText(primaryColor) : 'rgba(255, 255, 255, 0.95)',
                background: isActive ? primaryColor : 'transparent',
                textShadow: isActive ? 'none' : '0 2px 6px rgba(0,0,0,0.75), 0 0 18px rgba(0,0,0,0.45)',
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
