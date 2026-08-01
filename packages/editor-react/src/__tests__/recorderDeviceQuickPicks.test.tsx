/**
 * @vitest-environment jsdom
 *
 * The microphone / camera pickers promoted out of "Advanced device settings".
 *
 * Each appears only when its source is enabled AND the machine has more than
 * one real device of that kind — so the common single-webcam, single-mic setup
 * gains no new chrome, while a multi-device rig gets the choice up front
 * instead of five fields deep in a disclosure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { RecorderModal } from '../recorder/RecorderModal';

const mediaProvider: MediaProvider = {
  resolveUrl: vi.fn(async (path: string) => path),
  listMedia: vi.fn(async () => []),
  addMedia: vi.fn(async (name: string) => name),
  removeMedia: vi.fn(async () => undefined),
  dispose: vi.fn(),
};

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  constructor(public kind: 'audio' | 'video') {}
  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[] = [new FakeTrack('audio')]) {}
  get active() {
    return this.tracks.some((t) => t.readyState === 'live');
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

/** Minimal MediaRecorder so the dialog reports capture as supported. */
class FakeMediaRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  mimeType: string;
  constructor(
    public stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }
  static isTypeSupported() {
    return true;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['take'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function device(
  deviceId: string,
  kind: MediaDeviceKind,
  label: string,
  groupId = 'g',
): MediaDeviceInfo {
  return { deviceId, kind, label, groupId, toJSON: () => ({}) } as MediaDeviceInfo;
}

/** One physical mic as Chromium reports it: two aliases plus the real entry. */
const ONE_MIC = [
  device('default', 'audioinput', 'Default - Shure MV7+'),
  device('communications', 'audioinput', 'Communications - Shure MV7+'),
  device('shure', 'audioinput', 'Shure MV7+'),
];
const TWO_MICS = [...ONE_MIC, device('webcam-mic', 'audioinput', 'Webcam mic', 'cam')];
const ONE_CAMERA = [device('cam-built-in', 'videoinput', 'Built-in camera')];
const TWO_CAMERAS = [...ONE_CAMERA, device('cam-usb', 'videoinput', 'USB camera', 'usb')];

let getUserMedia: ReturnType<typeof vi.fn>;

function mockDevices(devices: MediaDeviceInfo[]) {
  getUserMedia = vi.fn(async () => new FakeStream());
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      getDisplayMedia: vi.fn(async () => new FakeStream([new FakeTrack('video')])),
      getSupportedConstraints: () => ({ deviceId: true }),
      enumerateDevices: vi.fn(async () => devices),
    },
  });
}

const quickPickMic = () => screen.queryByTestId('recorder-quick-pick-microphone');
const quickPickCamera = () => screen.queryByTestId('recorder-quick-pick-camera');

/** Render and let the initial `enumerateDevices()` promise settle. */
async function renderModal(initialMode: 'mic' | 'camera' = 'mic') {
  render(
    <RecorderModal initialMode={initialMode} mediaProvider={mediaProvider} onClose={vi.fn()} />,
  );
  await act(async () => {});
}

describe('RecorderModal — promoted device pickers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:take'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays hidden when the machine has only one microphone and one camera', async () => {
    mockDevices([...ONE_MIC, ...ONE_CAMERA]);
    await renderModal('camera');

    expect(screen.queryByTestId('recorder-device-quick-picks')).toBeNull();
    expect(quickPickMic()).toBeNull();
    expect(quickPickCamera()).toBeNull();
  });

  it('shows the microphone picker outside Advanced settings for a second mic', async () => {
    mockDevices(TWO_MICS);
    await renderModal('mic');

    const select = quickPickMic();
    expect(select).not.toBeNull();
    // Promoted means promoted: it is not inside the collapsed disclosure.
    expect(screen.getByTestId('recorder-device-settings').contains(select)).toBe(false);
    expect([...(select as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      'System default',
      'Shure MV7+',
      'Webcam mic',
    ]);
  });

  it('shows the camera picker only when a second camera exists', async () => {
    mockDevices([...ONE_MIC, ...ONE_CAMERA]);
    await renderModal('camera');
    expect(quickPickCamera()).toBeNull();

    cleanup();
    mockDevices([...ONE_MIC, ...TWO_CAMERAS]);
    await renderModal('camera');

    const select = quickPickCamera();
    expect(select).not.toBeNull();
    expect(screen.getByTestId('recorder-device-settings').contains(select)).toBe(false);
    expect([...(select as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      'System default',
      'Built-in camera',
      'USB camera',
    ]);
  });

  it('hides each picker when its capture source is switched off', async () => {
    mockDevices([...TWO_MICS, ...TWO_CAMERAS]);
    await renderModal('camera');

    // `initialMode: 'camera'` starts with mic + camera both on.
    expect(quickPickMic()).not.toBeNull();
    expect(quickPickCamera()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    expect(quickPickMic()).not.toBeNull();
    expect(quickPickCamera()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Microphone' }));
    expect(quickPickMic()).toBeNull();
  });

  it('applies the promoted choice as an exact deviceId constraint on capture', async () => {
    mockDevices(TWO_MICS);
    await renderModal('mic');

    fireEvent.change(quickPickMic() as HTMLSelectElement, { target: { value: 'webcam-mic' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start preview' }));
    });

    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ deviceId: { exact: 'webcam-mic' } }),
      }),
    );
  });

  it('stays in lockstep with the same control inside Advanced settings', async () => {
    mockDevices(TWO_MICS);
    await renderModal('mic');

    fireEvent.click(screen.getByText('Advanced device settings'));
    const advanced = screen.getByLabelText('Recording microphone') as HTMLSelectElement;

    fireEvent.change(quickPickMic() as HTMLSelectElement, { target: { value: 'webcam-mic' } });
    expect(advanced.value).toBe('webcam-mic');

    fireEvent.change(advanced, { target: { value: 'shure' } });
    expect((quickPickMic() as HTMLSelectElement).value).toBe('shure');
  });
});
