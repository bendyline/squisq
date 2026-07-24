/**
 * User-configurable recorder device/encoding settings.
 *
 * Values stay serializable so the modal can include them in its capture key:
 * changing a setting releases any prepared preview before a new stream is
 * requested. Numeric and string track values are expressed as either `ideal`
 * (best effort) or `exact` (fail when unavailable) constraints. Display
 * capture is the exception: the screen-capture standard rejects exact
 * constraints during its user picker, so those values always remain ideal.
 */

export type RecorderConstraintMode = 'ideal' | 'exact';

export interface RecorderAudioDeviceSettings {
  deviceId: string;
  groupId?: string;
  autoGainControl?: boolean;
  channelCount?: number;
  echoCancellation?: boolean;
  latency?: number;
  noiseSuppression?: boolean;
  sampleRate?: number;
  sampleSize?: number;
}

export interface RecorderCameraDeviceSettings {
  deviceId: string;
  groupId?: string;
  aspectRatio?: number;
  backgroundBlur?: boolean;
  facingMode?: string;
  frameRate?: number;
  height?: number;
  resizeMode?: string;
  width?: number;
}

export interface RecorderScreenDeviceSettings {
  aspectRatio?: number;
  cursor?: string;
  displaySurface?: string;
  frameRate?: number;
  height?: number;
  logicalSurface?: boolean;
  resizeMode?: string;
  width?: number;
}

export interface RecorderScreenAudioSettings {
  restrictOwnAudio?: boolean;
  suppressLocalAudioPlayback?: boolean;
}

export interface RecorderEncodingSettings {
  audioMimeType: string;
  videoMimeType: string;
  bitsPerSecond?: number;
  audioBitsPerSecond?: number;
  videoBitsPerSecond?: number;
  audioBitrateMode?: 'constant' | 'variable';
  videoKeyFrameIntervalDuration?: number;
  videoKeyFrameIntervalCount?: number;
}

export interface RecorderDeviceSettings {
  constraintMode: RecorderConstraintMode;
  audio: RecorderAudioDeviceSettings;
  camera: RecorderCameraDeviceSettings;
  screen: RecorderScreenDeviceSettings;
  screenAudio: RecorderScreenAudioSettings;
  encoding: RecorderEncodingSettings;
}

export const DEFAULT_RECORDER_DEVICE_SETTINGS: RecorderDeviceSettings = {
  constraintMode: 'ideal',
  audio: { deviceId: '' },
  camera: { deviceId: '' },
  screen: {},
  screenAudio: {},
  encoding: {
    audioMimeType: '',
    videoMimeType: '',
  },
};

type ConstraintRecord = Record<string, unknown>;

function preferredNumber(
  value: number | undefined,
  mode: RecorderConstraintMode,
): ConstrainDouble | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return { [mode]: value };
}

function preferredInteger(
  value: number | undefined,
  mode: RecorderConstraintMode,
): ConstrainULong | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return { [mode]: Math.round(value) };
}

function preferredString(
  value: string | undefined,
  mode: RecorderConstraintMode,
): ConstrainDOMString | undefined {
  const trimmed = value?.trim();
  return trimmed ? { [mode]: trimmed } : undefined;
}

/** Build microphone constraints from the advanced settings form. */
export function buildRecorderAudioConstraints(
  settings: RecorderDeviceSettings,
): MediaTrackConstraints {
  const { audio, constraintMode } = settings;
  const result: ConstraintRecord = {};
  if (audio.deviceId) result.deviceId = { exact: audio.deviceId };
  const groupId = preferredString(audio.groupId, constraintMode);
  if (groupId) result.groupId = groupId;
  if (audio.autoGainControl !== undefined) result.autoGainControl = audio.autoGainControl;
  if (audio.echoCancellation !== undefined) result.echoCancellation = audio.echoCancellation;
  if (audio.noiseSuppression !== undefined) result.noiseSuppression = audio.noiseSuppression;

  const channelCount = preferredInteger(audio.channelCount, constraintMode);
  const latency = preferredNumber(audio.latency, constraintMode);
  const sampleRate = preferredInteger(audio.sampleRate, constraintMode);
  const sampleSize = preferredInteger(audio.sampleSize, constraintMode);
  if (channelCount) result.channelCount = channelCount;
  if (latency) result.latency = latency;
  if (sampleRate) result.sampleRate = sampleRate;
  if (sampleSize) result.sampleSize = sampleSize;
  return result as MediaTrackConstraints;
}

/** Build camera constraints from the advanced settings form. */
export function buildRecorderCameraConstraints(
  settings: RecorderDeviceSettings,
): MediaTrackConstraints {
  const { camera, constraintMode } = settings;
  const result: ConstraintRecord = {};
  if (camera.deviceId) result.deviceId = { exact: camera.deviceId };
  const groupId = preferredString(camera.groupId, constraintMode);
  if (groupId) result.groupId = groupId;
  if (camera.backgroundBlur !== undefined) result.backgroundBlur = camera.backgroundBlur;

  const aspectRatio = preferredNumber(camera.aspectRatio, constraintMode);
  const facingMode = preferredString(camera.facingMode, constraintMode);
  const frameRate = preferredNumber(camera.frameRate, constraintMode);
  const height = preferredInteger(camera.height, constraintMode);
  const resizeMode = preferredString(camera.resizeMode, constraintMode);
  const width = preferredInteger(camera.width, constraintMode);
  if (aspectRatio) result.aspectRatio = aspectRatio;
  if (facingMode) result.facingMode = facingMode;
  if (frameRate) result.frameRate = frameRate;
  if (height) result.height = height;
  if (resizeMode) result.resizeMode = resizeMode;
  if (width) result.width = width;
  return result as MediaTrackConstraints;
}

/** Build display-capture constraints independently from camera constraints. */
export function buildRecorderScreenConstraints(
  settings: RecorderDeviceSettings,
): MediaTrackConstraints {
  const { screen } = settings;
  const result: ConstraintRecord = {};
  // getDisplayMedia rejects `exact`/`min` constraints during source
  // acquisition. Screen constraints are therefore always preferences applied
  // after the user chooses a surface.
  const aspectRatio = preferredNumber(screen.aspectRatio, 'ideal');
  const cursor = preferredString(screen.cursor, 'ideal');
  const displaySurface = preferredString(screen.displaySurface, 'ideal');
  const frameRate = preferredNumber(screen.frameRate, 'ideal');
  const height = preferredInteger(screen.height, 'ideal');
  const resizeMode = preferredString(screen.resizeMode, 'ideal');
  const width = preferredInteger(screen.width, 'ideal');
  if (screen.logicalSurface !== undefined) result.logicalSurface = screen.logicalSurface;
  if (aspectRatio) result.aspectRatio = aspectRatio;
  if (cursor) result.cursor = cursor;
  if (displaySurface) result.displaySurface = displaySurface;
  if (frameRate) result.frameRate = frameRate;
  if (height) result.height = height;
  if (resizeMode) result.resizeMode = resizeMode;
  if (width) result.width = width;
  return result as MediaTrackConstraints;
}

/** Build the audio-track constraints specific to getDisplayMedia. */
export function buildRecorderScreenAudioConstraints(
  settings: RecorderDeviceSettings,
): MediaTrackConstraints {
  const result: ConstraintRecord = {};
  if (settings.screenAudio.restrictOwnAudio !== undefined) {
    result.restrictOwnAudio = settings.screenAudio.restrictOwnAudio;
  }
  if (settings.screenAudio.suppressLocalAudioPlayback !== undefined) {
    result.suppressLocalAudioPlayback = settings.screenAudio.suppressLocalAudioPlayback;
  }
  return result as MediaTrackConstraints;
}

/** Convert the form's kbps values to the bps values MediaRecorder expects. */
export function recorderBitsPerSecond(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 1000);
}
