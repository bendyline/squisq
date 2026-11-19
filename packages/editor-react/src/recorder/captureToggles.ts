/**
 * The recorder's capture-source toggles — Microphone, Camera, System audio,
 * Screen — and how a combination of them resolves to a capture mode. Pure:
 * the dialog (`RecorderModal`) owns the state and the platform probes, and
 * asks this module what the toggles mean.
 */

import type { RecorderSource } from './hooks/useMediaRecorder.js';

/** Which of the four capture sources a toggle controls. */
export type ToggleKey = 'mic' | 'camera' | 'screen' | 'systemAudio';

/** The capture-source toggle state driving the recorder mode. */
export interface CaptureToggles {
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
}

/** A labelled group of capture-source pills. */
export interface CaptureToggleGroup {
  label: string;
  toggles: Array<{ key: ToggleKey; label: string }>;
}

/**
 * Resolve the toggle state to the recorder's capture mode. Returns null when
 * no source is selected — there's nothing to capture, so the controls stay
 * disabled.
 *
 * Camera and Screen can be captured TOGETHER (`'screen+camera'`), each written
 * to its own file: the microphone rides the camera file, system audio rides
 * the screen file. With only one video source on, the microphone composes with
 * it (or stands alone as narration).
 */
export function deriveSource({ micOn, cameraOn, screenOn }: CaptureToggles): RecorderSource | null {
  if (cameraOn && screenOn) return 'screen+camera';
  if (cameraOn) return 'camera'; // mic handled via includeMicrophone
  if (screenOn) return micOn ? 'screen+mic' : 'screen';
  return micOn ? 'mic' : null;
}

/** Initial toggle state for a given starting capture mode. */
export function toggleStateFromMode(mode: RecorderSource): CaptureToggles {
  switch (mode) {
    case 'mic':
      return { micOn: true, cameraOn: false, screenOn: false };
    case 'camera':
      return { micOn: true, cameraOn: true, screenOn: false };
    case 'screen':
      return { micOn: false, cameraOn: false, screenOn: true };
    case 'screen+mic':
      return { micOn: true, cameraOn: false, screenOn: true };
    case 'screen+camera':
      return { micOn: true, cameraOn: true, screenOn: true };
  }
}

/**
 * The starting toggles on a platform without screen capture: a screen mode
 * keeps its microphone and camera, and falls back to the microphone when
 * the screen was its only source.
 */
export function withoutScreen(toggles: CaptureToggles): CaptureToggles {
  if (!toggles.screenOn) return toggles;
  const micOn = toggles.micOn || !toggles.cameraOn;
  return { micOn, cameraOn: toggles.cameraOn, screenOn: false };
}

/**
 * Capture-source pills, grouped so the presenter inputs (mic + camera) read
 * as a pair distinct from the screen inputs (system audio + screen).
 */
const TOGGLE_GROUPS: readonly CaptureToggleGroup[] = [
  {
    label: 'Voice and camera',
    toggles: [
      { key: 'mic', label: 'Microphone' },
      { key: 'camera', label: 'Camera' },
    ],
  },
  {
    label: 'Screen capture',
    toggles: [
      { key: 'systemAudio', label: 'System audio' },
      { key: 'screen', label: 'Screen' },
    ],
  },
];

/**
 * The pill groups this platform can honor. System audio has no meaning without
 * a display capture, and no platform outside desktop Chromium offers it;
 * phones and tablets have no screen picker at all, which empties the screen
 * group — and a group with nothing to offer is left out.
 */
export function offeredToggleGroups(
  canCaptureScreen: boolean,
  canIncludeSystemAudio: boolean,
): CaptureToggleGroup[] {
  return TOGGLE_GROUPS.map((group) => ({
    ...group,
    toggles: group.toggles.filter(
      (t) =>
        (t.key !== 'screen' || canCaptureScreen) &&
        (t.key !== 'systemAudio' || canIncludeSystemAudio),
    ),
  })).filter((group) => group.toggles.length > 0);
}

/** One-line summary of what the current toggle combination will capture. */
export function captureSummary(
  micOn: boolean,
  cameraOn: boolean,
  screenOn: boolean,
  systemAudioOn: boolean,
): string {
  // System audio mixed into a non-screen recording is captured through a
  // screen/tab picker whose video we discard — worth flagging in the summary.
  const systemNote =
    ' Your computer’s audio is mixed in — you’ll pick a screen or tab to share it.';
  const withSystem = systemAudioOn && !screenOn && (micOn || cameraOn);
  if (cameraOn && screenOn) {
    // Dual capture already routes system audio to the screen clip (described).
    return micOn
      ? 'Screen capture plus your camera as picture-in-picture; microphone on the camera clip, system audio on the screen clip when available. Saved as two video clips.'
      : 'Screen capture plus your camera as picture-in-picture (no microphone). Saved as two video clips.';
  }
  if (cameraOn) {
    const base = micOn
      ? 'Camera video with your microphone. Saved as a video clip.'
      : 'Camera video only (no microphone). Saved as a video clip.';
    return withSystem ? `${base}${systemNote}` : base;
  }
  if (screenOn) {
    return micOn
      ? 'Screen capture with your microphone mixed in. System audio when available.'
      : 'Screen capture (no microphone). System audio when available.';
  }
  if (micOn) {
    return systemAudioOn
      ? `Voice plus your computer’s audio.${systemNote} Saved as an audio clip.`
      : 'Voice-only audio. Pairs with a written script for auto-mapping to blocks.';
  }
  return 'Pick at least one source to record.';
}
