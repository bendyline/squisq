/**
 * Dictation orchestration — the one place that coordinates the host's speech
 * provider, the microphone session, and the two editor surfaces.
 *
 * It runs inside `EditorProvider` (so `useEditorContext().dictation` can drive
 * it from a host menu even where the toolbar button isn't showing) and is
 * deliberately cheap when idle: without a capability it does nothing at all,
 * and with one it only resolves the provider and asks for its readiness. The
 * capture engine, activity gate and WAV encoder load through a dynamic
 * `import()` the first time the author actually starts dictating.
 *
 * Contract:
 *  - idle → preparing (status check, engine module, microphone) → listening →
 *    transcribing (stop requested: the last takes finish) → idle;
 *  - each recognized phrase is inserted, as literal text and one undo step, at
 *    the caret of whichever text view is showing when it ARRIVES — the author
 *    may move the caret, or switch Write ↔ Source, mid-session;
 *  - a phrase that arrives while no text view is mounted is held and inserted
 *    as soon as one is;
 *  - leaving the text views (or unmounting) finishes / cancels the session;
 *  - a factory capability's provider is owned (disposed) here; an instance is
 *    the host's.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import type { EditorMode, EditorView } from '../EditorContext';
import {
  isSpeechInputProviderFactory,
  resolveSpeechInputProvider,
  type DictationControl,
  type SpeechInputCapability,
  type SpeechInputProvider,
  type SpeechInputReadiness,
} from './types.js';
import { insertDictationIntoMonaco, insertDictationIntoTiptap } from './dictationInsertion.js';
import { setDictationInterim } from './DictationExtension.js';
import {
  createMonacoDictationInterim,
  type MonacoDictationInterim,
} from './monacoDictationInterim.js';
import {
  NO_SPEECH_DETECTED_MESSAGE,
  humanizeDictationError,
  setupRequiredMessage,
} from './dictationErrors.js';
import type { DictationSessionHandle } from './dictationSession.js';

type MonacoEditor = MonacoEditorNs.IStandaloneCodeEditor;

export type DictationStatus = 'idle' | 'preparing' | 'listening' | 'transcribing';

/** Number of bars in the toolbar's rolling level meter. */
export const DICTATION_METER_BARS = 12;

/** A tiny external store for the 20 Hz level meter, so it never re-renders the editor. */
export interface DictationLevels {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly number[];
}

interface DictationLevelStore extends DictationLevels {
  push(level: number): void;
  reset(): void;
}

const EMPTY_LEVELS: readonly number[] = Object.freeze(
  Array.from({ length: DICTATION_METER_BARS }, () => 0),
);

/** Map typical microphone RMS values into a legible 0–1 display envelope. */
export function normalizeMeterLevel(level: number): number {
  return Math.min(1, Math.max(0, level * 14));
}

function createLevelStore(): DictationLevelStore {
  let levels = EMPTY_LEVELS;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => levels,
    push(level) {
      levels = [...levels.slice(1), normalizeMeterLevel(level)];
      notify();
    },
    reset() {
      if (levels === EMPTY_LEVELS) return;
      levels = EMPTY_LEVELS;
      notify();
    },
  };
}

/** Everything the toolbar button needs. */
export interface DictationState {
  status: DictationStatus;
  /** Last known readiness; `null` until the provider first answers. */
  readiness: SpeechInputReadiness | null;
  /** `toggle()` would do something (see {@link DictationControl.available}). */
  available: boolean;
  /** The provider's label, for tooltips. */
  providerLabel: string;
  /** Captured takes still awaiting transcription. */
  pendingTakes: number;
  /** A message for the author, or null. */
  error: string | null;
  levels: DictationLevels;
  toggle(): void;
  dismissError(): void;
}

export const DictationStateContext = createContext<DictationState | null>(null);

/** Dictation state for the toolbar button, or null when the host injected no capability. */
export function useDictationState(): DictationState | null {
  return useContext(DictationStateContext);
}

/** The interim caret label for a status, or null when nothing should show. */
export function dictationInterimText(status: DictationStatus, pendingTakes: number): string | null {
  switch (status) {
    case 'preparing':
      return 'Starting…';
    case 'listening':
      return pendingTakes > 0 ? 'Transcribing…' : 'Listening…';
    case 'transcribing':
      return 'Transcribing…';
    default:
      return null;
  }
}

export interface DictationControllerInput {
  capability: SpeechInputCapability | null;
  activeView: EditorView;
  editorMode: EditorMode;
  tiptapEditor: TiptapEditor | null;
  monacoEditor: MonacoEditor | null;
}

export interface DictationController {
  control: DictationControl | null;
  state: DictationState | null;
}

interface ActiveSession {
  abort: AbortController;
  handle: DictationSessionHandle | null;
  stopping: boolean;
}

function isTextView(view: EditorView): boolean {
  return view === 'wysiwyg' || view === 'raw';
}

export function useDictationController({
  capability,
  activeView,
  editorMode,
  tiptapEditor,
  monacoEditor,
}: DictationControllerInput): DictationController {
  const [provider, setProvider] = useState<SpeechInputProvider | null>(null);
  const [readiness, setReadiness] = useState<SpeechInputReadiness | null>(null);
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [pendingTakes, setPendingTakes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const levelsRef = useRef<DictationLevelStore | null>(null);
  if (!levelsRef.current) levelsRef.current = createLevelStore();
  const levels = levelsRef.current;

  const providerRef = useRef(provider);
  providerRef.current = provider;
  const readinessRef = useRef(readiness);
  readinessRef.current = readiness;
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const tiptapRef = useRef(tiptapEditor);
  tiptapRef.current = tiptapEditor;
  const monacoRef = useRef(monacoEditor);
  monacoRef.current = monacoEditor;
  const sessionRef = useRef<ActiveSession | null>(null);
  const heldPhrasesRef = useRef<string[]>([]);

  const textViewActive = editorMode === 'markdown' && isTextView(activeView);
  const available =
    provider !== null && readiness !== null && readiness.state !== 'unavailable' && textViewActive;
  const availableRef = useRef(available);
  availableRef.current = available;

  /**
   * Hand focus back to the text view when a session ends, so the next
   * keystroke (or Cmd/Ctrl+Z) reaches the document instead of the toolbar's
   * Stop button. The caret is wherever the last phrase left it: Tiptap's
   * `focus()` restores its stored selection, Monaco keeps its cursor. Only
   * focus that dictation itself displaced is reclaimed — from the page body
   * or the dictation control — never from another input the author has
   * moved to since.
   */
  const restoreEditorFocus = useCallback(() => {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    const reclaimable =
      !active ||
      active === document.body ||
      (active instanceof Element && active.closest('.squisq-dictation') !== null);
    if (!reclaimable) return;
    const view = activeViewRef.current;
    const tiptap = tiptapRef.current;
    if (view === 'wysiwyg' && tiptap && !tiptap.isDestroyed) {
      tiptap.commands.focus();
      return;
    }
    const monaco = monacoRef.current;
    if (view === 'raw' && monaco) monaco.focus();
  }, []);

  // ── Session lifecycle ───────────────────────────────────────────────
  const endSession = useCallback(
    (session: ActiveSession, options: { restoreFocus?: boolean } = {}) => {
      if (sessionRef.current !== session) return;
      sessionRef.current = null;
      session.abort.abort();
      levels.reset();
      setPendingTakes(0);
      setStatus('idle');
      if (options.restoreFocus) restoreEditorFocus();
    },
    [levels, restoreEditorFocus],
  );

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.handle?.cancel();
    endSession(session, { restoreFocus: true });
  }, [endSession]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    if (!session.handle) {
      // Still starting: there is nothing captured to finish.
      cancel();
      return;
    }
    if (session.stopping) return;
    session.stopping = true;
    setStatus('transcribing');
    try {
      await session.handle.stop();
    } finally {
      // Every captured phrase has been inserted by now; the caret sits after
      // the last one.
      endSession(session, { restoreFocus: true });
    }
  }, [cancel, endSession]);

  /** Insert into whichever text view is showing; false when none is. */
  const insertPhrase = useCallback((text: string): boolean => {
    const view = activeViewRef.current;
    const tiptap = tiptapRef.current;
    if (view === 'wysiwyg' && tiptap && !tiptap.isDestroyed) {
      insertDictationIntoTiptap(tiptap, text);
      return true;
    }
    const monaco = monacoRef.current;
    if (view === 'raw' && monaco) {
      insertDictationIntoMonaco(monaco, text);
      return true;
    }
    return false;
  }, []);

  const start = useCallback(async () => {
    const active = providerRef.current;
    if (!active || sessionRef.current) return;
    const session: ActiveSession = { abort: new AbortController(), handle: null, stopping: false };
    sessionRef.current = session;
    const isCurrent = () => sessionRef.current === session;
    setError(null);
    setPendingTakes(0);
    levels.reset();
    setStatus('preparing');
    try {
      const fresh = await active.status();
      if (!isCurrent()) return;
      setReadiness(fresh);
      if (fresh.state === 'download-required' || fresh.state === 'unavailable') {
        endSession(session);
        if (fresh.state === 'download-required') {
          if (active.requestSetup) active.requestSetup();
          else setError(setupRequiredMessage(fresh.reason));
        }
        return;
      }
      const { startDictationSession } = await import('./dictationSession.js');
      if (!isCurrent()) return;
      const handle = await startDictationSession({
        provider: active,
        signal: session.abort.signal,
        onTranscript: (text) => {
          if (!isCurrent()) return;
          if (!insertPhrase(text)) heldPhrasesRef.current.push(text);
        },
        onAudioLevel: (level) => {
          if (isCurrent()) levels.push(level);
        },
        onPendingChange: (pending) => {
          if (isCurrent()) setPendingTakes(pending);
        },
        onLongPause: (hadTranscript) => {
          if (!isCurrent()) return;
          if (!hadTranscript) setError(NO_SPEECH_DETECTED_MESSAGE);
          void stop();
        },
        onError: (caught) => {
          if (!isCurrent()) return;
          session.handle?.cancel();
          endSession(session, { restoreFocus: true });
          setError(humanizeDictationError(caught));
        },
      });
      if (!isCurrent()) {
        handle.cancel();
        return;
      }
      session.handle = handle;
      setStatus('listening');
    } catch (caught) {
      if (!isCurrent()) return;
      endSession(session, { restoreFocus: true });
      setError(humanizeDictationError(caught));
    }
  }, [endSession, insertPhrase, levels, stop]);

  const toggle = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      // Starting → cancel; listening → finish and stop; finishing → no-op.
      void stop();
      return;
    }
    const active = providerRef.current;
    if (!active || !availableRef.current) return;
    const known = readinessRef.current;
    if (known?.state === 'download-required') {
      // Synchronously, inside the click, so a host can open UI that needs a
      // user gesture.
      setError(null);
      if (active.requestSetup) active.requestSetup();
      else setError(setupRequiredMessage(known.reason));
      // Re-read readiness so a provider without `onStatus` whose setup has
      // since finished starts on the next click.
      active.status().then(
        (next) => {
          if (providerRef.current === active) setReadiness(next);
        },
        () => undefined,
      );
      return;
    }
    void start();
  }, [start, stop]);

  const dismissError = useCallback(() => setError(null), []);

  // ── Provider resolution + readiness ─────────────────────────────────
  useEffect(() => {
    if (!capability) {
      setProvider(null);
      setReadiness(null);
      return;
    }
    const owned = isSpeechInputProviderFactory(capability);
    const instance = resolveSpeechInputProvider(capability);
    let alive = true;
    setProvider(instance);
    setReadiness(null);
    instance.status().then(
      (next) => {
        if (alive) setReadiness(next);
      },
      (caught: unknown) => {
        if (!alive) return;
        const reason = caught instanceof Error ? caught.message : String(caught);
        setReadiness({ state: 'unavailable', reason });
      },
    );
    const unsubscribe = instance.onStatus?.((next) => {
      if (alive) setReadiness(next);
    });
    return () => {
      alive = false;
      unsubscribe?.();
      // A session belongs to the provider it was started with.
      const session = sessionRef.current;
      if (session) {
        session.handle?.cancel();
        sessionRef.current = null;
        session.abort.abort();
      }
      setStatus('idle');
      setPendingTakes(0);
      if (owned) instance.dispose?.();
    };
  }, [capability]);

  // Unmount: never leave a microphone open behind a vanished editor.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (!session) return;
      session.handle?.cancel();
      sessionRef.current = null;
      session.abort.abort();
    },
    [],
  );

  // Leaving the text views finishes the session (pending takes still land —
  // held until a text view mounts again).
  useEffect(() => {
    if (!textViewActive && sessionRef.current) void stop();
  }, [textViewActive, stop]);

  // Esc stops — unless something else (a menu, a dialog) consumed it first.
  // Listening on `window` puts this after every document-level dismissal.
  const sessionActive = status !== 'idle';
  useEffect(() => {
    if (!sessionActive || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      void stop();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionActive, stop]);

  // Flush phrases that arrived while no text view was mounted.
  useEffect(() => {
    if (heldPhrasesRef.current.length === 0) return;
    const held = heldPhrasesRef.current;
    heldPhrasesRef.current = [];
    for (let index = 0; index < held.length; index += 1) {
      if (!insertPhrase(held[index])) {
        heldPhrasesRef.current = held.slice(index);
        return;
      }
    }
  }, [activeView, tiptapEditor, monacoEditor, insertPhrase]);

  // ── Interim caret indicator ─────────────────────────────────────────
  // Inert without a capability: the editors are never touched at all.
  const hasCapability = capability !== null;
  const interimLabel = hasCapability ? dictationInterimText(status, pendingTakes) : null;

  useEffect(() => {
    if (!tiptapEditor || !hasCapability) return;
    setDictationInterim(tiptapEditor, activeView === 'wysiwyg' ? interimLabel : null);
  }, [tiptapEditor, hasCapability, activeView, interimLabel]);
  useEffect(() => {
    if (!tiptapEditor || !hasCapability) return;
    return () => setDictationInterim(tiptapEditor, null);
  }, [tiptapEditor, hasCapability]);

  const monacoInterimRef = useRef<MonacoDictationInterim | null>(null);
  useEffect(() => {
    if (!monacoEditor) return;
    return () => {
      monacoInterimRef.current?.dispose();
      monacoInterimRef.current = null;
    };
  }, [monacoEditor]);
  useEffect(() => {
    if (!monacoEditor) return;
    const label = activeView === 'raw' ? interimLabel : null;
    if (!label && !monacoInterimRef.current) return;
    if (!monacoInterimRef.current)
      monacoInterimRef.current = createMonacoDictationInterim(monacoEditor);
    monacoInterimRef.current.update(label);
  }, [monacoEditor, activeView, interimLabel]);

  // ── Public surfaces ─────────────────────────────────────────────────
  const control = useMemo<DictationControl | null>(
    () => (hasCapability ? { active: sessionActive, available, toggle } : null),
    [hasCapability, sessionActive, available, toggle],
  );

  const providerLabel = provider?.label ?? '';
  const state = useMemo<DictationState | null>(
    () =>
      hasCapability
        ? {
            status,
            readiness,
            available,
            providerLabel,
            pendingTakes,
            error,
            levels,
            toggle,
            dismissError,
          }
        : null,
    [
      hasCapability,
      status,
      readiness,
      available,
      providerLabel,
      pendingTakes,
      error,
      levels,
      toggle,
      dismissError,
    ],
  );

  return { control, state };
}
