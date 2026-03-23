/**
 * SocialCaptionOverlay Component
 *
 * Social media-style captions (Instagram/TikTok): large centered words
 * showing 3-5 words at a time with the currently-spoken word highlighted
 * in the theme's primary color. Font and colors are pulled from the
 * active theme.
 *
 * Words are gathered across all caption phrases into a continuous stream,
 * then chunked into uniform groups for smooth, consistent pacing.
 *
 * Supports two timing modes:
 * 1. Precise: uses per-word timestamps from CaptionPhrase.words
 * 2. Interpolated: distributes timing evenly within each phrase
 */

import { useMemo } from 'react';
import type { CaptionTrack, CaptionPhrase, CaptionWord, ViewportConfig } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';

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
    return phrase.words.map(w => ({
      text: w.text,
      startTime: w.startTime,
      endTime: w.endTime,
    }));
  }

  // Interpolate: split text into words, distribute evenly
  const rawWords = phrase.text.split(/\s+/).filter(w => w.length > 0);
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
}

export function SocialCaptionOverlay({
  captions,
  currentTime,
  enabled = true,
  theme,
  viewport,
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
          bottom: '18%',
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
  const fontFamily = theme?.typography?.titleFontFamily
    ? `"${theme.typography.titleFontFamily}", system-ui, sans-serif`
    : '"PT Serif", Georgia, serif';

  // Scale font to viewport — aim for ~5.5% of viewport height
  const viewportHeight = viewport?.height ?? 720;
  const baseFontSize = Math.round(viewportHeight * 0.055);
  const fontSize = Math.max(24, Math.min(72, baseFontSize));

  return (
    <div
      className="social-caption-overlay"
      style={{
        position: 'absolute',
        bottom: '18%',
        left: 0,
        right: 0,
        zIndex: 50,
        pointerEvents: 'none',
        textAlign: 'center',
        padding: '0 8%',
        boxSizing: 'border-box',
        opacity: 1,
        transition: 'opacity 0.15s ease-in-out',
      }}
    >
      <div
        style={{
          display: 'inline-block',
          lineHeight: 1.3,
        }}
      >
        {activeChunk.words.map((word, i) => {
          const isActive = i === activeWordIndex;
          return (
            <span
              key={`${word.startTime}-${i}`}
              style={{
                fontFamily,
                fontSize: `${fontSize}px`,
                fontWeight: isActive ? 800 : 600,
                color: isActive ? primaryColor : 'rgba(255, 255, 255, 0.9)',
                textShadow: '0 2px 8px rgba(0,0,0,0.7), 0 0 20px rgba(0,0,0,0.4)',
                marginRight: i < activeChunk!.words.length - 1 ? '0.3em' : undefined,
                transition: 'color 0.1s ease, font-weight 0.1s ease',
                textTransform: 'uppercase',
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
