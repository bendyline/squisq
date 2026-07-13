/**
 * Small corner self-view shown while recording with the camera on.
 */

import { useRef } from 'react';
import { useStreamPreview } from '../recorder/hooks/useStreamPreview';

export function TeleprompterSelfView({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useStreamPreview(videoRef, stream);
  if (!stream) return null;
  return (
    <video
      ref={videoRef}
      className="squisq-teleprompter-selfview"
      muted
      playsInline
      autoPlay
      data-testid="teleprompter-selfview"
    />
  );
}
