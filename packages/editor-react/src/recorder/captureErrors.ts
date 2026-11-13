/**
 * Turn a capture failure into a sentence an author can act on.
 *
 * `getUserMedia` / `getDisplayMedia` reject with DOMExceptions whose messages
 * are written for developers. Chromium's "Requested device not found" doesn't
 * say WHICH device is missing — and for a combined camera + microphone request
 * it can't. The recorder knows what it asked for and what `enumerateDevices()`
 * reports, so it can name the missing device and the next step.
 *
 * Only recognised failures are rewritten. Anything else (a recorder fault, a
 * save error) keeps its own message.
 */

/** Rejections that came from `getDisplayMedia` rather than `getUserMedia`. */
const displayCaptureErrors = new WeakSet<object>();

/**
 * Tag a `getDisplayMedia` rejection. The screen picker reports a cancelled
 * pick as `NotAllowedError`, the same name a denied camera uses, so the source
 * has to be recorded where the call is made. Returns `error` for rethrowing.
 */
export function markDisplayCaptureError(error: unknown): unknown {
  if (typeof error === 'object' && error !== null) displayCaptureErrors.add(error);
  return error;
}

/** What the failed request asked for. */
export interface CaptureErrorContext {
  /** The request included a camera. */
  camera: boolean;
  /** The request included a microphone. */
  microphone: boolean;
  /** The chosen camera's id, or `''` for "System default". */
  cameraDeviceId?: string;
  /** The chosen microphone's id, or `''` for "System default". */
  microphoneDeviceId?: string;
  /**
   * The current `enumerateDevices()` result. An empty list is treated as
   * "not enumerated yet", never as "this machine has no devices".
   */
  devices?: readonly MediaDeviceInfo[];
}

const PRIVACY_HINT = "your system's privacy settings allow apps to use it";

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return typeof error === 'string' ? error : '';
}

/** `OverconstrainedError.constraint` — the constraint that could not be met. */
function failedConstraint(error: unknown): string {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint: unknown }).constraint ?? '')
    : '';
}

/**
 * How many devices of `kind` the browser reports, or null when enumeration
 * hasn't produced anything yet. Blank-id entries count: before the first
 * permission grant, browsers list one placeholder per kind that exists.
 */
function countDevices(
  devices: readonly MediaDeviceInfo[] | undefined,
  kind: MediaDeviceKind,
): number | null {
  if (!devices || devices.length === 0) return null;
  return devices.filter((device) => device.kind === kind).length;
}

function requestedNoun(context: CaptureErrorContext): string {
  if (context.camera && context.microphone) return 'camera or microphone';
  if (context.camera) return 'camera';
  if (context.microphone) return 'microphone';
  return 'capture device';
}

function describeDisplayError(name: string, message: string): string | null {
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return /system/i.test(message)
      ? 'Your system is blocking screen recording. Allow it in your privacy settings, then try again.'
      : 'Screen sharing was cancelled. Click Start preview to choose a screen, window, or tab.';
  }
  if (name === 'NotFoundError' || name === 'NotReadableError') {
    return 'The screen could not be captured. Try choosing a different screen, window, or tab.';
  }
  return null;
}

function describeNotFound(context: CaptureErrorContext): string {
  const cameras = countDevices(context.devices, 'videoinput');
  const microphones = countDevices(context.devices, 'audioinput');
  const noCamera = context.camera && cameras === 0;
  const noMicrophone = context.microphone && microphones === 0;

  if (noCamera && noMicrophone) {
    return (
      'No camera or microphone was found. Connect them, then try again. If they are ' +
      `connected, check that they are switched on and that ${PRIVACY_HINT}.`
    );
  }
  if (noCamera) {
    const fallback = context.microphone
      ? 'Connect a camera, or turn off Camera to record audio only.'
      : 'Connect a camera, then try again.';
    return (
      `No camera was found. ${fallback} If a camera is connected, check that it is ` +
      `switched on and that ${PRIVACY_HINT}.`
    );
  }
  if (noMicrophone) {
    return (
      'No microphone was found. Connect a microphone, then try again. If one is connected, ' +
      `check that it is switched on and that ${PRIVACY_HINT}.`
    );
  }
  if (context.camera && context.cameraDeviceId) {
    return 'The selected camera is not connected. Choose another camera, or System default.';
  }
  if (context.microphone && context.microphoneDeviceId) {
    return 'The selected microphone is not connected. Choose another microphone, or System default.';
  }
  const noun = requestedNoun(context);
  return (
    `The ${noun} could not be found. Check that it is connected and switched on, and ` +
    `that ${PRIVACY_HINT}.`
  );
}

function describeOverconstrained(error: unknown, context: CaptureErrorContext): string {
  const constraint = failedConstraint(error);
  if (constraint === 'deviceId' || constraint === 'groupId') {
    if (context.camera && context.cameraDeviceId) {
      return 'The selected camera is not connected. Choose another camera, or System default.';
    }
    if (context.microphone && context.microphoneDeviceId) {
      return 'The selected microphone is not connected. Choose another microphone, or System default.';
    }
  }
  const noun = requestedNoun(context);
  const setting = constraint ? ` (${constraint})` : '';
  return (
    `Your ${noun} cannot provide the requested settings${setting}. Clear that value in ` +
    'Advanced device settings, or set Constraint strength to Preferred.'
  );
}

/**
 * One actionable sentence for a recorder/narration capture failure. Falls
 * back to the error's own message for anything that isn't a recognised
 * capture rejection.
 */
export function describeCaptureError(error: unknown, context: CaptureErrorContext): string {
  const name = errorName(error);
  const message = errorMessage(error);

  if (typeof error === 'object' && error !== null && displayCaptureErrors.has(error)) {
    const display = describeDisplayError(name, message);
    if (display) return display;
  }

  if (name === 'NotFoundError' || /requested device not found/i.test(message)) {
    return describeNotFound(context);
  }
  if (name === 'OverconstrainedError') {
    return describeOverconstrained(error, context);
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    const noun = requestedNoun(context);
    return /system/i.test(message)
      ? `Your system's privacy settings are blocking the ${noun}. Allow access for this app, then try again.`
      : `Access to the ${noun} was blocked. Allow it when prompted, or in your browser or system settings, then try again.`;
  }
  if (name === 'NotReadableError' || /could not start (video|audio) source/i.test(message)) {
    const noun = /video source/i.test(message)
      ? 'camera'
      : /audio source/i.test(message)
        ? 'microphone'
        : requestedNoun(context);
    return (
      `The ${noun} could not start. Another app may be using it: close apps that use the ` +
      `${noun}, then try again.`
    );
  }
  if (/getUserMedia is not available/i.test(message)) {
    return 'Cameras and microphones are not available here. Recording needs a browser or app that can access them.';
  }
  if (/getDisplayMedia is not available/i.test(message)) {
    return 'Screen capture is not available here. Recording the screen needs a browser or app that supports it.';
  }
  return message || 'Recording could not start.';
}
