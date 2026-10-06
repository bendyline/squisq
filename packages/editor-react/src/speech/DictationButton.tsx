/**
 * DictationButton — the toolbar microphone for the host-injected `speechInput`
 * capability. Lives in its own module (Toolbar.tsx is near its line budget);
 * the toolbar mounts it beside the recorder entry and it decides for itself
 * whether to render: nothing without a capability, nothing while the provider
 * is `unavailable` or hasn't answered yet, nothing outside the Write and
 * Source views.
 *
 * All orchestration lives in `useDictationController` (inside
 * `EditorProvider`); this component is presentation: state → icon, label,
 * level meter, live-region announcements and the inline error bubble.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../Icon';
import {
  useDictationState,
  type DictationLevels,
  type DictationState,
  type DictationStatus,
} from './useDictationController.js';

/** How long an error bubble stays up before dismissing itself. */
const ERROR_AUTO_DISMISS_MS = 10_000;

const ANNOUNCEMENTS: Record<DictationStatus, string> = {
  idle: 'Dictation off.',
  preparing: 'Starting dictation.',
  listening: 'Dictation on. Listening.',
  transcribing: 'Finishing dictation.',
};

function tooltipFor(state: DictationState): string {
  const { status, readiness, pendingTakes } = state;
  switch (status) {
    case 'preparing':
      return 'Starting the microphone — click to cancel';
    case 'listening':
      return pendingTakes > 0
        ? 'Listening (transcribing your last phrase) — click or press Esc to stop'
        : 'Listening — pause to add a phrase; click or press Esc to stop';
    case 'transcribing':
      return 'Adding the last of your speech…';
    default:
      break;
  }
  if (readiness?.state === 'download-required') {
    return readiness.reason ? `Set up dictation — ${readiness.reason}` : 'Set up dictation';
  }
  if (readiness?.state === 'permission-required') {
    return 'Dictate with your microphone (permission needed)';
  }
  return state.providerLabel ? `Dictate (${state.providerLabel})` : 'Dictate with your microphone';
}

function LevelMeter({ levels }: { levels: DictationLevels }) {
  const snapshot = useSyncExternalStore(levels.subscribe, levels.getSnapshot, levels.getSnapshot);
  return (
    <span
      className="squisq-dictation-meter"
      data-testid="squisq-dictation-meter"
      aria-hidden="true"
    >
      {snapshot.map((level, index) => (
        <span
          // Position is the identity in this fixed-length rolling buffer.
          key={index}
          className="squisq-dictation-meter-bar"
          style={{ height: `${2 + Math.round(level * 12)}px` }}
        />
      ))}
    </span>
  );
}

function DictationButtonView({ state }: { state: DictationState }) {
  const { status, error, toggle, dismissError, levels } = state;
  const active = status !== 'idle';
  const busy = status === 'preparing' || status === 'transcribing';

  // Announce transitions, not the resting state at mount.
  const [announcement, setAnnouncement] = useState('');
  const previousStatus = useRef<DictationStatus>(status);
  useEffect(() => {
    if (previousStatus.current === status) return;
    previousStatus.current = status;
    setAnnouncement(ANNOUNCEMENTS[status]);
  }, [status]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(dismissError, ERROR_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [error, dismissError]);

  const className = [
    'squisq-toolbar-button',
    'squisq-dictation-button',
    active ? 'squisq-toolbar-button--active squisq-dictation-button--active' : '',
    status === 'listening' ? 'squisq-dictation-button--listening' : '',
    state.readiness?.state === 'download-required' && !active
      ? 'squisq-dictation-button--setup'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className="squisq-dictation" data-state={status}>
      <button
        type="button"
        className={className}
        onClick={toggle}
        aria-pressed={active}
        aria-label={active ? 'Stop dictation' : 'Start dictation'}
        aria-busy={busy || undefined}
        data-tooltip={tooltipFor(state)}
        data-testid="squisq-dictation-button"
        data-state={status}
      >
        <Icon icon="fa-solid fa-microphone" />
        {status === 'listening' && <LevelMeter levels={levels} />}
      </button>
      <span className="squisq-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {error && (
        <span className="squisq-dictation-error" role="alert" data-testid="squisq-dictation-error">
          <span className="squisq-dictation-error-text">{error}</span>
          <button
            type="button"
            className="squisq-dictation-error-dismiss"
            onClick={dismissError}
            aria-label="Dismiss dictation message"
          >
            <Icon icon="fa-solid fa-xmark" />
          </button>
        </span>
      )}
    </span>
  );
}

/**
 * The toolbar microphone. Renders nothing when the host injected no
 * `speechInput`, while readiness is unknown or `unavailable`, or when neither
 * text view is showing (it stays while a session it started is finishing).
 */
export function DictationButton(): JSX.Element | null {
  const state = useDictationState();
  if (!state) return null;
  if (state.status === 'idle') {
    // A session in flight always keeps its button (it may need stopping).
    if (!state.readiness || state.readiness.state === 'unavailable') return null;
    if (!state.available && state.error === null) return null;
  }
  return <DictationButtonView state={state} />;
}
