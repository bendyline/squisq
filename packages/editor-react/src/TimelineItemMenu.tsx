import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  VideoPipPosition,
  VideoPipShape,
  VideoPipSize,
  VideoPlacement,
} from '@bendyline/squisq/schemas';
import type { PipPosition, PipShape, PipSize } from '@bendyline/squisq-react';
import { TransitionPicker } from './TransitionPicker';
import type { TransitionFields } from './headingTransition';
import type { MediaClipPatch } from './timelineSource';

export interface TimelineMenuAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TimelineBlockMenuTarget {
  kind: 'block';
  key: string;
  title: string;
  duration: number;
  explicitDuration: boolean;
  startTime: number | null;
  transition: TransitionFields;
}

export interface TimelineVideoMenuTarget {
  kind: 'video';
  key: string;
  title: string;
  placement: VideoPlacement | 'default';
  canUseContentPlacement: boolean;
  lockToBlock: boolean;
  absoluteStart: number;
  pipSize?: VideoPipSize;
  pipShape?: VideoPipShape;
  pipPosition?: VideoPipPosition;
  defaultPipSize: PipSize;
  defaultPipShape: PipShape;
  defaultPipPosition: PipPosition;
}

export type TimelineItemMenuTarget = TimelineBlockMenuTarget | TimelineVideoMenuTarget;

export interface TimelineItemMenuProps {
  anchor: TimelineMenuAnchor;
  target: TimelineItemMenuTarget;
  colorScheme?: 'light' | 'dark';
  accentColor?: string;
  onBlockDuration: (seconds: number | null) => void;
  onBlockStartTime: (seconds: number | null) => void;
  onBlockTransition: (transition: TransitionFields) => void;
  onVideoPatch: (patch: MediaClipPatch) => void;
  onClose: () => void;
}

export function TimelineItemMenu({
  anchor,
  target,
  colorScheme = 'light',
  accentColor,
  onBlockDuration,
  onBlockStartTime,
  onBlockTransition,
  onVideoPatch,
  onClose,
}: TimelineItemMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>(() => menuStyle(anchor));

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const updatePosition = () => setStyle(menuStyle(anchor, panel));
    updatePosition();
    window.addEventListener('resize', updatePosition);

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    resizeObserver?.observe(panel);

    return () => {
      window.removeEventListener('resize', updatePosition);
      resizeObserver?.disconnect();
    };
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    const onMouseDown = (event: MouseEvent) => {
      const element = event.target as HTMLElement;
      if (panelRef.current?.contains(element) || element.closest?.('.squisq-transition-flyout')) {
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className="squisq-timeline-item-menu"
      data-theme={colorScheme}
      role="dialog"
      aria-label={target.kind === 'block' ? 'Timeline block options' : 'Timeline video options'}
      style={{ ...style, ...accentStyle(accentColor) }}
    >
      <div className="squisq-timeline-item-menu-header">
        <span className="squisq-timeline-item-menu-kind">
          {target.kind === 'block' ? 'Block' : 'Video'}
        </span>
        <span className="squisq-timeline-item-menu-title" title={target.title}>
          {target.title}
        </span>
      </div>
      {target.kind === 'block' ? (
        <BlockMenu
          target={target}
          colorScheme={colorScheme}
          accentColor={accentColor}
          onDuration={onBlockDuration}
          onStartTime={onBlockStartTime}
          onTransition={onBlockTransition}
        />
      ) : (
        <VideoMenu target={target} onPatch={onVideoPatch} />
      )}
    </div>,
    document.body,
  );
}

function BlockMenu({
  target,
  colorScheme,
  accentColor,
  onDuration,
  onStartTime,
  onTransition,
}: {
  target: TimelineBlockMenuTarget;
  colorScheme: 'light' | 'dark';
  accentColor?: string;
  onDuration: (seconds: number | null) => void;
  onStartTime: (seconds: number | null) => void;
  onTransition: (transition: TransitionFields) => void;
}) {
  const [explicitDuration, setExplicitDuration] = useState(target.explicitDuration);
  const [duration, setDuration] = useState(formatNumber(target.duration));
  const [startTime, setStartTime] = useState(
    target.startTime == null ? '' : formatNumber(target.startTime),
  );
  const [transition, setTransition] = useState(target.transition);

  const toggleAutotime = (autotimed: boolean) => {
    setExplicitDuration(!autotimed);
    if (autotimed) {
      onDuration(null);
    } else {
      const seconds = numericValue(duration) ?? target.duration;
      setDuration(formatNumber(seconds));
      onDuration(seconds);
    }
  };

  return (
    <div className="squisq-timeline-item-menu-body">
      <label className="squisq-timeline-item-menu-check">
        <input
          type="checkbox"
          checked={!explicitDuration}
          onChange={(event) => toggleAutotime(event.target.checked)}
        />
        <span>Autotime block</span>
      </label>
      <p className="squisq-timeline-item-menu-hint">
        Uses narration, content, and interior media when no explicit duration is set.
      </p>
      <MenuNumberField
        label="Duration"
        ariaLabel="Block duration in seconds"
        value={duration}
        disabled={!explicitDuration}
        onChange={(value) => {
          setDuration(value);
          const seconds = numericValue(value);
          if (seconds != null) onDuration(seconds);
        }}
      />
      <MenuNumberField
        label="Start time"
        ariaLabel="Block start time in seconds"
        value={startTime}
        placeholder="auto"
        onChange={(value) => {
          setStartTime(value);
          onStartTime(value.trim() === '' ? null : numericValue(value));
        }}
      />
      <div className="squisq-timeline-item-menu-row">
        <span className="squisq-timeline-item-menu-label">Transition</span>
        <TransitionPicker
          value={transition}
          colorScheme={colorScheme}
          accentColor={accentColor}
          onChange={(next) => {
            setTransition(next);
            onTransition(next);
          }}
        />
      </div>
    </div>
  );
}

function VideoMenu({
  target,
  onPatch,
}: {
  target: TimelineVideoMenuTarget;
  onPatch: (patch: MediaClipPatch) => void;
}) {
  const [placement, setPlacement] = useState(target.placement);
  const [locked, setLocked] = useState(target.lockToBlock);
  const [pipSize, setPipSize] = useState<VideoPipSize | ''>(target.pipSize ?? '');
  const [pipShape, setPipShape] = useState<VideoPipShape | ''>(target.pipShape ?? '');
  const [pipPosition, setPipPosition] = useState<VideoPipPosition | ''>(target.pipPosition ?? '');
  const placed = placement === 'picture-in-picture' || placement === 'overlay';

  const placementOptions: Array<{ value: VideoPlacement | 'default'; label: string }> = [
    target.canUseContentPlacement
      ? { value: 'content', label: 'In layout' }
      : { value: 'default', label: 'Default' },
    { value: 'picture-in-picture', label: 'PIP' },
    { value: 'overlay', label: 'Overlay' },
  ];

  return (
    <div className="squisq-timeline-item-menu-body">
      <div className="squisq-timeline-item-menu-field">
        <span className="squisq-timeline-item-menu-label">Placement</span>
        <div
          className="squisq-timeline-item-menu-segments"
          role="group"
          aria-label="Video placement"
        >
          {placementOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={placement === option.value}
              onClick={() => {
                setPlacement(option.value);
                const unset = option.value === 'content' || option.value === 'default';
                onPatch({
                  placement: option.value === 'default' ? null : option.value,
                  ...(unset
                    ? { lockToBlock: null, pipSize: null, pipShape: null, pipPosition: null }
                    : {}),
                });
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {placed && (
        <>
          <label className="squisq-timeline-item-menu-check">
            <input
              type="checkbox"
              checked={locked}
              onChange={(event) => {
                const next = event.target.checked;
                setLocked(next);
                onPatch(
                  next
                    ? { lockToBlock: true, startAt: null, clipEnd: null }
                    : { lockToBlock: false, startAt: target.absoluteStart },
                );
              }}
            />
            <span>Lock to block</span>
          </label>

          {placement === 'picture-in-picture' && (
            <>
              <label className="squisq-timeline-item-menu-field">
                <span className="squisq-timeline-item-menu-label">PIP size</span>
                <select
                  aria-label="Picture-in-picture size"
                  value={pipSize}
                  onChange={(event) => {
                    const next = event.target.value as VideoPipSize | '';
                    setPipSize(next);
                    onPatch({ pipSize: next || null });
                  }}
                >
                  <option value="">Document default ({titleCase(target.defaultPipSize)})</option>
                  <option value="small">Small</option>
                  <option value="large">Large</option>
                </select>
              </label>
              <label className="squisq-timeline-item-menu-field">
                <span className="squisq-timeline-item-menu-label">PIP shape</span>
                <select
                  aria-label="Picture-in-picture shape"
                  value={pipShape}
                  onChange={(event) => {
                    const next = event.target.value as VideoPipShape | '';
                    setPipShape(next);
                    onPatch({ pipShape: next || null });
                  }}
                >
                  <option value="">Document default ({titleCase(target.defaultPipShape)})</option>
                  <option value="square">Square</option>
                  <option value="wide">Wide (16:9)</option>
                </select>
              </label>
              <label className="squisq-timeline-item-menu-field">
                <span className="squisq-timeline-item-menu-label">PIP position</span>
                <select
                  aria-label="Picture-in-picture position"
                  value={pipPosition}
                  onChange={(event) => {
                    const next = event.target.value as VideoPipPosition | '';
                    setPipPosition(next);
                    onPatch({ pipPosition: next || null });
                  }}
                >
                  <option value="">
                    Document default ({positionLabel(target.defaultPipPosition)})
                  </option>
                  <option value="top-left">Top left</option>
                  <option value="top-right">Top right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
              </label>
            </>
          )}
        </>
      )}
    </div>
  );
}

function MenuNumberField({
  label,
  ariaLabel,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="squisq-timeline-item-menu-field">
      <span className="squisq-timeline-item-menu-label">{label}</span>
      <span className="squisq-timeline-item-menu-number">
        <input
          type="number"
          min="0"
          step="0.1"
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <span>sec</span>
      </span>
    </label>
  );
}

function numericValue(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function positionLabel(value: string): string {
  return value.split('-').map(titleCase).join(' ');
}

function accentStyle(accentColor: string | undefined): React.CSSProperties {
  return accentColor
    ? ({ ['--squisq-block-props-accent' as string]: accentColor } as React.CSSProperties)
    : {};
}

function menuStyle(anchor: TimelineMenuAnchor, element?: HTMLElement | null): React.CSSProperties {
  const panel = element?.getBoundingClientRect();
  const width = panel?.width ?? 320;
  const height = panel?.height ?? 300;
  const margin = 8;
  const gap = 5;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const left = Math.min(Math.max(margin, anchor.right - width), maxLeft);
  const roomBelow = window.innerHeight - anchor.bottom - gap - margin;
  const roomAbove = anchor.top - gap - margin;
  const preferredTop =
    roomBelow >= height || roomBelow >= roomAbove ? anchor.bottom + gap : anchor.top - height - gap;
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  const top = Math.min(Math.max(margin, preferredTop), maxTop);
  return {
    position: 'fixed',
    top,
    left,
    maxHeight: `calc(100vh - ${margin * 2}px)`,
    // TransitionPicker's nested flyout uses 9999 and must sit above this menu.
    zIndex: 9998,
  };
}
