/**
 * Shared types for the Narrate (teleprompter) display mode.
 */

export interface TeleprompterPrefs {
  /** Prompter type size in px (28–96). */
  fontSizePx: number;
  /** Beam-splitter mirror flip. */
  mirrored: boolean;
  /** Base speaking rate in words per minute (80–260). */
  baseWpm: number;
  /** Voice-adaptive pacing on/off; off = constant-rate manual mode. */
  voiceTracking: boolean;
  /** VAD sensitivity 0–1 (0.5 = engine defaults). */
  vadSensitivity: number;
  /** Countdown before the prompter starts rolling. */
  countdownSec: 0 | 3 | 5 | 10;
  /** Eye-line chevrons + focus band. */
  lineGuide: boolean;
  /** Preferred mic device id (null = system default). */
  micDeviceId: string | null;
}

export const DEFAULT_TELEPROMPTER_PREFS: TeleprompterPrefs = Object.freeze({
  fontSizePx: 48,
  mirrored: false,
  baseWpm: 150,
  voiceTracking: true,
  vadSensitivity: 0.5,
  countdownSec: 3,
  lineGuide: true,
  micDeviceId: null,
});

export type PrompterTransport = 'stopped' | 'countdown' | 'rolling' | 'paused' | 'finished';

/** Floating-surface tier, best first. */
export type FloatTier = 'document-pip' | 'video-pip' | 'popup' | 'docked';
