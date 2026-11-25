/**
 * An AI action and its run, in one place: why AI is unavailable beside the
 * button it disables, the button, and while a run goes the progress and
 * Stop in the button's place — so progress sits where the action started,
 * and keyboard focus moves between the button and Stop instead of dropping
 * on the page.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface AssistantRunControlsProps {
  /** The button's label, e.g. "Suggest with AI". */
  label: string;
  /** The button's tooltip when AI is ready. */
  title: string;
  /** Undefined while checking, null when ready, otherwise why AI cannot run. */
  readiness: string | null | undefined;
  /** The button cannot be used for a reason of the designer's own (nothing to do). */
  disabled?: boolean;
  readOnly?: boolean;
  /** While a run goes: what it is doing, and how far (`total` 0 shows activity only). */
  progress: { label: string; done: number; total: number; measure: string } | null;
  /** Stop's tooltip. */
  stopTitle: string;
  onStart: () => void;
  onStop: () => void;
  /** Host-supplied detail shown beside the progress (e.g. the model's own status). */
  activity?: ReactNode;
}

export function AssistantRunControls({
  label,
  title,
  readiness,
  disabled = false,
  readOnly = false,
  progress,
  stopTitle,
  onStart,
  onStop,
  activity,
}: AssistantRunControlsProps) {
  const reasonId = useId();
  const startButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const running = progress !== null;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current === running) return;
    wasRunning.current = running;
    // The button leaves for the run and Stop takes its place; keep keyboard
    // focus with them instead of dropping it on the page.
    if (document.activeElement === null || document.activeElement === document.body)
      (running ? stopButton.current : startButton.current)?.focus();
  }, [running]);

  if (progress)
    return (
      <>
        <div className="squisq-designer-progress" role="status">
          <span className="squisq-designer-spinner" aria-hidden="true" />
          <span>{progress.label}</span>
          {/* No value without a total: the bar shows activity, not an amount. */}
          <progress
            max={progress.total || undefined}
            value={progress.total ? progress.done : undefined}
            aria-label={progress.measure}
          />
          {activity}
        </div>
        <button ref={stopButton} type="button" title={stopTitle} onClick={onStop}>
          Stop
        </button>
      </>
    );
  const unavailable = typeof readiness === 'string' && !readOnly;
  return (
    <>
      {/* Why AI is off, beside the button it disables: a reason in the tooltip
          alone made the button read as missing. Not while the first check
          runs, so opening the designer does not flicker. */}
      {unavailable && (
        <span id={reasonId} className="squisq-designer-reason">
          {readiness}
        </span>
      )}
      <button
        ref={startButton}
        type="button"
        disabled={disabled || readiness !== null || readOnly}
        aria-describedby={unavailable ? reasonId : undefined}
        title={readiness === undefined ? 'Checking whether AI is available…' : (readiness ?? title)}
        onClick={onStart}
      >
        {label}
      </button>
    </>
  );
}
