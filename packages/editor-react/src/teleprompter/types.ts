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

export const TELEPROMPTER_PREF_LIMITS = Object.freeze({
  fontSizePx: { min: 28, max: 96 },
  baseWpm: { min: 80, max: 260 },
  vadSensitivity: { min: 0, max: 1 },
  micDeviceIdMaxLength: 1024,
});

const COUNTDOWN_OPTIONS = new Set<TeleprompterPrefs['countdownSec']>([0, 3, 5, 10]);

function isCountdownOption(value: unknown): value is TeleprompterPrefs['countdownSec'] {
  return (
    typeof value === 'number' && COUNTDOWN_OPTIONS.has(value as TeleprompterPrefs['countdownSec'])
  );
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Validate persisted or externally supplied preferences and return a complete,
 * bounded value. Unknown keys are ignored; invalid fields retain `fallback`.
 */
export function normalizeTeleprompterPrefs(
  value: unknown,
  fallback: TeleprompterPrefs = DEFAULT_TELEPROMPTER_PREFS,
): TeleprompterPrefs {
  const input =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const countdown = input.countdownSec;
  const micDeviceId = input.micDeviceId;

  return {
    fontSizePx: clampNumber(
      input.fontSizePx,
      TELEPROMPTER_PREF_LIMITS.fontSizePx.min,
      TELEPROMPTER_PREF_LIMITS.fontSizePx.max,
      fallback.fontSizePx,
    ),
    mirrored: booleanOr(input.mirrored, fallback.mirrored),
    baseWpm: clampNumber(
      input.baseWpm,
      TELEPROMPTER_PREF_LIMITS.baseWpm.min,
      TELEPROMPTER_PREF_LIMITS.baseWpm.max,
      fallback.baseWpm,
    ),
    voiceTracking: booleanOr(input.voiceTracking, fallback.voiceTracking),
    vadSensitivity: clampNumber(
      input.vadSensitivity,
      TELEPROMPTER_PREF_LIMITS.vadSensitivity.min,
      TELEPROMPTER_PREF_LIMITS.vadSensitivity.max,
      fallback.vadSensitivity,
    ),
    countdownSec: isCountdownOption(countdown) ? countdown : fallback.countdownSec,
    lineGuide: booleanOr(input.lineGuide, fallback.lineGuide),
    micDeviceId:
      micDeviceId === null ||
      (typeof micDeviceId === 'string' &&
        micDeviceId.length > 0 &&
        micDeviceId.length <= TELEPROMPTER_PREF_LIMITS.micDeviceIdMaxLength)
        ? micDeviceId
        : micDeviceId === ''
          ? null
          : fallback.micDeviceId,
  };
}

export type PrompterTransport = 'stopped' | 'countdown' | 'rolling' | 'paused' | 'finished';

/** Floating-surface tier, best first. */
export type FloatTier = 'document-pip' | 'video-pip' | 'popup' | 'docked';
