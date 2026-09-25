/**
 * AnimatedImageControls — the play/pause control laid over an animated image.
 *
 * Renders nothing until `useAnimatedImage` has confirmed the image animates,
 * so a static GIF looks exactly like any other picture. Once it does, a small
 * pill in the corner names the format and toggles playback; while paused, a
 * canvas holding a still of the image covers the (still-running) `<img>`.
 *
 * The caller owns the `<img>` and its positioned wrapper — this keeps the
 * editor's image node view (resize handle, edit affordance, drag handle)
 * and the markdown renderer's plain image on one implementation. The overlay
 * positions itself inline, so it lands correctly even when the host has not
 * loaded the package stylesheet (which only supplies its look).
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { AnimatedImagePlayback } from './useAnimatedImage.js';

export interface AnimatedImageControlsProps {
  playback: AnimatedImagePlayback;
  /** The `<img>` showing `playback.displaySrc`. Its parent must be the
   *  positioned box the image fills. */
  imageRef: RefObject<HTMLImageElement | null>;
}

const FORMAT_LABELS = { gif: 'GIF', webp: 'WEBP', png: 'APNG' } as const;

export function AnimatedImageControls({ playback, imageRef }: AnimatedImageControlsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { info, status, displaySrc } = playback;
  const paused = status === 'paused';
  const animated = info?.animated ?? false;

  // Freeze the frame the image is showing. Browsers differ on WHICH frame a
  // canvas receives from a playing animation (the current one, or the first
  // under a strict reading of the spec) — either is a faithful still.
  useLayoutEffect(() => {
    if (!paused || !animated) return;
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const draw = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
    };
    if (image.complete && image.naturalWidth) {
      draw();
      return;
    }
    // Paused before the image loaded (reduced motion): draw the first frame.
    image.addEventListener('load', draw, { once: true });
    return () => image.removeEventListener('load', draw);
  }, [paused, animated, displaySrc, imageRef]);

  if (!info || !animated) return null;

  const label =
    status === 'playing'
      ? 'Pause animation'
      : status === 'ended'
        ? 'Replay animation'
        : 'Play animation';

  return (
    <>
      {paused && (
        <canvas
          ref={canvasRef}
          className="squisq-animated-image-still"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      )}
      <button
        type="button"
        className="squisq-animated-image-toggle"
        data-status={status}
        aria-label={label}
        title={label}
        style={{ position: 'absolute', top: 8, left: 8 }}
        // Keep focus and any editor selection where they are; stop the click
        // reaching host handlers (node selection, link wrappers).
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (status === 'playing') playback.pause();
          else playback.play();
        }}
      >
        <StatusGlyph status={status} />
        <span className="squisq-animated-image-format">{FORMAT_LABELS[info.format]}</span>
      </button>
    </>
  );
}

/** The glyph shows what a click will DO, as on a video control. */
function StatusGlyph({ status }: { status: AnimatedImagePlayback['status'] }) {
  const path =
    status === 'playing'
      ? 'M2.5 1.5h2.75v9H2.5zM6.75 1.5H9.5v9H6.75z'
      : status === 'ended'
        ? 'M6 1.5V0L3.5 2.25 6 4.5V3a3 3 0 1 1-3 3H1.5A4.5 4.5 0 1 0 6 1.5z'
        : 'M3 1.5v9l7.5-4.5z';
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

export default AnimatedImageControls;
