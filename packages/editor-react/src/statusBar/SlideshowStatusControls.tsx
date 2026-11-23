/**
 * SlideshowStatusControls
 *
 * Slideshow navigation drawn in the status bar: previous, the slide counter
 * with the slide's title (which opens a list of every slide), build steps,
 * and next. DocPlayer hands these controls its state and actions through
 * `renderSlideshowControls`; PreviewPanel portals them into the status bar's
 * view region. They keep the overlay pill's test ids and accessible names, so
 * the slideshow reads and drives the same from either place.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SlideshowControlsProps } from '@bendyline/squisq-react';

/** Room kept above the slide list: 8px off the bar, 16px below the editor's top. */
const PICKER_CLEARANCE = 24;

export function SlideshowStatusControls({
  state,
  slideNav,
  slides = [],
  pickerOpen,
  onPickerOpenChange,
}: SlideshowControlsProps) {
  const [uncontrolledPickerOpen, setUncontrolledPickerOpen] = useState(false);
  const isPickerOpen = pickerOpen ?? uncontrolledPickerOpen;
  const setPickerOpen = useCallback(
    (open: boolean) => {
      if (pickerOpen === undefined) setUncontrolledPickerOpen(open);
      onPickerOpenChange?.(open);
    },
    [pickerOpen, onPickerOpenChange],
  );
  const [pickerMaxHeight, setPickerMaxHeight] = useState(320);
  const controlsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const { currentBlockIndex, totalBlocks } = state;
  const hasBuilds = !!state.buildCount;
  const isFirst = currentBlockIndex <= 0 && !(state.buildStep && state.buildStep > 0);
  const isLast =
    currentBlockIndex >= totalBlocks - 1 &&
    (state.buildStep ?? 0) >= (state.buildCount ?? 0) &&
    !state.isBuilding;
  const counterText =
    totalBlocks > 0
      ? (state.currentSlideLabel ??
        `${state.currentSlideNumber ?? currentBlockIndex + 1} / ${
          state.totalSlideNumber ?? totalBlocks
        }`)
      : '—';
  const title = slides[currentBlockIndex]?.summary;
  // The counter is as wide as its widest label — the last slide's number,
  // or a named entry such as "Cover" — so the arrows hold still while the
  // number grows a digit (status-bar.css draws these as hidden sizers).
  const lastSlide = String(state.totalSlideNumber ?? totalBlocks);
  const namedSlide = slides.find((slide) => !/^\d+$/.test(slide.label))?.label;

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

  // The list opens upward over the editor; keep it below the editor's top.
  useLayoutEffect(() => {
    if (!isPickerOpen) return;
    const controls = controlsRef.current;
    if (!controls) return;
    const shell = controls.closest<HTMLElement>('.squisq-editor-shell');
    const update = () => {
      const top = shell ? shell.getBoundingClientRect().top : 0;
      const available = controls.getBoundingClientRect().top - top - PICKER_CLEARANCE;
      setPickerMaxHeight(Math.max(96, Math.floor(available)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
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
    const focused = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = focused;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = (focused + 1) % items.length;
    else next = (focused - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={controlsRef}
      className="squisq-status-slides"
      role="group"
      aria-label="Slide navigation"
      data-testid="slideshow-controls"
    >
      <button
        type="button"
        className="squisq-status-nav-button"
        onClick={() => (slideNav.prevStep ?? slideNav.prevSlide)()}
        disabled={isFirst}
        data-testid="slide-prev"
        aria-label={hasBuilds ? 'Previous build or slide' : 'Previous slide'}
        data-tooltip="Previous slide"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M9 2.5 L4.5 7 L9 11.5" />
        </svg>
      </button>

      <button
        ref={triggerRef}
        type="button"
        className="squisq-status-view-trigger"
        aria-label={`Choose slide, current ${counterText}${title ? `: ${title}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={isPickerOpen}
        aria-controls={isPickerOpen ? menuId : undefined}
        data-tooltip="Choose slide"
        disabled={slides.length === 0}
        onClick={() => setPickerOpen(!isPickerOpen)}
      >
        <span
          className="squisq-status-view-position"
          data-sizer={`${lastSlide} / ${lastSlide}`}
          data-sizer-alt={namedSlide}
        >
          <span data-testid="slide-counter">{counterText}</span>
        </span>
        {/* Always present, at a fixed width: a slide without a title keeps the arrows put. */}
        <span className="squisq-status-view-title">{title}</span>
      </button>

      <button
        type="button"
        className="squisq-status-nav-button"
        onClick={() => (slideNav.nextStep ?? slideNav.nextSlide)()}
        disabled={isLast}
        data-testid="slide-next"
        aria-label={hasBuilds ? 'Next build or slide' : 'Next slide'}
        data-tooltip="Next slide"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M5 2.5 L9.5 7 L5 11.5" />
        </svg>
      </button>

      {/* Only some slides have builds, so these sit outside the layout (beside
          the arrows, or above them on a phone) rather than push them aside. */}
      {hasBuilds && (
        <span className="squisq-status-slides-builds">
          <span className="squisq-status-view-note" role="status">
            Build {state.buildStep ?? 0} of {state.buildCount}
          </span>
          <button
            type="button"
            className="squisq-status-text-button"
            onClick={() => slideNav.showAllBuilds?.()}
            aria-label="Show all build steps"
          >
            Show all
          </button>
        </span>
      )}

      {isPickerOpen && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Choose a slide"
          className="squisq-status-slides-picker"
          data-testid="slide-picker"
          style={{ maxHeight: `${pickerMaxHeight}px` }}
          onKeyDown={handleMenuKeyDown}
        >
          {slides.map((slide, index) => (
            <button
              key={`${slide.id}-${index}`}
              type="button"
              role="menuitem"
              className="squisq-status-slides-item"
              aria-current={index === currentBlockIndex ? 'true' : undefined}
              data-testid={`slide-picker-item-${index}`}
              onClick={() => {
                slideNav.goToSlide(index);
                setPickerOpen(false);
              }}
            >
              <span className="squisq-status-slides-item-label">{slide.label}</span>
              <span className="squisq-status-slides-item-summary">{slide.summary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
