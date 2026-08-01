/**
 * The rules that decide what a recorder device picker lists — and whether the
 * picker is worth showing outside Advanced settings at all.
 *
 * The load-bearing case is Chromium's audio-input aliasing: a machine with ONE
 * microphone enumerates three `audioinput` entries (`default`,
 * `communications`, and the real device). Counting raw entries would promote a
 * picker onto the dialog for a user who has nothing to choose between.
 */

import { describe, expect, it } from 'vitest';
import {
  hasRecorderDeviceChoice,
  recorderDeviceGroups,
  recorderDeviceOptions,
} from '../recorder/mediaDeviceList';

function device(
  deviceId: string,
  kind: MediaDeviceKind,
  label: string,
  groupId = 'group-a',
): MediaDeviceInfo {
  return { deviceId, kind, label, groupId, toJSON: () => ({}) } as MediaDeviceInfo;
}

/** What Chromium reports for a single physical microphone. */
const SINGLE_MIC: MediaDeviceInfo[] = [
  device('default', 'audioinput', 'Default - Microphone (Shure MV7+)'),
  device('communications', 'audioinput', 'Communications - Microphone (Shure MV7+)'),
  device('real-shure', 'audioinput', 'Microphone (Shure MV7+)'),
];

describe('recorderDeviceOptions', () => {
  it('collapses Chromium default/communications aliases to the one real device', () => {
    const options = recorderDeviceOptions(SINGLE_MIC, 'audioinput', 'Microphone');
    expect(options.map((option) => option.deviceId)).toEqual(['real-shure']);
    expect(hasRecorderDeviceChoice(options)).toBe(false);
  });

  it('reports a choice once a second physical device exists', () => {
    const options = recorderDeviceOptions(
      [...SINGLE_MIC, device('real-webcam-mic', 'audioinput', 'Webcam mic', 'group-b')],
      'audioinput',
      'Microphone',
    );
    expect(options.map((option) => option.label)).toEqual([
      'Microphone (Shure MV7+)',
      'Webcam mic',
    ]);
    expect(hasRecorderDeviceChoice(options)).toBe(true);
  });

  it('drops the id-less placeholders returned before a permission grant', () => {
    const options = recorderDeviceOptions(
      [device('', 'videoinput', ''), device('', 'videoinput', '')],
      'videoinput',
      'Camera',
    );
    expect(options).toEqual([]);
    expect(hasRecorderDeviceChoice(options)).toBe(false);
  });

  it('keeps a selected alias id so a persisted setting cannot vanish', () => {
    const options = recorderDeviceOptions(SINGLE_MIC, 'audioinput', 'Microphone', 'communications');
    expect(options.map((option) => option.deviceId)).toEqual(['communications', 'real-shure']);
  });

  it('never lets the empty "System default" selection resurrect a blank-id entry', () => {
    const options = recorderDeviceOptions(
      [device('', 'audioinput', ''), device('real', 'audioinput', 'Real mic')],
      'audioinput',
      'Microphone',
      '',
    );
    expect(options.map((option) => option.deviceId)).toEqual(['real']);
  });

  it('filters by kind and numbers unlabeled devices positionally', () => {
    const options = recorderDeviceOptions(
      [
        device('mic', 'audioinput', 'A microphone'),
        device('cam-1', 'videoinput', ''),
        device('cam-2', 'videoinput', '', 'group-b'),
      ],
      'videoinput',
      'Camera',
    );
    expect(options.map((option) => option.label)).toEqual(['Camera 1', 'Camera 2']);
  });
});

describe('recorderDeviceGroups', () => {
  it('lists each hardware group once, in first-seen order', () => {
    const options = recorderDeviceOptions(
      [
        device('a', 'audioinput', 'Desk rig mic', 'desk'),
        device('b', 'audioinput', 'Desk rig aux', 'desk'),
        device('c', 'audioinput', 'Laptop mic', 'laptop'),
      ],
      'audioinput',
      'Microphone',
    );
    expect(recorderDeviceGroups(options)).toEqual([
      { id: 'desk', label: 'Desk rig mic' },
      { id: 'laptop', label: 'Laptop mic' },
    ]);
  });

  it('skips devices that report no group', () => {
    const options = recorderDeviceOptions(
      [device('a', 'videoinput', 'Grouped', 'g'), device('b', 'videoinput', 'Ungrouped', '')],
      'videoinput',
      'Camera',
    );
    expect(recorderDeviceGroups(options)).toEqual([{ id: 'g', label: 'Grouped' }]);
  });
});
