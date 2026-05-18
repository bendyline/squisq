/**
 * useStreamPreview — binds a `MediaStream` to a `<video>` element's
 * `srcObject`. Decouples the preview surface from `useMediaRecorder`,
 * letting hosts compose the preview element however they like.
 */

import { useEffect, type RefObject } from 'react';

/**
 * Assign `stream` to `<video>.srcObject` whenever either changes; clears
 * it on unmount or when `stream` is `null`. The element is set to
 * `playsInline` + `muted` automatically because previewing your own
 * microphone with audio playthrough creates a feedback loop.
 *
 * @example
 * ```tsx
 * const videoRef = useRef<HTMLVideoElement>(null);
 * const { stream } = useMediaRecorder({ source: 'camera' });
 * useStreamPreview(videoRef, stream);
 * return <video ref={videoRef} autoPlay />;
 * ```
 */
export function useStreamPreview(
  ref: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    el.playsInline = true;
    el.srcObject = stream;
    if (stream) {
      // Some browsers don't auto-play on srcObject assignment; trigger
      // it explicitly and ignore the inevitable "user gesture required"
      // rejections — the preview will play on the next interaction.
      void el.play().catch(() => {});
    }
    return () => {
      // Only detach when this effect is tearing down. Don't stop tracks
      // — that's the recorder's responsibility.
      if (el.srcObject === stream) {
        el.srcObject = null;
      }
    };
  }, [ref, stream]);
}
