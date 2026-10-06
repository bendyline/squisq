/** @vitest-environment jsdom */

/**
 * Dictation end to end through `EditorProvider` + the toolbar button, with a
 * FAKE provider injected via `speechInput` (the designed seam), a fake
 * MediaRecorder/getUserMedia, and a 16 kHz decode stub. Pins: no capability →
 * no button and a null `dictation`; `unavailable` → nothing; download-required
 * → `requestSetup` instead of the microphone; a full session (preparing →
 * listening → transcribing → idle) that inserts the transcript into a real
 * Tiptap editor and hands the provider 16 kHz WAV; mic denial → a clear
 * message; the context control and Esc; factory-vs-instance disposal; and the
 * Source view inserting through Monaco.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../../EditorContext';
import type { EditorView } from '../../EditorContext';
import { markdownToTiptap } from '../../tiptapBridge';
import { DictationButton } from '../DictationButton';
import { DictationExtension } from '../DictationExtension';
import type {
  SpeechInputProvider,
  SpeechInputReadiness,
  SpeechInputTranscribeOptions,
} from '../types';
// Warm the lazily-imported session module so its dynamic import resolves promptly.
import '../dictationSession';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly mimeType: string;
  constructor(_stream: FakeStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['take'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

class FakeOfflineAudioContext {
  async decodeAudioData(): Promise<AudioBuffer> {
    const samples = new Float32Array(1600);
    return {
      numberOfChannels: 1,
      sampleRate: 16_000,
      length: samples.length,
      duration: 0.1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;
  }
}

let streams: FakeStream[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  streams = [];
  getUserMedia = vi.fn(async () => {
    const stream = new FakeStream();
    streams.push(stream);
    return stream;
  });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FakeProvider extends SpeechInputProvider {
  readiness: SpeechInputReadiness;
  transcribeCalls: { wav: ArrayBuffer; options: SpeechInputTranscribeOptions }[];
  prepareCalls: AbortSignal[];
  requestSetup: Mock<() => void>;
  dispose: Mock<() => void>;
  nextText: string;
  push?: (readiness: SpeechInputReadiness) => void;
}

function makeProvider(readiness: SpeechInputReadiness = { state: 'ready' }): FakeProvider {
  const provider: FakeProvider = {
    id: 'fake',
    label: 'Fake speech',
    readiness,
    transcribeCalls: [],
    prepareCalls: [],
    nextText: 'hello world',
    requestSetup: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
    async status() {
      return provider.readiness;
    },
    onStatus(listener) {
      provider.push = listener;
      return () => {
        provider.push = undefined;
      };
    },
    async prepare(signal) {
      provider.prepareCalls.push(signal);
    },
    async transcribe(wav, options) {
      provider.transcribeCalls.push({ wav, options });
      return { text: provider.nextText };
    },
  };
  return provider;
}

let tiptap: Editor | null = null;
let ctx: EditorContextValue | null = null;

function TiptapHarness(): null {
  const context = useEditorContext();
  ctx = context;
  const { setTiptapEditor, markdownSource } = context;
  useEffect(() => {
    const editor = new Editor({
      extensions: [StarterKit, DictationExtension],
      content: markdownToTiptap(markdownSource),
    });
    // Caret at the end of the first paragraph.
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    tiptap = editor;
    setTiptapEditor(editor);
    return () => {
      setTiptapEditor(null);
      editor.destroy();
      tiptap = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Probe(): null {
  ctx = useEditorContext();
  return null;
}

function mount(
  speechInput: SpeechInputProvider | (() => SpeechInputProvider) | null,
  options: { view?: EditorView; harness?: boolean } = {},
) {
  return render(
    <EditorProvider
      initialMarkdown={'Some text\n'}
      initialView={options.view ?? 'wysiwyg'}
      speechInput={speechInput}
    >
      {options.harness === false ? <Probe /> : <TiptapHarness />}
      <DictationButton />
    </EditorProvider>,
  );
}

function micButton(): HTMLButtonElement {
  return screen.getByTestId('squisq-dictation-button') as HTMLButtonElement;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('DictationButton', () => {
  it('renders nothing, and exposes no control, without a capability', async () => {
    mount(null);
    await settle();
    expect(screen.queryByTestId('squisq-dictation-button')).toBeNull();
    expect(ctx?.dictation).toBeNull();
  });

  it('renders nothing while the provider is unavailable', async () => {
    mount(makeProvider({ state: 'unavailable', reason: 'no engine' }));
    await settle();
    expect(screen.queryByTestId('squisq-dictation-button')).toBeNull();
    expect(ctx?.dictation).toMatchObject({ active: false, available: false });
  });

  it('appears when a pushed readiness makes dictation available', async () => {
    const provider = makeProvider({ state: 'unavailable' });
    mount(provider);
    await settle();
    expect(screen.queryByTestId('squisq-dictation-button')).toBeNull();
    act(() => provider.push?.({ state: 'ready' }));
    expect(micButton().getAttribute('aria-label')).toBe('Start dictation');
  });

  it('asks the host to set up instead of opening the microphone when a download is required', async () => {
    const provider = makeProvider({ state: 'download-required', reason: 'model missing' });
    mount(provider);
    await settle();
    const button = micButton();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('data-tooltip')).toContain('model missing');
    fireEvent.click(button);
    await settle();
    expect(provider.requestSetup).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('re-reads readiness after requestSetup, so a finished download starts on the next click', async () => {
    const provider = makeProvider({ state: 'download-required' });
    provider.onStatus = undefined; // a provider that never pushes
    mount(provider);
    await settle();
    provider.readiness = { state: 'ready' }; // setup finished out of band
    fireEvent.click(micButton());
    await settle();
    expect(provider.requestSetup).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(micButton());
    await waitFor(() => expect(micButton().getAttribute('data-state')).toBe('listening'));
    fireEvent.click(micButton());
    await waitFor(() => expect(micButton().getAttribute('data-state')).toBe('idle'));
    expect(provider.requestSetup).toHaveBeenCalledTimes(1);
  });

  it('runs a full session and inserts the transcript as literal text', async () => {
    const provider = makeProvider();
    provider.nextText = ' hello *world* ';
    mount(provider);
    await settle();
    expect(micButton().getAttribute('aria-label')).toBe('Start dictation');

    fireEvent.click(micButton());
    await waitFor(() => expect(micButton().getAttribute('data-state')).toBe('listening'));
    expect(micButton().getAttribute('aria-pressed')).toBe('true');
    expect(micButton().getAttribute('aria-label')).toBe('Stop dictation');
    expect(screen.getByTestId('squisq-dictation-meter')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Dictation on. Listening.');
    expect(provider.prepareCalls).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }),
      video: false,
    });
    expect(tiptap?.view.dom.querySelector('.squisq-dictation-interim')?.textContent).toBe(
      'Listening…',
    );
    expect(ctx?.dictation?.active).toBe(true);

    // Stop: the captured take is transcribed and inserted, then idle.
    fireEvent.click(micButton());
    await waitFor(() => expect(micButton().getAttribute('data-state')).toBe('idle'));
    expect(provider.transcribeCalls).toHaveLength(1);
    const view = new DataView(provider.transcribeCalls[0].wav);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(provider.transcribeCalls[0].options.signal).toBeInstanceOf(AbortSignal);
    expect(tiptap?.state.doc.textContent).toBe('Some text hello *world*');
    expect(tiptap?.state.doc.child(0).firstChild?.marks).toEqual([]);
    expect(tiptap?.view.dom.querySelector('.squisq-dictation-interim')).toBeNull();
    expect(streams[0].tracks[0].readyState).toBe('ended');
    expect(provider.prepareCalls[0].aborted).toBe(true);
    expect(ctx?.dictation?.active).toBe(false);
  });

  it('explains a denied microphone and returns to idle', async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
    );
    mount(makeProvider());
    await settle();
    fireEvent.click(micButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Microphone access was not granted');
    expect(micButton().getAttribute('data-state')).toBe('idle');
    fireEvent.click(screen.getByLabelText('Dismiss dictation message'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a provider prepare failure', async () => {
    const provider = makeProvider();
    provider.prepare = async () => {
      throw new Error('model failed to load');
    };
    mount(provider);
    await settle();
    fireEvent.click(micButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('model failed to load');
    await waitFor(() => expect(micButton().getAttribute('data-state')).toBe('idle'));
    expect(streams[0].tracks[0].readyState).toBe('ended');
  });

  it('is driven by the context control, and Esc stops it', async () => {
    const provider = makeProvider();
    mount(provider);
    await settle();
    expect(ctx?.dictation).toMatchObject({ active: false, available: true });
    act(() => ctx?.dictation?.toggle());
    await waitFor(() => expect(ctx?.dictation?.active).toBe(true));
    await waitFor(() => expect(micButton().getAttribute('data-state')).toBe('listening'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(ctx?.dictation?.active).toBe(false));
    expect(provider.transcribeCalls).toHaveLength(1);
  });

  it('is unavailable outside the text views', async () => {
    mount(makeProvider());
    await settle();
    act(() => ctx?.setActiveView('preview'));
    expect(ctx?.dictation?.available).toBe(false);
    expect(screen.queryByTestId('squisq-dictation-button')).toBeNull();
  });

  it('disposes a provider it created from a factory, never a host instance', async () => {
    const owned = makeProvider();
    const factory = vi.fn(() => owned);
    const first = mount(factory);
    await settle();
    expect(factory).toHaveBeenCalledTimes(1);
    first.unmount();
    expect(owned.dispose).toHaveBeenCalledTimes(1);

    const hostOwned = makeProvider();
    const second = mount(hostOwned);
    await settle();
    second.unmount();
    expect(hostOwned.dispose).not.toHaveBeenCalled();
  });

  it('inserts through Monaco in the Source view, then hands focus back', async () => {
    const calls: string[] = [];
    const edits: { text: string }[] = [];
    const focus = vi.fn();
    const fakeMonaco = {
      getModel: () => ({ getLineContent: () => 'Some text' }),
      getSelection: () => ({ endLineNumber: 1, endColumn: 10 }),
      getPosition: () => ({ lineNumber: 1, column: 10 }),
      setPosition: () => undefined,
      pushUndoStop: () => calls.push('undo-stop'),
      executeEdits: (_source: string, ops: { text: string }[]) => {
        calls.push('edit');
        edits.push(...ops);
        return true;
      },
      revealPositionInCenterIfOutsideViewport: () => undefined,
      hasTextFocus: () => true,
      focus,
      createDecorationsCollection: () => ({ set: () => undefined, clear: () => undefined }),
      onDidChangeCursorSelection: () => ({ dispose: () => undefined }),
    } as unknown as Parameters<EditorContextValue['setMonacoEditor']>[0];

    const provider = makeProvider();
    provider.nextText = 'from source';
    mount(provider, { view: 'raw', harness: false });
    await settle();
    act(() => ctx?.setMonacoEditor(fakeMonaco));
    fireEvent.click(micButton());
    await waitFor(() => expect(micButton().getAttribute('data-state')).toBe('listening'));
    fireEvent.click(micButton());
    await waitFor(() => expect(micButton().getAttribute('data-state')).toBe('idle'));
    expect(calls).toEqual(['undo-stop', 'edit', 'undo-stop']);
    expect(edits[0].text).toBe(' from source');
    // The session ended with focus on the page, so it returns to Monaco.
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
