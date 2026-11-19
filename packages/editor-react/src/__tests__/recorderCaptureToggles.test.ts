/**
 * What the recorder's capture-source toggles mean: the capture mode a
 * combination resolves to, the starting toggles on a platform without screen
 * capture, and which pills a platform is offered at all.
 */

import { describe, expect, it } from 'vitest';
import {
  captureSummary,
  deriveSource,
  offeredToggleGroups,
  toggleStateFromMode,
  withoutScreen,
} from '../recorder/captureToggles';
import type { RecorderSource } from '../recorder/hooks/useMediaRecorder';

const MODES: RecorderSource[] = ['mic', 'camera', 'screen', 'screen+mic', 'screen+camera'];

describe('capture toggles', () => {
  it('round-trips every starting mode through its toggles', () => {
    for (const mode of MODES) {
      expect(deriveSource(toggleStateFromMode(mode))).toBe(mode);
    }
  });

  it('resolves no selected source to nothing to capture', () => {
    expect(deriveSource({ micOn: false, cameraOn: false, screenOn: false })).toBeNull();
  });

  it('drops the screen on a platform without screen capture, keeping something to record', () => {
    expect(deriveSource(withoutScreen(toggleStateFromMode('screen')))).toBe('mic');
    expect(deriveSource(withoutScreen(toggleStateFromMode('screen+mic')))).toBe('mic');
    expect(deriveSource(withoutScreen(toggleStateFromMode('screen+camera')))).toBe('camera');
    const camera = toggleStateFromMode('camera');
    expect(withoutScreen(camera)).toBe(camera);
  });

  it('offers every pill on desktop Chromium', () => {
    const keys = offeredToggleGroups(true, true).map((g) => g.toggles.map((t) => t.key));
    expect(keys).toEqual([
      ['mic', 'camera'],
      ['systemAudio', 'screen'],
    ]);
  });

  it('withholds system audio where only the screen can be captured', () => {
    const keys = offeredToggleGroups(true, false).map((g) => g.toggles.map((t) => t.key));
    expect(keys).toEqual([['mic', 'camera'], ['screen']]);
  });

  it('leaves the screen group out entirely on phones and tablets', () => {
    const groups = offeredToggleGroups(false, false);
    expect(groups.map((g) => g.label)).toEqual(['Voice and camera']);
  });

  it('summarizes what a combination will capture', () => {
    expect(captureSummary(false, false, false, false)).toBe('Pick at least one source to record.');
    expect(captureSummary(true, true, true, false)).toMatch(/two video clips/);
    expect(captureSummary(true, false, false, true)).toMatch(/pick a screen or tab/);
  });
});
