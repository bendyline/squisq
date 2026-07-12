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

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlaybackState, SlideNavActions } from './types';

export interface SlideshowPickerItem {
  /** Stable identifier for the slide/block. */
  id: string;
  /** Human-facing slide number, or a special label such as "Cover". */
  label: string;
  /** Short description shown in the slide picker. */
  summary: string;
}

interface DocControlsSlideshowProps {
  state: PlaybackState;
  slideNav: SlideNavActions;
  /** Slides available for direct navigation from the counter popover. */
  slides?: readonly SlideshowPickerItem[];
  /** Controlled open state for hosts that expose their own picker shortcut. */
  pickerOpen?: boolean;
  /** Called whenever the slide picker should open or close. */
  onPickerOpenChange?: (open: boolean) => void;
}

export function DocControlsSlideshow({
  state,
  slideNav,
  slides = [],
  pickerOpen,
  onPickerOpenChange,
}: DocControlsSlideshowProps) {
  const [uncontrolledPickerOpen, setUncontrolledPickerOpen] = useState(false);
  const isPickerOpen = pickerOpen ?? uncontrolledPickerOpen;
  const setPickerOpen = useCallback(
    (open: boolean) => {
      if (pickerOpen === undefined) setUncontrolledPickerOpen(open);
      onPickerOpenChange?.(open);
    },
    [pickerOpen, onPickerOpenChange],
  );
  const [pickerMaxHeight, setPickerMaxHeight] = useState(280);
  const controlsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const {
    currentBlockIndex,
    currentSlideLabel,
    currentSlideNumber,
    totalBlocks,
    totalSlideNumber,
  } = state;
  const isFirst = currentBlockIndex <= 0;
  const isLast = currentBlockIndex >= totalBlocks - 1;
  const counterText =
    totalBlocks > 0
      ? (currentSlideLabel ??
        `${currentSlideNumber ?? currentBlockIndex + 1} / ${totalSlideNumber ?? totalBlocks}`)
      : '—';

  useEffect(() => {
    if (!isPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPickerOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPickerOpen, setPickerOpen]);

  useLayoutEffect(() => {
    if (!isPickerOpen) return;

    const controls = controlsRef.current;
    const player = controls?.closest<HTMLElement>('.doc-player') ?? controls?.parentElement;
    if (!controls || !player) return;

    const updateMaxHeight = () => {
      const controlsBounds = controls.getBoundingClientRect();
      const playerBounds = player.getBoundingClientRect();
      // The picker sits 8px above the toolbar; retain another 16px of
      // breathing room at the top of the player.
      const availableHeight = Math.floor(controlsBounds.top - playerBounds.top - 8 - 16);
      setPickerMaxHeight(Math.max(72, availableHeight));
    };

    updateMaxHeight();
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMaxHeight);
    resizeObserver?.observe(player);
    resizeObserver?.observe(controls);
    window.addEventListener('resize', updateMaxHeight);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateMaxHeight);
    };
  }, [isPickerOpen]);

  useEffect(() => {
    if (!isPickerOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
  }, [isPickerOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;

    event.preventDefault();
    const focusedIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = focusedIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = (focusedIndex + 1) % items.length;
    else nextIndex = (focusedIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <div
      ref={controlsRef}
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
        onClick={(e) => {
          e.stopPropagation();
          slideNav.prevSlide();
        }}
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
          if (!isFirst) e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none';
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>

      {/* Slide counter / direct-navigation picker */}
      <button
        ref={triggerRef}
        type="button"
        data-testid="slide-counter"
        aria-label={`Choose slide, current ${counterText}`}
        aria-haspopup="menu"
        aria-expanded={isPickerOpen}
        aria-controls={isPickerOpen ? menuId : undefined}
        title="Choose slide"
        disabled={slides.length === 0}
        onClick={(event) => {
          event.stopPropagation();
          setPickerOpen(!isPickerOpen);
        }}
        style={{
          background: isPickerOpen ? 'rgba(255,255,255,0.12)' : 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.9)',
          cursor: slides.length > 0 ? 'pointer' : 'default',
          fontSize: '13px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontVariantNumeric: 'tabular-nums',
          minWidth: '48px',
          textAlign: 'center',
          padding: '6px 4px',
          letterSpacing: '0.02em',
          borderRadius: '4px',
          transition: 'background 0.15s',
        }}
      >
        {counterText}
      </button>

      {isPickerOpen && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Choose a slide"
          data-testid="slide-picker"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 8px)',
            width: 'min(280px, calc(100vw - 32px))',
            maxHeight: `${pickerMaxHeight}px`,
            overflowY: 'auto',
            padding: '6px',
            background: 'rgba(20, 20, 20, 0.94)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '8px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.38)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          {slides.map((slide, index) => {
            const isCurrent = index === currentBlockIndex;
            return (
              <button
                key={`${slide.id}-${index}`}
                type="button"
                role="menuitem"
                aria-current={isCurrent ? 'true' : undefined}
                data-testid={`slide-picker-item-${index}`}
                onClick={() => {
                  slideNav.goToSlide(index);
                  setPickerOpen(false);
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '42px minmax(0, 1fr)',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 10px',
                  background: isCurrent ? 'rgba(255,255,255,0.14)' : 'transparent',
                  border: 'none',
                  borderRadius: '5px',
                  color: 'rgba(255,255,255,0.94)',
                  cursor: 'pointer',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  textAlign: 'left',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = isCurrent
                    ? 'rgba(255,255,255,0.14)'
                    : 'transparent';
                }}
              >
                <span
                  style={{
                    color: isCurrent ? '#fff' : 'rgba(255,255,255,0.58)',
                    fontSize: '12px',
                    fontVariantNumeric: 'tabular-nums',
                    textAlign: 'right',
                  }}
                >
                  {slide.label}
                </span>
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    color: isCurrent ? '#fff' : 'rgba(255,255,255,0.82)',
                    fontSize: '13px',
                    lineHeight: 1.3,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {slide.summary}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Next button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          slideNav.nextSlide();
        }}
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
          if (!isLast) e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
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
