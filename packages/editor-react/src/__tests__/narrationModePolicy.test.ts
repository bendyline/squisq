/**
 * Branch coverage for the Record media dialog's narration-mode policy
 * helpers — the pure logic behind the "Show narration mode" checkbox lock,
 * the Escape-to-close gate, and the Close confirmation.
 */
import { describe, expect, it } from 'vitest';
import {
  closeNeedsConfirm,
  escapeClosesDialog,
  narrationCaptureSummary,
  narrationQuiescent,
  narrationToggleLocked,
} from '../recorder/narrationModePolicy';
import type { RecorderState } from '../recorder/hooks/useMediaRecorder';
import type { NarrationRecorderState } from '../teleprompter/recording/useNarrationRecorder';

const NARRATION_STATES: NarrationRecorderState[] = [
  'idle',
  'starting',
  'recording',
  'processing',
  'review',
  'saving',
  'error',
];

describe('narrationQuiescent', () => {
  it('is true only for idle and error', () => {
    for (const state of NARRATION_STATES) {
      expect(narrationQuiescent(state)).toBe(state === 'idle' || state === 'error');
    }
  });
});

describe('narrationToggleLocked', () => {
  it('locks while the simple recorder is busy', () => {
    for (const state of ['recording', 'requesting', 'stopping'] as RecorderState[]) {
      expect(narrationToggleLocked(state, false, 'idle')).toBe(true);
    }
  });

  it('locks while an unsaved simple take is in review', () => {
    expect(narrationToggleLocked('stopped', true, 'idle')).toBe(true);
  });

  it('does not lock on stopped without a blob (take already discarded)', () => {
    expect(narrationToggleLocked('stopped', false, 'idle')).toBe(false);
  });

  it('locks while a narration take is in flight or awaiting review', () => {
    for (const state of NARRATION_STATES) {
      expect(narrationToggleLocked('idle', false, state)).toBe(!narrationQuiescent(state));
    }
  });

  it('is unlocked when both sides are quiescent', () => {
    expect(narrationToggleLocked('idle', false, 'idle')).toBe(false);
    expect(narrationToggleLocked('error', false, 'error')).toBe(false);
    expect(narrationToggleLocked('ready', false, 'idle')).toBe(false);
  });
});

describe('escapeClosesDialog', () => {
  it('always closes when narration mode is off', () => {
    expect(escapeClosesDialog(false, 'recording', 'rolling')).toBe(true);
  });

  it('never closes while the prompter is rolling or counting down', () => {
    expect(escapeClosesDialog(true, 'idle', 'rolling')).toBe(false);
    expect(escapeClosesDialog(true, 'idle', 'countdown')).toBe(false);
  });

  it('never closes while a narration take is in flight', () => {
    for (const state of ['starting', 'recording', 'processing', 'review', 'saving'] as const) {
      expect(escapeClosesDialog(true, state, 'stopped')).toBe(false);
    }
  });

  it('closes when narration is on but everything is quiet', () => {
    expect(escapeClosesDialog(true, 'idle', 'stopped')).toBe(true);
    expect(escapeClosesDialog(true, 'error', 'paused')).toBe(true);
    expect(escapeClosesDialog(true, 'idle', 'finished')).toBe(true);
  });
});

describe('closeNeedsConfirm', () => {
  it('never confirms when narration mode is off', () => {
    expect(closeNeedsConfirm(false, 'recording', true)).toBe(false);
  });

  it('confirms while a take is in flight', () => {
    for (const state of ['starting', 'recording', 'processing', 'saving'] as const) {
      expect(closeNeedsConfirm(true, state, false)).toBe(true);
    }
  });

  it('confirms in review only when a take is actually in hand', () => {
    expect(closeNeedsConfirm(true, 'review', true)).toBe(true);
    expect(closeNeedsConfirm(true, 'review', false)).toBe(false);
  });

  it('does not confirm when quiescent', () => {
    expect(closeNeedsConfirm(true, 'idle', false)).toBe(false);
    expect(closeNeedsConfirm(true, 'error', false)).toBe(false);
  });
});

describe('narrationCaptureSummary', () => {
  it('describes mic-only and mic+camera captures distinctly', () => {
    const micOnly = narrationCaptureSummary(false);
    const withCamera = narrationCaptureSummary(true);
    expect(micOnly).toMatch(/microphone/i);
    expect(withCamera).toMatch(/camera/i);
    expect(micOnly).not.toBe(withCamera);
  });
});
