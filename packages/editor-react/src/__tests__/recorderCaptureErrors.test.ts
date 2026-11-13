/**
 * Recorder capture failures, as the author reads them.
 *
 * The load-bearing case is Chromium's "Requested device not found": one
 * `NotFoundError` for a combined camera + microphone request, with nothing to
 * say which device is missing. The device inventory answers that.
 */

import { describe, expect, it } from 'vitest';
import { describeCaptureError, markDisplayCaptureError } from '../recorder/captureErrors';

function device(deviceId: string, kind: MediaDeviceKind, label = ''): MediaDeviceInfo {
  return { deviceId, kind, label, groupId: 'g', toJSON: () => ({}) } as MediaDeviceInfo;
}

function domError(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { name }, extra);
}

const NOT_FOUND = domError('NotFoundError', 'Requested device not found');

/** A desktop with two microphones and no webcam. */
const MICS_ONLY = [
  device('default', 'audioinput', 'Default - Mic A'),
  device('mic-a', 'audioinput', 'Mic A'),
  device('mic-b', 'audioinput', 'Mic B'),
  device('speakers', 'audiooutput', 'Speakers'),
];

const MIC_AND_CAMERA = [...MICS_ONLY, device('cam-1', 'videoinput', 'Webcam')];

describe('describeCaptureError', () => {
  it('names the missing camera and offers audio-only when the mic is also requested', () => {
    const text = describeCaptureError(NOT_FOUND, {
      camera: true,
      microphone: true,
      devices: MICS_ONLY,
    });
    expect(text).toMatch(/^No camera was found\./);
    expect(text).toContain('turn off Camera to record audio only');
  });

  it('does not suggest turning the camera off when it is the only source', () => {
    const text = describeCaptureError(NOT_FOUND, {
      camera: true,
      microphone: false,
      devices: MICS_ONLY,
    });
    expect(text).toMatch(/^No camera was found\./);
    expect(text).not.toContain('turn off Camera');
  });

  it('names a missing microphone', () => {
    const text = describeCaptureError(NOT_FOUND, {
      camera: true,
      microphone: true,
      devices: [device('cam-1', 'videoinput'), device('speakers', 'audiooutput')],
    });
    expect(text).toMatch(/^No microphone was found\./);
  });

  it('names both when neither kind is present', () => {
    const text = describeCaptureError(NOT_FOUND, {
      camera: true,
      microphone: true,
      devices: [device('speakers', 'audiooutput')],
    });
    expect(text).toMatch(/^No camera or microphone was found\./);
  });

  it('counts pre-permission placeholders (blank ids) as present devices', () => {
    const text = describeCaptureError(NOT_FOUND, {
      camera: true,
      microphone: true,
      devices: [device('', 'audioinput'), device('', 'videoinput')],
    });
    expect(text).not.toMatch(/^No /);
  });

  it('blames a stale device selection when the devices exist', () => {
    const text = describeCaptureError(NOT_FOUND, {
      camera: true,
      microphone: true,
      cameraDeviceId: 'unplugged-cam',
      devices: MIC_AND_CAMERA,
    });
    expect(text).toMatch(/selected camera is not connected/);
  });

  it('treats an empty inventory as unknown rather than "no devices"', () => {
    const text = describeCaptureError(NOT_FOUND, { camera: true, microphone: true, devices: [] });
    expect(text).toMatch(/^The camera or microphone could not be found\./);
  });

  it('maps an unmet deviceId constraint to the selected device', () => {
    const error = domError('OverconstrainedError', '', { constraint: 'deviceId' });
    const text = describeCaptureError(error, {
      camera: false,
      microphone: true,
      microphoneDeviceId: 'gone',
      devices: MICS_ONLY,
    });
    expect(text).toMatch(/selected microphone is not connected/);
  });

  it('points other unmet constraints at the advanced settings', () => {
    const error = domError('OverconstrainedError', '', { constraint: 'width' });
    const text = describeCaptureError(error, { camera: true, microphone: false });
    expect(text).toContain('(width)');
    expect(text).toContain('Constraint strength to Preferred');
  });

  it('distinguishes a system-level block from a declined prompt', () => {
    const context = { camera: true, microphone: true };
    expect(
      describeCaptureError(domError('NotAllowedError', 'Permission denied by system'), context),
    ).toMatch(/system's privacy settings are blocking the camera or microphone/);
    expect(describeCaptureError(domError('NotAllowedError', 'Permission denied'), context)).toMatch(
      /Access to the camera or microphone was blocked/,
    );
  });

  it('names the busy device from Chromium’s NotReadableError message', () => {
    const text = describeCaptureError(
      domError('NotReadableError', 'Could not start video source'),
      { camera: true, microphone: true },
    );
    expect(text).toMatch(/^The camera could not start\./);
  });

  it('reads a cancelled screen picker as a cancellation, not a denied camera', () => {
    const error = markDisplayCaptureError(domError('NotAllowedError', 'Permission denied'));
    const text = describeCaptureError(error, { camera: true, microphone: true });
    expect(text).toMatch(/^Screen sharing was cancelled\./);
  });

  it('passes unrecognised errors through unchanged', () => {
    expect(
      describeCaptureError(new Error('Save failed'), { camera: false, microphone: true }),
    ).toBe('Save failed');
  });
});
