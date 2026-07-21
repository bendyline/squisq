const DEFAULT_VIDEO_FRAME_TIMEOUT_MS = 2_000;
const VIDEO_TIME_TOLERANCE_SECONDS = 0.01;

function formatMediaTime(time: number): string {
  return Number.isFinite(time) ? `${time.toFixed(3)}s` : String(time);
}

function isVisiblyPresented(video: HTMLVideoElement): boolean {
  if (!video.isConnected) return false;
  const view = video.ownerDocument.defaultView;
  if (!view) return false;
  for (let element: Element | null = video; element; element = element.parentElement) {
    const style = view.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      Number.parseFloat(style.opacity || '1') <= 0
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Seek a paused video and resolve only when its target frame is decodable.
 *
 * Assigning `currentTime` updates that property synchronously, before the
 * browser has decoded the requested frame. A visibly presented video also
 * waits for requestVideoFrameCallback where available. Invisible capture
 * surfaces cannot receive that compositor callback, so `seeked` plus
 * HAVE_CURRENT_DATA is authoritative there. A timeout rejects instead of
 * silently capturing the previous frame.
 */
export function seekVideoToFrame(
  video: HTMLVideoElement,
  targetTime: number,
  timeoutMs = DEFAULT_VIDEO_FRAME_TIMEOUT_MS,
): Promise<void> {
  video.pause();

  const alreadyReady =
    !video.seeking &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    Math.abs(video.currentTime - targetTime) <= VIDEO_TIME_TOLERANCE_SECONDS;
  if (alreadyReady) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let videoFrameRequest: number | null = null;

    const cleanup = (): void => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', handleMediaReady);
      video.removeEventListener('loadeddata', handleMediaReady);
      video.removeEventListener('canplay', handleMediaReady);
      if (videoFrameRequest !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(videoFrameRequest);
      }
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Video frame did not become ready at ${formatMediaTime(targetTime)} ` +
            `within ${timeoutMs}ms ` +
            `(currentTime=${formatMediaTime(video.currentTime)}, readyState=${video.readyState}, ` +
            `seeking=${String(video.seeking)}, visible=${String(isVisiblyPresented(video))}).`,
        ),
      );
    };
    const requestPresentedFrame = (): void => {
      if (settled || video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (typeof video.requestVideoFrameCallback !== 'function' || !isVisiblyPresented(video)) {
        finish();
        return;
      }
      if (videoFrameRequest !== null) return;
      videoFrameRequest = video.requestVideoFrameCallback(() => {
        videoFrameRequest = null;
        // This callback was registered only after `seeked` and
        // HAVE_CURRENT_DATA, so it represents the newly presented target
        // frame rather than the pre-seek frame.
        finish();
      });
    };
    function handleMediaReady(): void {
      requestPresentedFrame();
    }

    const timeout = setTimeout(fail, timeoutMs);
    video.addEventListener('seeked', handleMediaReady);
    video.addEventListener('loadeddata', handleMediaReady);
    video.addEventListener('canplay', handleMediaReady);

    try {
      video.currentTime = targetTime;
      // Some engines complete an in-buffer seek synchronously without firing
      // another event. The microtask observes the final seeking/readyState.
      queueMicrotask(requestPresentedFrame);
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}
