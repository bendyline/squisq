/**
 * DocControlsSlideshow Component
 *
 * Compact slide navigation controls for the DocPlayer slideshow display mode.
 * Renders in the lower-right corner with previous / slide counter / next buttons,
 * similar to PowerPoint/Keynote presentation navigation.
 *
 * Related Files:
 * - DocPlayer.tsx — Parent component (renders this when displayMode='slideshow')
 * - DocControlsOverlay.tsx — Video-mode controls (overlay layout)
 * - types.ts — Shared type definitions
 */

import type { PlaybackState, SlideNavActions } from './types';

interface DocControlsSlideshowProps {
  state: PlaybackState;
  slideNav: SlideNavActions;
}

export function DocControlsSlideshow({
  state,
  slideNav,
}: DocControlsSlideshowProps) {
  const { currentBlockIndex, totalBlocks } = state;
  const isFirst = currentBlockIndex <= 0;
  const isLast = currentBlockIndex >= totalBlocks - 1;

  return (
    <div
      className="doc-controls-slideshow"
      data-testid="slideshow-controls"
      style={{
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        background: 'rgba(0, 0, 0, 0.65)',
        borderRadius: '8px',
        padding: '4px 6px',
        zIndex: 100,
        userSelect: 'none',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Previous button */}
      <button
        onClick={(e) => { e.stopPropagation(); slideNav.prevSlide(); }}
        disabled={isFirst}
        data-testid="slide-prev"
        aria-label="Previous slide"
        title="Previous slide"
        style={{
          background: 'none',
          border: 'none',
          color: isFirst ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.9)',
          cursor: isFirst ? 'default' : 'pointer',
          padding: '6px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!isFirst) (e.currentTarget.style.background = 'rgba(255,255,255,0.1)');
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none';
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>

      {/* Slide counter */}
      <span
        data-testid="slide-counter"
        style={{
          color: 'rgba(255,255,255,0.9)',
          fontSize: '13px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontVariantNumeric: 'tabular-nums',
          minWidth: '48px',
          textAlign: 'center',
          padding: '0 4px',
          letterSpacing: '0.02em',
        }}
      >
        {totalBlocks > 0 ? `${currentBlockIndex + 1} / ${totalBlocks}` : '—'}
      </span>

      {/* Next button */}
      <button
        onClick={(e) => { e.stopPropagation(); slideNav.nextSlide(); }}
        disabled={isLast}
        data-testid="slide-next"
        aria-label="Next slide"
        title="Next slide"
        style={{
          background: 'none',
          border: 'none',
          color: isLast ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.9)',
          cursor: isLast ? 'default' : 'pointer',
          padding: '6px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!isLast) (e.currentTarget.style.background = 'rgba(255,255,255,0.1)');
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none';
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
        </svg>
      </button>
    </div>
  );
}
