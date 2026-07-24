const DEFAULT_VIDEO_FRAME_TIMEOUT_MS = 2_000;
const VIDEO_FRAME_READINESS_POLL_MS = 16;
const VIDEO_TIME_TOLERANCE_SECONDS = 0.01;
const MAX_SEQUENTIAL_CAPTURE_STEP_SECONDS = 0.5;
const SEQUENTIAL_CAPTURE_PLAYBACK_RATE = 1;

function formatMediaTime(time: number): string {
  return Number.isFinite(time) ? `${time.toFixed(3)}s` : String(time);
}

function reachableMediaTime(video: HTMLVideoElement, targetTime: number): number {
  const duration = video.duration;
  if (!Number.isFinite(duration)) return targetTime;
  return Math.max(0, Math.min(targetTime, duration));
}

function isAtReachableMediaTime(video: HTMLVideoElement, targetTime: number): boolean {
  return (
    Math.abs(video.currentTime - reachableMediaTime(video, targetTime)) <=
    VIDEO_TIME_TOLERANCE_SECONDS
  );
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

function seekVideoByAssignment(
  video: HTMLVideoElement,
  targetTime: number,
  timeoutMs = DEFAULT_VIDEO_FRAME_TIMEOUT_MS,
): Promise<void> {
  video.pause();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let videoFrameRequest: number | null = null;

    const cleanup = (): void => {
      clearTimeout(timeout);
      clearInterval(readinessPoll);
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
            `(currentTime=${formatMediaTime(video.currentTime)}, ` +
            `reachableTime=${formatMediaTime(reachableMediaTime(video, targetTime))}, ` +
            `duration=${formatMediaTime(video.duration)}, readyState=${video.readyState}, ` +
            `seeking=${String(video.seeking)}, visible=${String(isVisiblyPresented(video))}).`,
        ),
      );
    };
    const requestPresentedFrame = (): void => {
      if (
        settled ||
        video.seeking ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        !isAtReachableMediaTime(video, targetTime)
      ) {
        return;
      }
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
    // Chromium can complete an in-buffer seek without dispatching another
    // media readiness event, particularly when the export player lives under
    // an opacity-zero capture root. Polling is only a missed-event fallback:
    // ordinary seeks still settle immediately from `seeked`, while a decoded
    // hidden frame no longer waits until the hard timeout.
    const readinessPoll = setInterval(requestPresentedFrame, VIDEO_FRAME_READINESS_POLL_MS);
    video.addEventListener('seeked', handleMediaReady);
    video.addEventListener('loadeddata', handleMediaReady);
    video.addEventListener('canplay', handleMediaReady);

    try {
      video.currentTime = reachableMediaTime(video, targetTime);
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

function advanceSequentialCaptureVideo(
  video: HTMLVideoElement,
  targetTime: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const ownerDocument = video.ownerDocument;
    const isInactive = (): boolean => ownerDocument.visibilityState !== 'visible';
    const clearWatchdog = (): void => {
      if (timeout === null) return;
      clearTimeout(timeout);
      timeout = null;
    };
    const cleanup = (): void => {
      clearWatchdog();
      clearInterval(readinessPoll);
      video.removeEventListener('timeupdate', check);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('canplay', check);
      video.removeEventListener('error', fail);
      ownerDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    const finish = (): void => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    const fallbackToSeek = (): void => {
      if (settled) return;
      settled = true;
      video.pause();
      cleanup();
      // Autoplay policy or an engine-specific playback failure must not make
      // an otherwise seekable source unusable.
      void seekVideoByAssignment(video, targetTime, timeoutMs).then(resolve, reject);
    };
    const fail = (): void => {
      if (settled) return;
      settled = true;
      video.pause();
      cleanup();
      reject(
        new Error(
          `Video frame did not advance to ${formatMediaTime(targetTime)} ` +
            `within ${timeoutMs}ms (currentTime=${formatMediaTime(video.currentTime)}, ` +
            `readyState=${video.readyState}).`,
        ),
      );
    };
    function check(): void {
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.currentTime >= reachableMediaTime(video, targetTime)
      ) {
        // Hold this decoded source frame stable while html2canvas rasterizes
        // and the encoder consumes it. Wall-clock capture time must never
        // advance an embedded video's document-timeline position.
        video.pause();
        finish();
      }
    }
    const handlePlaybackFailure = (): void => {
      if (settled || isInactive()) return;
      fallbackToSeek();
    };
    const startPlayback = (): void => {
      if (settled || isInactive()) return;
      try {
        video.playbackRate = SEQUENTIAL_CAPTURE_PLAYBACK_RATE;
        if (video.paused) {
          void video.play().catch(handlePlaybackFailure);
        }
      } catch {
        handlePlaybackFailure();
      }
    };
    const armWatchdog = (): void => {
      clearWatchdog();
      if (settled || isInactive()) return;
      timeout = setTimeout(fail, timeoutMs);
    };
    const pauseWhileInactive = (): void => {
      video.pause();
      clearWatchdog();
    };
    const resumeWhenActive = (): void => {
      if (settled || isInactive()) return;
      // The media clock may have crossed the requested timestamp just before
      // Chromium delivered blur/visibility suspension. Capture that frame
      // without briefly restarting playback and introducing another jump.
      check();
      if (settled) return;
      startPlayback();
      armWatchdog();
    };
    function handleVisibilityChange(): void {
      if (ownerDocument.visibilityState !== 'visible') {
        pauseWhileInactive();
        return;
      }
      resumeWhenActive();
    }

    const readinessPoll = setInterval(check, VIDEO_FRAME_READINESS_POLL_MS);
    video.addEventListener('timeupdate', check);
    video.addEventListener('loadeddata', check);
    video.addEventListener('canplay', check);
    video.addEventListener('error', fail, { once: true });
    ownerDocument.addEventListener('visibilitychange', handleVisibilityChange);
    // Install every frame and visibility monitor before play(). Each short
    // monotonic playback step ends by pausing at its requested timestamp.
    resumeWhenActive();
  });
}

/**
 * Select a video frame and resolve only when it is decodable.
 *
 * Indexed sources use an exact currentTime seek. Capture-marked recorder WebMs
 * advance short monotonic playback steps and pause at each requested frame:
 * those files commonly lack Cues, so assigning currentTime for every output
 * frame becomes progressively slower even when all bytes are locally buffered,
 * while continuous wall-clock playback produces irregular repeated/skipped frames.
 */
export function seekVideoToFrame(
  video: HTMLVideoElement,
  targetTime: number,
  timeoutMs = DEFAULT_VIDEO_FRAME_TIMEOUT_MS,
): Promise<void> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_METADATA &&
    video.videoWidth <= 0 &&
    video.videoHeight <= 0
  ) {
    video.pause();
    return Promise.resolve();
  }
  const reachableTargetTime = reachableMediaTime(video, targetTime);
  const step = reachableTargetTime - video.currentTime;
  if (video.dataset.captureSequential === 'true') {
    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      step <= VIDEO_TIME_TOLERANCE_SECONDS
    ) {
      // Continuous low-rate playback normally advances less than one source
      // frame during html2canvas. If a slow render lets it get ahead, pause and
      // let the document clock catch up without ever seeking backward.
      if (step < -VIDEO_TIME_TOLERANCE_SECONDS) video.pause();
      return Promise.resolve();
    }
    if (
      step > 0 &&
      step <= MAX_SEQUENTIAL_CAPTURE_STEP_SECONDS &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return advanceSequentialCaptureVideo(video, targetTime, timeoutMs);
    }
  }

  video.pause();
  const alreadyReady =
    !video.seeking &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    isAtReachableMediaTime(video, targetTime);
  if (alreadyReady) return Promise.resolve();
  return seekVideoByAssignment(video, targetTime, timeoutMs);
}
