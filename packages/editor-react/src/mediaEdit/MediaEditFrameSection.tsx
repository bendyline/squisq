/**
 * Frame: crop a video clip. The current frame shows under a crop rectangle
 * that can be dragged, resized from its corners, or set from an aspect
 * preset; arrow keys nudge it (Shift resizes). The crop is a recipe field —
 * the player shows it live and export draws only the cropped region.
 */

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { normalizeMediaCrop, type MediaCrop } from '@bendyline/squisq/mediaEdit';
import { useResolvedMediaSrc } from '../tiptap/useResolvedMediaSrc';
import { centeredCrop, type RecipeDraft } from './mediaEditDraft';
import type { EditableMedia } from './mediaEditTargets';

const FULL: MediaCrop = { x: 0, y: 0, w: 1, h: 1 };
const MIN_EDGE = 0.05;
const NUDGE = 0.01;

const ASPECTS: ReadonlyArray<{ label: string; ratio: number | null }> = [
  { label: 'Free', ratio: null },
  { label: '16:9', ratio: 16 / 9 },
  { label: '1:1', ratio: 1 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '4:3', ratio: 4 / 3 },
];

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

function clampCrop(crop: MediaCrop): MediaCrop {
  const w = Math.min(1, Math.max(MIN_EDGE, crop.w));
  const h = Math.min(1, Math.max(MIN_EDGE, crop.h));
  return {
    x: Math.min(1 - w, Math.max(0, crop.x)),
    y: Math.min(1 - h, Math.max(0, crop.y)),
    w,
    h,
  };
}

export interface MediaEditFrameSectionProps {
  item: EditableMedia;
  draft: RecipeDraft;
  onChange: (next: RecipeDraft) => void;
}

export function MediaEditFrameSection({ item, draft, onChange }: MediaEditFrameSectionProps) {
  const src = useResolvedMediaSrc(item.src);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const crop = draft.crop ?? FULL;

  const setCrop = useCallback(
    (next: MediaCrop) => onChange({ ...draft, crop: normalizeMediaCrop(clampCrop(next)) }),
    [draft, onChange],
  );

  const startDrag = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = stage.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    const start = crop;
    const pixelRatio = frame ? frame.w / frame.h : 1;
    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - origin.x) / bounds.width;
      const dy = (e.clientY - origin.y) / bounds.height;
      if (handle === 'move') {
        setCrop({ ...start, x: start.x + dx, y: start.y + dy });
        return;
      }
      const left = handle === 'nw' || handle === 'sw' ? start.x + dx : start.x;
      const right = handle === 'ne' || handle === 'se' ? start.x + start.w + dx : start.x + start.w;
      const top = handle === 'nw' || handle === 'ne' ? start.y + dy : start.y;
      const bottom =
        handle === 'sw' || handle === 'se' ? start.y + start.h + dy : start.y + start.h;
      let next: MediaCrop = { x: left, y: top, w: right - left, h: bottom - top };
      if (aspect != null) {
        // Keep the preset's pixel aspect: height follows width.
        const h = (next.w * pixelRatio) / aspect;
        next = { ...next, h, y: handle === 'nw' || handle === 'ne' ? bottom - h : top };
      }
      setCrop(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const step = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    }[event.key];
    if (!step) return;
    event.preventDefault();
    const [dx, dy] = step;
    setCrop(
      event.shiftKey
        ? { ...crop, w: crop.w + dx, h: crop.h + dy }
        : { ...crop, x: crop.x + dx, y: crop.y + dy },
    );
  };

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  return (
    <div className="squisq-media-edit-section">
      <div className="squisq-media-edit-chips" role="group" aria-label="Crop aspect">
        {ASPECTS.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={aspect === option.ratio}
            disabled={option.ratio != null && !frame}
            onClick={() => {
              setAspect(option.ratio);
              if (option.ratio != null && frame)
                setCrop(centeredCrop(option.ratio, frame.w, frame.h));
            }}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          disabled={!draft.crop}
          onClick={() => {
            setAspect(null);
            onChange({ ...draft, crop: null });
          }}
        >
          No crop
        </button>
      </div>
      <div
        ref={stageRef}
        className="squisq-media-edit-crop"
        style={frame ? { aspectRatio: `${frame.w} / ${frame.h}` } : undefined}
      >
        {src && (
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const video = e.currentTarget;
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                setFrame({ w: video.videoWidth, h: video.videoHeight });
                // Show a frame from inside the clip, not a black first frame.
                video.currentTime = (item.clipStart ?? 0) + 0.5;
              }
            }}
          />
        )}
        <div
          className="squisq-media-edit-crop__rect"
          role="slider"
          tabIndex={0}
          aria-label="Crop area"
          aria-valuetext={`Left ${pct(crop.x)}, top ${pct(crop.y)}, ${pct(crop.w)} wide, ${pct(crop.h)} tall`}
          style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
          onPointerDown={startDrag('move')}
          onKeyDown={onKeyDown}
        >
          {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
            <span
              key={handle}
              className={`squisq-media-edit-crop__handle squisq-media-edit-crop__handle--${handle}`}
              onPointerDown={startDrag(handle)}
            />
          ))}
        </div>
      </div>
      <p className="squisq-media-edit-note">
        {draft.crop
          ? 'Only the framed area is shown and exported.'
          : 'Drag the corners or pick an aspect to crop.'}
      </p>
    </div>
  );
}
