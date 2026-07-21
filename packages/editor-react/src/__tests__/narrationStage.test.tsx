/**
 * @vitest-environment jsdom
 *
 * NarrationStage extraction regression: the component renders the full
 * prompter stage — surface, control rail, record slot, review bar — from a
 * NarrationStageHandle alone, and the host-facing knobs (`showSelfView`,
 * `showCameraToggleInRecordSlot`) suppress exactly the chrome the Record
 * media dialog replaces with its own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { buildNarrationScript } from '@bendyline/squisq/narration';
import { DEFAULT_THEME, type MediaProvider } from '@bendyline/squisq/schemas';
import { NarrationStage } from '../teleprompter/NarrationStage';
import type {
  NarrationStageHandle,
  TeleprompterRecordingDeps,
} from '../teleprompter/useNarrationStage';
import type { TeleprompterController } from '../teleprompter/useTeleprompter';
import type { FloatingWindowHandle } from '../teleprompter/useFloatingWindow';
import type {
  NarrationRecorderController,
  NarrationRecorderState,
} from '../teleprompter/recording/useNarrationRecorder';
import { DEFAULT_TELEPROMPTER_PREFS } from '../teleprompter/types';

const doc = markdownToDoc(parseMarkdown('# Section\n\nOne two three four.\n'));
const script = buildNarrationScript(doc);

const mediaProvider: MediaProvider = {
  resolveUrl: vi.fn(async (path: string) => path),
  listMedia: vi.fn(async () => []),
  addMedia: vi.fn(async (name: string) => name),
  removeMedia: vi.fn(async () => undefined),
  dispose: vi.fn(),
};

const recording: TeleprompterRecordingDeps = {
  mediaProvider,
  container: null,
  markdownSource: '# Section\n\nOne two three four.\n',
  setMarkdownSource: vi.fn(),
  bumpMediaRevision: vi.fn(),
};

function stubController(): TeleprompterController {
  return {
    script,
    transport: 'stopped',
    countdownRemaining: null,
    wordPos: 0,
    micLevel: 0,
    voiceActive: false,
    mic: {
      status: 'idle',
      error: null,
      stream: null,
      sampleRate: null,
      devices: [],
      start: vi.fn(async () => null),
      stop: vi.fn(),
      subscribeHop: vi.fn(() => () => {}),
    },
    prefs: DEFAULT_TELEPROMPTER_PREFS,
    setPrefs: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    restart: vi.fn(),
    nudge: vi.fn(),
    seekToToken: vi.fn(),
    subscribeTick: vi.fn(() => () => {}),
    handleKeyDown: vi.fn(),
  };
}

function stubFloat(): FloatingWindowHandle {
  return {
    tier: 'docked',
    isOpen: false,
    supportedTiers: ['popup'],
    portalTarget: null,
    canvasSink: null,
    open: vi.fn(async () => {}),
    close: vi.fn(),
  };
}

function stubRecorder(state: NarrationRecorderState): NarrationRecorderController {
  return {
    state,
    error: null,
    withCamera: false,
    setWithCamera: vi.fn(),
    cameraStream: null,
    take: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    retake: vi.fn(),
    discard: vi.fn(),
    beginSave: vi.fn(),
    finishSave: vi.fn(),
  };
}

function stubHandle(overrides: Partial<NarrationStageHandle> = {}): NarrationStageHandle {
  return {
    controller: stubController(),
    float: stubFloat(),
    recorder: stubRecorder('idle'),
    recording,
    saveNotice: null,
    dismissSaveNotice: vi.fn(),
    handleSave: vi.fn(async () => {}),
    handleRetake: vi.fn(),
    handleDiscard: vi.fn(),
    reviewAudioUrl: null,
    handleReviewTimeUpdate: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('NarrationStage', () => {
  it('renders the surface, full control rail, and record slot from the handle', () => {
    render(<NarrationStage stage={stubHandle()} theme={DEFAULT_THEME} />);

    expect(document.querySelectorAll('[data-token-idx]').length).toBe(script.tokens.length);
    expect(screen.getByTestId('teleprompter-controls')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start prompter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restart prompter' })).toBeTruthy();
    expect(screen.getByText('🎙 Voice pace')).toBeTruthy();
    expect(screen.getByText('⇋ Mirror')).toBeTruthy();
    expect(screen.getByText('⇱ Pop out')).toBeTruthy();
    // Record slot (recording deps present, idle state) with its camera toggle.
    expect(screen.getByTestId('teleprompter-record')).toBeTruthy();
    expect(screen.getByText('camera')).toBeTruthy();
  });

  it('hides the record slot entirely without recording deps', () => {
    render(<NarrationStage stage={stubHandle({ recording: null })} theme={DEFAULT_THEME} />);
    expect(screen.queryByTestId('teleprompter-record')).toBeNull();
  });

  it('showCameraToggleInRecordSlot={false} hides the slot camera checkbox only', () => {
    render(
      <NarrationStage
        stage={stubHandle()}
        theme={DEFAULT_THEME}
        showCameraToggleInRecordSlot={false}
      />,
    );
    expect(screen.getByTestId('teleprompter-record')).toBeTruthy();
    expect(screen.queryByText('camera')).toBeNull();
  });

  it('showRecordSlot/showTransportPlay={false} strip only the dialog-owned controls', () => {
    render(
      <NarrationStage
        stage={stubHandle()}
        theme={DEFAULT_THEME}
        showRecordSlot={false}
        showTransportPlay={false}
      />,
    );
    expect(screen.queryByTestId('teleprompter-record')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start prompter' })).toBeNull();
    // Restart, Countdown, and the rest of the rail survive.
    expect(screen.getByRole('button', { name: 'Restart prompter' })).toBeTruthy();
    expect(screen.getByLabelText('Countdown')).toBeTruthy();
    expect(screen.getByText('🎙 Voice pace')).toBeTruthy();
  });

  it('showSelfView={false} suppresses the camera corner overlay', () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const withStream = stubHandle();
    withStream.recorder = { ...stubRecorder('recording'), cameraStream: stream };

    const { rerender } = render(
      <NarrationStage stage={withStream} theme={DEFAULT_THEME} showSelfView={false} />,
    );
    expect(screen.queryByTestId('teleprompter-selfview')).toBeNull();

    rerender(<NarrationStage stage={withStream} theme={DEFAULT_THEME} />);
    expect(screen.getByTestId('teleprompter-selfview')).toBeTruthy();
  });

  it('renders the review bar with save/retake/discard from the handle', () => {
    const handle = stubHandle();
    handle.recorder = {
      ...stubRecorder('review'),
      take: {
        audioBlob: new Blob(['a']),
        audioMime: 'audio/webm',
        audioExt: '.webm',
        cameraBlob: null,
        cameraMime: null,
        cameraExt: null,
        durationSec: 4.2,
        cameraOffsetSec: undefined,
        trace: { samples: [] },
        alignment: null,
        script,
      },
    };
    render(<NarrationStage stage={handle} theme={DEFAULT_THEME} />);

    expect(screen.getByTestId('teleprompter-review')).toBeTruthy();
    expect(screen.getByRole('button', { name: '✓ Save narration' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '↺ Retake' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '✕ Discard' })).toBeTruthy();
  });

  it('showReviewActions={false} keeps the take info but drops the buttons', () => {
    const handle = stubHandle();
    handle.recorder = {
      ...stubRecorder('review'),
      take: {
        audioBlob: new Blob(['a']),
        audioMime: 'audio/webm',
        audioExt: '.webm',
        cameraBlob: null,
        cameraMime: null,
        cameraExt: null,
        durationSec: 4.2,
        cameraOffsetSec: undefined,
        trace: { samples: [] },
        alignment: null,
        script,
      },
    };
    render(<NarrationStage stage={handle} theme={DEFAULT_THEME} showReviewActions={false} />);

    // The bar (take info + prompter-scrubbing playback) survives for hosts
    // that render Save/Retake in their own action row.
    expect(screen.getByTestId('teleprompter-review')).toBeTruthy();
    expect(screen.getByText(/Take: 4\.2s/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '✓ Save narration' })).toBeNull();
    expect(screen.queryByRole('button', { name: '↺ Retake' })).toBeNull();
    expect(screen.queryByRole('button', { name: '✕ Discard' })).toBeNull();
  });
});
