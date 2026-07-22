import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFilename,
  resolveFormat,
  supportsDisplayMedia,
  supportsMediaRecorder,
  supportsSystemAudioCapture,
  supportsUserMedia,
} from '../recorder/formats.js';

/**
 * Most of these probes touch global APIs that jsdom doesn't implement.
 * Each test installs the minimum stub needed to exercise the probe and
 * cleans up after itself so probes in other suites stay independent.
 */

const originalMediaRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
const originalNavigator = globalThis.navigator;

afterEach(() => {
  if (originalMediaRecorder === undefined) {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  } else {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalMediaRecorder;
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  });
});

function installMediaRecorderStub(supported: readonly string[]) {
  const stub = {
    isTypeSupported: (mime: string) => supported.includes(mime),
  };
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = stub;
}

describe('supportsMediaRecorder', () => {
  it('is false when MediaRecorder is undefined', () => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    expect(supportsMediaRecorder()).toBe(false);
  });

  it('is true when a MediaRecorder global exists', () => {
    installMediaRecorderStub(['audio/webm']);
    expect(supportsMediaRecorder()).toBe(true);
  });
});

describe('supportsUserMedia / supportsDisplayMedia', () => {
  it('is false when navigator.mediaDevices is unavailable', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });
    expect(supportsUserMedia()).toBe(false);
    expect(supportsDisplayMedia()).toBe(false);
  });

  it('is true only for the methods that exist', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia: vi.fn() } },
      configurable: true,
    });
    expect(supportsUserMedia()).toBe(true);
    expect(supportsDisplayMedia()).toBe(false);

    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia: vi.fn(), getDisplayMedia: vi.fn() } },
      configurable: true,
    });
    expect(supportsUserMedia()).toBe(true);
    expect(supportsDisplayMedia()).toBe(true);
  });
});

describe('supportsSystemAudioCapture', () => {
  function installNavigator(userAgent: string, userAgentData?: unknown) {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: { getDisplayMedia: vi.fn() },
        userAgent,
        ...(userAgentData === undefined ? {} : { userAgentData }),
      },
      configurable: true,
    });
  }

  it('supports desktop Chrome and Edge through their Chromium brand', () => {
    for (const brand of ['Google Chrome', 'Microsoft Edge']) {
      installNavigator('reduced-user-agent', {
        brands: [{ brand: 'Chromium' }, { brand }],
        mobile: false,
      });
      expect(supportsSystemAudioCapture()).toBe(true);
    }
  });

  it('hides the option in Firefox and Safari', () => {
    for (const userAgent of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15',
    ]) {
      installNavigator(userAgent);
      expect(supportsSystemAudioCapture()).toBe(false);
    }
  });

  it('recognizes desktop Edge when UA Client Hints are unavailable', () => {
    installNavigator(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
    );
    expect(supportsSystemAudioCapture()).toBe(true);
  });

  it('does not offer the option on mobile Chromium', () => {
    installNavigator('Mozilla/5.0 (Linux; Android 16) Chrome/138.0.0.0 Mobile Safari/537.36', {
      brands: [{ brand: 'Chromium' }],
      mobile: true,
    });
    expect(supportsSystemAudioCapture()).toBe(false);
  });

  it('requires getDisplayMedia even in Chromium', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {},
        userAgent: 'Mozilla/5.0 Chrome/138.0.0.0 Safari/537.36',
      },
      configurable: true,
    });
    expect(supportsSystemAudioCapture()).toBe(false);
  });
});

describe('resolveFormat', () => {
  it('picks the first supported audio candidate', () => {
    installMediaRecorderStub(['audio/webm;codecs=opus', 'audio/webm']);
    const fmt = resolveFormat('audio');
    expect(fmt.mimeType).toBe('audio/webm;codecs=opus');
    expect(fmt.extension).toBe('.webm');
    expect(fmt.directory).toBe('audio');
  });

  it('picks the first supported video candidate', () => {
    installMediaRecorderStub(['video/mp4;codecs=avc1.42E01E,mp4a.40.2']);
    const fmt = resolveFormat('video');
    expect(fmt.mimeType).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    expect(fmt.extension).toBe('.mp4');
    expect(fmt.directory).toBe('video');
  });

  it('honors a caller-supplied preferred MIME when supported', () => {
    installMediaRecorderStub(['audio/webm', 'audio/ogg;codecs=opus']);
    const fmt = resolveFormat('audio', 'audio/ogg;codecs=opus');
    expect(fmt.mimeType).toBe('audio/ogg;codecs=opus');
    expect(fmt.extension).toBe('.ogg');
  });

  it('falls through the candidate list when the preferred MIME is unsupported', () => {
    installMediaRecorderStub(['audio/webm']);
    const fmt = resolveFormat('audio', 'audio/aac');
    expect(fmt.mimeType).toBe('audio/webm');
  });

  it('returns an empty MIME with a .webm extension fallback when nothing matches', () => {
    installMediaRecorderStub([]);
    const fmt = resolveFormat('video');
    expect(fmt.mimeType).toBe('');
    expect(fmt.extension).toBe('.webm');
  });

  it('returns the .webm fallback extension when MediaRecorder is absent entirely', () => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    const fmt = resolveFormat('audio');
    expect(fmt.mimeType).toBe('');
    expect(fmt.extension).toBe('.webm');
    expect(fmt.directory).toBe('audio');
  });
});

describe('buildFilename', () => {
  it('uses the basename when supplied, prefixed with the chosen extension', () => {
    expect(buildFilename('audio', '.webm', 'intro')).toBe('intro.webm');
  });

  it('sanitizes filesystem-hostile characters', () => {
    expect(buildFilename('video', '.mp4', 'my recording: take/2?')).toBe(
      'my-recording--take-2-.mp4',
    );
  });

  it('falls back to a timestamped name when no basename is supplied', () => {
    const name = buildFilename('audio', '.webm');
    expect(name.startsWith('narration-')).toBe(true);
    expect(name.endsWith('.webm')).toBe(true);
    // Format is narration-YYYYMMDD-HHMMSS.webm — 15 chars after the prefix.
    expect(name).toMatch(/^narration-\d{8}-\d{6}\.webm$/);
  });

  it('uses the recording-* prefix for video sources', () => {
    const name = buildFilename('video', '.mp4');
    expect(name).toMatch(/^recording-\d{8}-\d{6}\.mp4$/);
  });

  it.each([
    ['audio', 'audio'],
    ['camera-audio', 'video'],
    ['screen-audio', 'video'],
  ] as const)('uses the source-aware %s seed for general recorder output', (seed, kind) => {
    const name = buildFilename(kind, '.webm', undefined, seed);
    expect(name).toMatch(new RegExp(`^${seed}-\\d{8}-\\d{6}\\.webm$`));
  });
});
