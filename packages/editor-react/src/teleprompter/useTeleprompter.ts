/**
 * The teleprompter controller — single source of truth, always in the
 * MAIN window (floats are render targets only).
 *
 * Loop-ownership rule: **the audio worklet owns time; the main window
 * owns state; the visible surface owns pixels.** Voice-mode position
 * advances on worklet PCM hops (immune to rAF/timer throttling while
 * the browser is occluded by recording software); manual constant-rate
 * mode uses rAF and is documented as best-effort under occlusion. React
 * state publishes at ~15 Hz; per-hop subscribers (`subscribeTick`)
 * exist for the video-PiP canvas pump.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Doc } from '@bendyline/squisq/schemas';
import {
  buildNarrationScript,
  createNarrationSession,
  narrationSessionStep,
  reanchorSession,
  DEFAULT_VAD_CONFIG,
  type NarrationScript,
  type NarrationSessionState,
  type VadConfig,
} from '@bendyline/squisq/narration';
import { useMicAnalysis, type MicAnalysisHandle } from './useMicAnalysis';
import {
  DEFAULT_TELEPROMPTER_PREFS,
  type PrompterTransport,
  type TeleprompterPrefs,
} from './types';

const PREFS_STORAGE_KEY = 'squisq:teleprompter-prefs';
const PUBLISH_INTERVAL_MS = 66;
/** Rough words-per-line used by keyboard nudges (line granularity without layout). */
const NUDGE_WORDS = 6;

export interface TeleprompterController {
  script: NarrationScript | null;
  transport: PrompterTransport;
  countdownRemaining: number | null;
  /** Fractional word position (published ~15 Hz). */
  wordPos: number;
  /** Smoothed mic level 0–1 for the meter. */
  micLevel: number;
  /** VAD flag for the meter tint. */
  voiceActive: boolean;
  mic: MicAnalysisHandle;
  prefs: TeleprompterPrefs;
  setPrefs: (patch: Partial<TeleprompterPrefs>) => void;
  play: () => void;
  pause: () => void;
  restart: () => void;
  /** Move the prompter by whole tokens and re-anchor voice tracking. */
  nudge: (deltaTokens: number) => void;
  /** Jump to an absolute token index (e.g. click a block marker). */
  seekToToken: (tokenIndex: number) => void;
  /** Per-analysis-tick subscription (video-PiP pump). Not throttled. */
  subscribeTick: (cb: (wordPos: number) => void) => () => void;
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

function loadPrefs(): TeleprompterPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TELEPROMPTER_PREFS };
    const parsed = JSON.parse(raw) as Partial<TeleprompterPrefs>;
    return { ...DEFAULT_TELEPROMPTER_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_TELEPROMPTER_PREFS };
  }
}

function savePrefs(prefs: TeleprompterPrefs): void {
  try {
    globalThis.localStorage?.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private mode, embeds); prefs stay session-scoped.
  }
}

/** Map the 0–1 sensitivity pref onto VAD thresholds (0.5 = engine defaults). */
export function vadConfigForSensitivity(sensitivity: number): Partial<VadConfig> {
  const s = Math.min(1, Math.max(0, sensitivity));
  const factor = 1.5 - s; // 0 → 1.5 (needs louder speech), 1 → 0.5 (hair trigger)
  const enterRatio = Math.min(5, Math.max(2.6, DEFAULT_VAD_CONFIG.enterRatio * factor));
  return {
    enterRatio,
    exitRatio: Math.max(
      2.0,
      enterRatio * (DEFAULT_VAD_CONFIG.exitRatio / DEFAULT_VAD_CONFIG.enterRatio),
    ),
  };
}

export function useTeleprompter(opts: { doc: Doc | null }): TeleprompterController {
  const { doc } = opts;
  const script = useMemo(
    () => (doc && doc.blocks.length > 0 ? buildNarrationScript(doc) : null),
    [doc],
  );

  const [prefs, setPrefsState] = useState<TeleprompterPrefs>(loadPrefs);
  const [transport, setTransport] = useState<PrompterTransport>('stopped');
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [view, setView] = useState({ wordPos: 0, micLevel: 0, voiceActive: false });

  const mic = useMicAnalysis();

  const scriptRef = useRef(script);
  const prefsRef = useRef(prefs);
  const transportRef = useRef(transport);
  const wordPosRef = useRef(0);
  const sessionRef = useRef<NarrationSessionState | null>(null);
  const sessionKeyRef = useRef('');
  const lastPublishRef = useRef(0);
  const tickSubsRef = useRef<Set<(wordPos: number) => void>>(new Set());
  const levelRef = useRef(0);
  const voiceRef = useRef(false);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  scriptRef.current = script;
  prefsRef.current = prefs;
  transportRef.current = transport;

  // Reset position when the script itself changes identity (doc edited).
  useEffect(() => {
    wordPosRef.current = Math.min(wordPosRef.current, script?.tokens.length ?? 0);
    sessionRef.current = null;
    setView((v) => ({ ...v, wordPos: wordPosRef.current }));
  }, [script]);

  const publish = useCallback(
    (force = false) => {
      const now = performance.now();
      if (!force && now - lastPublishRef.current < PUBLISH_INTERVAL_MS) return;
      lastPublishRef.current = now;
      setView({
        wordPos: wordPosRef.current,
        micLevel: levelRef.current,
        voiceActive: voiceRef.current,
      });
    },
    [setView],
  );

  const notifyTick = useCallback(() => {
    for (const cb of tickSubsRef.current) cb(wordPosRef.current);
  }, []);

  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownRemaining(null);
  }, []);

  const finish = useCallback(() => {
    setTransport('finished');
    transportRef.current = 'finished';
  }, []);

  // ── Voice drive: session stepping on worklet hops ──────────────────
  useEffect(() => {
    return mic.subscribeHop((pcm) => {
      const currentScript = scriptRef.current;
      const sampleRate = mic.sampleRate;
      if (!currentScript || !sampleRate) return;

      const currentPrefs = prefsRef.current;
      // The session (noise floor, syllable-rate EMA, pacing state) is
      // expensive learned acoustic state — recreate it ONLY when the
      // sample rate or the script itself changes, not on every WPM /
      // sensitivity tweak. Those prefs are applied to the session's config
      // LIVE below so the slider takes effect on the next hop without
      // discarding the learned floor and forcing a re-warmup.
      const key = `${sampleRate}:${currentScript.tokens.length}:${currentScript.sourceText.length}`;
      let session = sessionRef.current;
      if (!session || sessionKeyRef.current !== key) {
        session = reanchorSession(
          createNarrationSession(sampleRate, currentScript, {
            vad: vadConfigForSensitivity(currentPrefs.vadSensitivity),
            pacing: { baseWpm: currentPrefs.baseWpm },
          }),
          wordPosRef.current,
        );
        sessionKeyRef.current = key;
      } else {
        session = {
          ...session,
          config: {
            ...session.config,
            vad: vadConfigForSensitivity(currentPrefs.vadSensitivity),
            pacing: { baseWpm: currentPrefs.baseWpm },
          },
        };
      }
      session = narrationSessionStep(session, pcm);

      levelRef.current = session.lastFrame ? Math.min(1, session.lastFrame.rms * 6) : 0;
      voiceRef.current = session.vad.speaking;

      if (transportRef.current === 'rolling' && prefsRef.current.voiceTracking) {
        wordPosRef.current = session.pacing.wordPos;
        if (wordPosRef.current >= currentScript.tokens.length) finish();
      } else {
        // Hold position while paused/stopped so resuming doesn't jump.
        session = reanchorSession(session, wordPosRef.current);
      }
      sessionRef.current = session;
      notifyTick();
      publish();
    });
  }, [mic, finish, notifyTick, publish]);

  // ── Manual drive: constant rate when voice tracking is off/unavailable ──
  useEffect(() => {
    if (transport !== 'rolling') return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const currentScript = scriptRef.current;
      const manual = !prefsRef.current.voiceTracking || mic.status !== 'live';
      if (currentScript && manual) {
        wordPosRef.current = Math.min(
          currentScript.tokens.length,
          wordPosRef.current + (prefsRef.current.baseWpm / 60) * dt,
        );
        if (wordPosRef.current >= currentScript.tokens.length) {
          finish();
          publish(true);
          return;
        }
        notifyTick();
      }
      publish();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [transport, mic.status, finish, notifyTick, publish]);

  // ── Transport ───────────────────────────────────────────────────────
  const beginRolling = useCallback(() => {
    clearCountdown();
    if (sessionRef.current) {
      sessionRef.current = reanchorSession(sessionRef.current, wordPosRef.current);
    }
    setTransport('rolling');
    transportRef.current = 'rolling';
  }, [clearCountdown]);

  const play = useCallback(() => {
    if (transportRef.current === 'rolling' || transportRef.current === 'countdown') return;
    if (transportRef.current === 'finished') {
      wordPosRef.current = 0;
      publish(true);
    }
    if (prefsRef.current.voiceTracking && mic.status === 'idle') {
      // Lazy mic start on the user's explicit gesture; denial degrades to
      // manual mode (the manual rAF drive checks mic.status each frame).
      void mic.start(prefsRef.current.micDeviceId);
    }
    const countdown = prefsRef.current.countdownSec;
    if (countdown > 0) {
      setTransport('countdown');
      transportRef.current = 'countdown';
      setCountdownRemaining(countdown);
      let remaining = countdown;
      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) beginRolling();
        else setCountdownRemaining(remaining);
      }, 1000);
    } else {
      beginRolling();
    }
  }, [beginRolling, mic, publish]);

  const pause = useCallback(() => {
    if (transportRef.current === 'countdown') {
      clearCountdown();
      setTransport('stopped');
      transportRef.current = 'stopped';
      return;
    }
    if (transportRef.current !== 'rolling') return;
    setTransport('paused');
    transportRef.current = 'paused';
  }, [clearCountdown]);

  const restart = useCallback(() => {
    clearCountdown();
    wordPosRef.current = 0;
    if (sessionRef.current) sessionRef.current = reanchorSession(sessionRef.current, 0);
    setTransport('stopped');
    transportRef.current = 'stopped';
    publish(true);
  }, [clearCountdown, publish]);

  const seekToToken = useCallback(
    (tokenIndex: number) => {
      const currentScript = scriptRef.current;
      if (!currentScript) return;
      wordPosRef.current = Math.min(Math.max(0, tokenIndex), currentScript.tokens.length);
      if (sessionRef.current) {
        sessionRef.current = reanchorSession(sessionRef.current, wordPosRef.current);
      }
      if (transportRef.current === 'finished') {
        setTransport('paused');
        transportRef.current = 'paused';
      }
      notifyTick();
      publish(true);
    },
    [notifyTick, publish],
  );

  const nudge = useCallback(
    (deltaTokens: number) => seekToToken(Math.round(wordPosRef.current + deltaTokens)),
    [seekToToken],
  );

  const setPrefs = useCallback(
    (patch: Partial<TeleprompterPrefs>) => {
      setPrefsState((prev) => {
        const next = { ...prev, ...patch };
        savePrefs(next);
        // Switching mic device while live restarts capture on the new device.
        if (
          patch.micDeviceId !== undefined &&
          patch.micDeviceId !== prev.micDeviceId &&
          mic.status === 'live'
        ) {
          void mic.start(patch.micDeviceId);
        }
        return next;
      });
    },
    [mic],
  );

  const subscribeTick = useCallback((cb: (wordPos: number) => void) => {
    tickSubsRef.current.add(cb);
    return () => {
      tickSubsRef.current.delete(cb);
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          if (transportRef.current === 'rolling' || transportRef.current === 'countdown') pause();
          else play();
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault();
          nudge(-NUDGE_WORDS);
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          event.preventDefault();
          nudge(NUDGE_WORDS);
          break;
        case '[':
          event.preventDefault();
          setPrefs({ baseWpm: Math.max(80, prefsRef.current.baseWpm - 10) });
          break;
        case ']':
          event.preventDefault();
          setPrefs({ baseWpm: Math.min(260, prefsRef.current.baseWpm + 10) });
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          setPrefs({ mirrored: !prefsRef.current.mirrored });
          break;
        case 'Escape':
          if (transportRef.current === 'countdown' || transportRef.current === 'rolling') {
            event.preventDefault();
            pause();
          }
          break;
        default:
          break;
      }
    },
    [nudge, pause, play, setPrefs],
  );

  // Countdown timer cleanup on unmount.
  useEffect(() => clearCountdown, [clearCountdown]);

  return {
    script,
    transport,
    countdownRemaining,
    wordPos: view.wordPos,
    micLevel: view.micLevel,
    voiceActive: view.voiceActive,
    mic,
    prefs,
    setPrefs,
    play,
    pause,
    restart,
    nudge,
    seekToToken,
    subscribeTick,
    handleKeyDown,
  };
}
