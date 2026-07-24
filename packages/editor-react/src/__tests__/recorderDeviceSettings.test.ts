import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECORDER_DEVICE_SETTINGS,
  buildRecorderAudioConstraints,
  buildRecorderCameraConstraints,
  buildRecorderScreenAudioConstraints,
  buildRecorderScreenConstraints,
  recorderBitsPerSecond,
  type RecorderDeviceSettings,
} from '../recorder/deviceSettings.js';

function settings(patch: Partial<RecorderDeviceSettings> = {}): RecorderDeviceSettings {
  return {
    ...DEFAULT_RECORDER_DEVICE_SETTINGS,
    audio: { ...DEFAULT_RECORDER_DEVICE_SETTINGS.audio },
    camera: { ...DEFAULT_RECORDER_DEVICE_SETTINGS.camera },
    screen: { ...DEFAULT_RECORDER_DEVICE_SETTINGS.screen },
    screenAudio: { ...DEFAULT_RECORDER_DEVICE_SETTINGS.screenAudio },
    encoding: { ...DEFAULT_RECORDER_DEVICE_SETTINGS.encoding },
    ...patch,
  };
}

describe('recorder advanced device settings', () => {
  it('builds every microphone constraint with an exact device and preferred values', () => {
    const value = settings({
      audio: {
        deviceId: 'mic-2',
        groupId: 'desk-rig',
        autoGainControl: false,
        channelCount: 2,
        echoCancellation: true,
        latency: 0.02,
        noiseSuppression: false,
        sampleRate: 48_000,
        sampleSize: 24,
      },
    });

    expect(buildRecorderAudioConstraints(value)).toEqual({
      deviceId: { exact: 'mic-2' },
      groupId: { ideal: 'desk-rig' },
      autoGainControl: false,
      echoCancellation: true,
      noiseSuppression: false,
      channelCount: { ideal: 2 },
      latency: { ideal: 0.02 },
      sampleRate: { ideal: 48_000 },
      sampleSize: { ideal: 24 },
    });
  });

  it('builds camera and screen constraints independently', () => {
    const value = settings({
      constraintMode: 'exact',
      camera: {
        deviceId: 'camera-2',
        groupId: 'desk-rig',
        width: 1920,
        height: 1080,
        aspectRatio: 16 / 9,
        frameRate: 30,
        facingMode: 'user',
        resizeMode: 'crop-and-scale',
        backgroundBlur: true,
      },
      screen: {
        width: 2560,
        height: 1440,
        aspectRatio: 16 / 9,
        frameRate: 60,
        displaySurface: 'monitor',
        cursor: 'always',
        logicalSurface: true,
        resizeMode: 'none',
      },
    });

    expect(buildRecorderCameraConstraints(value)).toEqual({
      deviceId: { exact: 'camera-2' },
      groupId: { exact: 'desk-rig' },
      backgroundBlur: true,
      aspectRatio: { exact: 16 / 9 },
      facingMode: { exact: 'user' },
      frameRate: { exact: 30 },
      height: { exact: 1080 },
      resizeMode: { exact: 'crop-and-scale' },
      width: { exact: 1920 },
    });
    expect(buildRecorderScreenConstraints(value)).toEqual({
      logicalSurface: true,
      aspectRatio: { ideal: 16 / 9 },
      cursor: { ideal: 'always' },
      displaySurface: { ideal: 'monitor' },
      frameRate: { ideal: 60 },
      height: { ideal: 1440 },
      resizeMode: { ideal: 'none' },
      width: { ideal: 2560 },
    });
  });

  it('builds display-audio processing constraints', () => {
    const value = settings({
      screenAudio: {
        restrictOwnAudio: true,
        suppressLocalAudioPlayback: false,
      },
    });
    expect(buildRecorderScreenAudioConstraints(value)).toEqual({
      restrictOwnAudio: true,
      suppressLocalAudioPlayback: false,
    });
  });

  it('leaves browser defaults unconstrained and converts kbps to bps', () => {
    const value = settings();
    expect(buildRecorderAudioConstraints(value)).toEqual({});
    expect(buildRecorderCameraConstraints(value)).toEqual({});
    expect(buildRecorderScreenConstraints(value)).toEqual({});
    expect(buildRecorderScreenAudioConstraints(value)).toEqual({});
    expect(recorderBitsPerSecond(192)).toBe(192_000);
    expect(recorderBitsPerSecond(undefined)).toBeUndefined();
    expect(recorderBitsPerSecond(0)).toBeUndefined();
  });
});
