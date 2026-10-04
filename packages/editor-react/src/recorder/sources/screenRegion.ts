export interface ScreenCaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function validateScreenCaptureRegion(
  region: ScreenCaptureRegion,
  width?: number,
  height?: number,
): void {
  const { x, y, width: w, height: h } = region;
  if (
    ![x, y, w, h].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 16384) ||
    w === 0 ||
    h === 0 ||
    w * h > 16_777_216
  ) {
    throw new Error(
      'Enter a valid recording region: non-negative left/top and positive whole-pixel dimensions (up to 16 megapixels).',
    );
  }
  if ((width !== undefined && x + w > width) || (height !== undefined && y + h > height)) {
    throw new Error(
      `The recording region is outside the selected surface (${width} × ${height} pixels). Adjust the coordinates or choose another surface.`,
    );
  }
}

/** Crop the recorded pixels, preserving audio and ownership of the input stream. */
export async function cropScreenStream(
  source: MediaStream,
  region: ScreenCaptureRegion,
): Promise<{ stream: MediaStream; dispose: () => void }> {
  validateScreenCaptureRegion(region);
  const [sourceTrack] = source.getVideoTracks();
  if (!sourceTrack) throw new Error('The selected surface has no video track.');
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function')
    throw new Error('Recording a region is not supported in this browser.');
  canvas.width = region.width;
  canvas.height = region.height;
  let timer: ReturnType<typeof setInterval> | undefined;
  let output: MediaStream | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    sourceTrack.removeEventListener('ended', ended);
    video.pause();
    video.srcObject = null;
    output?.getVideoTracks().forEach((track) => track.stop());
    source.getTracks().forEach((track) => track.stop());
  };
  const ended = () => {
    const track = output?.getVideoTracks()[0];
    dispose();
    // stop() does not emit ended. Forward the user's Stop sharing action so
    // useMediaRecorder flushes the take and stops the companion camera too.
    track?.dispatchEvent(new Event('ended'));
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('error', failed);
        sourceTrack.removeEventListener('ended', failed);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('Could not preview the selected screen. Choose it again.'));
      };
      const timeout = setTimeout(failed, 10_000);
      video.addEventListener('loadeddata', ready, { once: true });
      video.addEventListener('error', failed, { once: true });
      sourceTrack.addEventListener('ended', failed, { once: true });
      try {
        video.srcObject = source;
        void video.play().catch(failed);
      } catch {
        failed();
      }
    });
    if (sourceTrack.readyState === 'ended')
      throw new Error('Screen sharing ended. Choose a surface again.');
    validateScreenCaptureRegion(region, video.videoWidth, video.videoHeight);
    const draw = () => {
      // A window can shrink while recording. Never retain an old frame or
      // silently broaden the requested region when it no longer fits.
      if (
        region.x + region.width > video.videoWidth ||
        region.y + region.height > video.videoHeight ||
        sourceTrack.readyState === 'ended'
      ) {
        ended();
        return;
      }
      try {
        context.drawImage(
          video,
          region.x,
          region.y,
          region.width,
          region.height,
          0,
          0,
          region.width,
          region.height,
        );
      } catch {
        ended();
      }
    };
    draw();
    output = canvas.captureStream(30);
    const stream = new MediaStream([...output.getVideoTracks(), ...source.getAudioTracks()]);
    sourceTrack.addEventListener('ended', ended, { once: true });
    timer = setInterval(draw, 1000 / 30);
    return { stream, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
