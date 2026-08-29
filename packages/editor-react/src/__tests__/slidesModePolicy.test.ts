/**
 * Branch coverage for the Record media dialog's slides-mode policy helpers —
 * the peer of `narrationModePolicy.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { RecorderState } from '../recorder/hooks/useMediaRecorder';
import {
  SLIDE_TIMING_CHECKBOX_LABEL,
  clampSlideIndex,
  isExpandedPanel,
  panelModeAfterToggle,
  showSlideTimingCheckbox,
  slideStepForKey,
  unshownSlidesWarning,
  type RecorderPanelMode,
} from '../recorder/slidesModePolicy';

const MODES: RecorderPanelMode[] = ['none', 'narration', 'slides'];
const STATES: RecorderState[] = [
  'idle',
  'requesting',
  'ready',
  'recording',
  'stopping',
  'stopped',
  'error',
];

describe('isExpandedPanel', () => {
  it('expands for either panel and only for those', () => {
    expect(MODES.map(isExpandedPanel)).toEqual([false, true, true]);
  });
});

describe('panelModeAfterToggle', () => {
  it('checking a box selects it from any starting mode', () => {
    for (const mode of MODES) {
      expect(panelModeAfterToggle(mode, 'slides', true)).toBe('slides');
      expect(panelModeAfterToggle(mode, 'narration', true)).toBe('narration');
    }
  });

  it('checking one box deselects the other — exclusion is structural', () => {
    expect(panelModeAfterToggle('narration', 'slides', true)).toBe('slides');
    expect(panelModeAfterToggle('slides', 'narration', true)).toBe('narration');
  });

  it('unchecking the active box collapses the panel', () => {
    expect(panelModeAfterToggle('slides', 'slides', false)).toBe('none');
    expect(panelModeAfterToggle('narration', 'narration', false)).toBe('none');
  });

  it('unchecking a box that is not active leaves the mode alone', () => {
    // A stale change event from the box that was just superseded must not
    // close the panel the user actually opened.
    expect(panelModeAfterToggle('slides', 'narration', false)).toBe('slides');
    expect(panelModeAfterToggle('narration', 'slides', false)).toBe('narration');
    expect(panelModeAfterToggle('none', 'slides', false)).toBe('none');
  });
});

describe('clampSlideIndex', () => {
  it('clamps into range', () => {
    expect(clampSlideIndex(-3, 5)).toBe(0);
    expect(clampSlideIndex(2, 5)).toBe(2);
    expect(clampSlideIndex(9, 5)).toBe(4);
  });

  it('returns 0 for an empty deck or an unusable index', () => {
    expect(clampSlideIndex(3, 0)).toBe(0);
    expect(clampSlideIndex(0, -1)).toBe(0);
    expect(clampSlideIndex(Number.NaN, 5)).toBe(0);
  });

  it('floors a fractional index', () => {
    expect(clampSlideIndex(2.9, 5)).toBe(2);
  });
});

describe('slideStepForKey', () => {
  it('maps forward keys', () => {
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar']) {
      expect(slideStepForKey(key)).toBe(1);
    }
  });

  it('maps backward keys', () => {
    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp']) {
      expect(slideStepForKey(key)).toBe(-1);
    }
  });

  it('claims nothing else — Escape and Tab stay with the dialog', () => {
    for (const key of ['Escape', 'Tab', 'Enter', 'a', 'Home']) {
      expect(slideStepForKey(key)).toBe(0);
    }
  });
});

describe('showSlideTimingCheckbox', () => {
  const base = {
    slidesOn: true,
    captureTimings: true,
    recorderState: 'stopped' as RecorderState,
    hasBlob: true,
  };

  it('shows only with a finished take in slides mode on a capturing host', () => {
    expect(showSlideTimingCheckbox(base)).toBe(true);
  });

  it('hides without slides mode, without capture capability, or without a take', () => {
    expect(showSlideTimingCheckbox({ ...base, slidesOn: false })).toBe(false);
    expect(showSlideTimingCheckbox({ ...base, captureTimings: false })).toBe(false);
    expect(showSlideTimingCheckbox({ ...base, hasBlob: false })).toBe(false);
  });

  it('hides in every recorder state but stopped', () => {
    for (const recorderState of STATES) {
      expect(showSlideTimingCheckbox({ ...base, recorderState })).toBe(recorderState === 'stopped');
    }
  });
});

describe('unshownSlidesWarning', () => {
  it('is null when everything was shown', () => {
    expect(unshownSlidesWarning(12, 0)).toBeNull();
    expect(unshownSlidesWarning(0, 0)).toBeNull();
  });

  it('reports the count and agrees in number', () => {
    expect(unshownSlidesWarning(12, 3)).toBe(
      "3 of 12 slides were never shown — they'll be skipped during playback.",
    );
    expect(unshownSlidesWarning(12, 1)).toBe(
      "1 of 12 slide was never shown — they'll be skipped during playback.",
    );
  });
});

describe('SLIDE_TIMING_CHECKBOX_LABEL', () => {
  it('is the exact user-facing wording', () => {
    expect(SLIDE_TIMING_CHECKBOX_LABEL).toBe('Update block timings when I save this narration');
  });
});
