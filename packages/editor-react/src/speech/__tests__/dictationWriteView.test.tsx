/** @vitest-environment jsdom */

/**
 * Dictation through the REAL Write view: `EditorProvider` + `WysiwygEditor`
 * (the full extension set, the markdown sync back into the context) + the
 * toolbar button, with a fake MediaRecorder and a provider that — like a
 * looping test microphone — transcribes every take to the same phrase.
 *
 * Pins, end to end: a continuous session (phrases during listening AND the one
 * finished after Stop) leaves exactly one undo step per phrase, with no
 * invisible step in between, and the markdown source follows each undo; when
 * a session ends, focus returns to the editor with the caret after the last
 * phrase — but never from another input the author moved to.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { undoDepth } from '@tiptap/pm/history';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../../EditorContext';
import { WysiwygEditor } from '../../WysiwygEditor';
import { DictationButton } from '../DictationButton';
import { DEFAULT_LONG_PAUSE_MS, DEFAULT_SEGMENT_MS } from '../progressiveSpeechToText';
import type { SpeechInputProvider } from '../types';
// Warm the lazily-imported session module so its dynamic import resolves promptly.
import '../dictationSession';

const PHRASE = 'Dictated by voice.';
const DOCUMENT = '# Field notes\n\nThe first paragraph is already here.\n';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  // ProseMirror measures ranges when it scrolls a focused selection into view.
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects ??= () => [];
  range.getBoundingClientRect ??= () => ({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  });
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
  readonly mimeType = 'audio/webm';
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

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
  // Tiptap focuses on the next frame; run frames on the (fake) timer queue.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0),
  );
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => new FakeStream() },
  });
  // Fake the clocks the take timer and ProseMirror's history grouping read;
  // leave microtasks and setImmediate real so promise chains still settle.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let ctx: EditorContextValue | null = null;

function Probe(): null {
  ctx = useEditorContext();
  return null;
}

function provider(text: string): SpeechInputProvider {
  return {
    id: 'loop',
    label: 'Looping fake',
    status: async () => ({ state: 'ready' }),
    transcribe: async () => ({ text }),
  };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await new Promise((resolve) => setImmediate(resolve));
  });
}

async function settleUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await advance(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function micButton(): HTMLButtonElement {
  return screen.getByTestId('squisq-dictation-button') as HTMLButtonElement;
}

const buttonState = () => micButton().getAttribute('data-state');

function editor(): Editor {
  const instance = ctx?.tiptapEditor;
  if (!instance) throw new Error('Write view not mounted');
  return instance;
}

function phraseCount(text: string): number {
  return text.split(PHRASE).length - 1;
}

async function mountWriteView(speech: SpeechInputProvider, extra?: JSX.Element) {
  render(
    <EditorProvider initialMarkdown={DOCUMENT} initialView="wysiwyg" speechInput={speech}>
      <DictationButton />
      <WysiwygEditor />
      {extra}
      <Probe />
    </EditorProvider>,
  );
  await settleUntil(
    () => Boolean(ctx?.tiptapEditor) && screen.queryByTestId('squisq-dictation-button') !== null,
    'the Write view',
  );
  // As the DocBlocks repro does: end of the paragraph, Enter, pause.
  const ed = editor();
  const endOfParagraph = ed.state.doc.child(0).nodeSize + ed.state.doc.child(1).nodeSize - 1;
  act(() => {
    ed.commands.setTextSelection(endOfParagraph);
    ed.commands.splitBlock();
  });
  await advance(600);
}

/** Start dictation from a focused mic button, as a click would leave it. */
async function startFromButton(): Promise<void> {
  micButton().focus();
  fireEvent.click(micButton());
  await settleUntil(() => buttonState() === 'listening', 'listening');
}

describe('dictation in the real Write view', () => {
  it('leaves exactly one undo step per phrase, including the one finished after Stop', async () => {
    await mountWriteView(provider(PHRASE));
    const ed = editor();
    const depthBefore = undoDepth(ed.state);

    await startFromButton();
    await advance(DEFAULT_SEGMENT_MS); // take 1
    await settleUntil(() => phraseCount(ed.state.doc.textContent) === 1, 'phrase 1');
    await advance(DEFAULT_SEGMENT_MS); // take 2
    await settleUntil(() => phraseCount(ed.state.doc.textContent) === 2, 'phrase 2');

    micButton().focus(); // clicking Stop puts focus on the button
    fireEvent.click(micButton());
    await settleUntil(() => buttonState() === 'idle', 'idle');
    await settleUntil(() => phraseCount(ed.state.doc.textContent) === 3, 'phrase 3');

    const dictated = ed.state.doc.child(2).textContent;
    expect(dictated).toBe(`${PHRASE} ${PHRASE} ${PHRASE}`);
    expect(phraseCount(ctx?.markdownSource ?? '')).toBe(3);
    expect(undoDepth(ed.state)).toBe(depthBefore + 3);

    // Bug 2: focus is back in the editor, caret after the last phrase.
    await advance(20);
    expect(ed.view.hasFocus()).toBe(true);
    expect(ed.state.selection.from).toBe(ed.state.doc.content.size - 1);

    // Bug 1: no invisible step — every undo removes exactly one phrase, and
    // the markdown source follows.
    await advance(600);
    for (const remaining of [2, 1, 0]) {
      act(() => {
        ed.commands.undo();
      });
      await advance(20);
      expect(phraseCount(ed.state.doc.textContent)).toBe(remaining);
      expect(phraseCount(ctx?.markdownSource ?? '')).toBe(remaining);
    }
    // …and the next undo is the Enter, not something invisible.
    expect(ed.state.doc.childCount).toBe(3);
    act(() => {
      ed.commands.undo();
    });
    expect(ed.state.doc.childCount).toBe(2);
  });

  // These end sessions that inserted nothing, so only the end-of-session
  // focus restore — not a phrase insertion — can put focus back.
  it('returns focus to the editor when the Stop button ends a silent session', async () => {
    await mountWriteView(provider(''));
    const ed = editor();
    await startFromButton();
    micButton().focus();
    fireEvent.click(micButton());
    await settleUntil(() => buttonState() === 'idle', 'idle');
    await advance(20);
    expect(document.activeElement).not.toBe(micButton());
    expect(ed.view.hasFocus()).toBe(true);
  });

  it('returns focus to the editor when Esc stops dictation', async () => {
    await mountWriteView(provider(''));
    const ed = editor();
    await startFromButton();
    micButton().focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    await settleUntil(() => buttonState() === 'idle', 'idle');
    await advance(20);
    expect(ed.view.hasFocus()).toBe(true);
  });

  it('returns focus after a long silence ends the session on its own', async () => {
    await mountWriteView(provider(''));
    const ed = editor();
    await startFromButton();
    micButton().focus();
    const takes = Math.ceil(DEFAULT_LONG_PAUSE_MS / DEFAULT_SEGMENT_MS) + 1;
    for (let take = 0; take < takes && buttonState() !== 'idle'; take += 1) {
      await advance(DEFAULT_SEGMENT_MS);
    }
    await settleUntil(() => buttonState() === 'idle', 'auto-stop');
    expect(screen.getByRole('alert').textContent).toContain('No speech was detected');
    await advance(20);
    expect(ed.view.hasFocus()).toBe(true);
  });

  it('never takes focus back from another input the author moved to', async () => {
    await mountWriteView(
      provider(PHRASE),
      <input data-testid="elsewhere" aria-label="Elsewhere" />,
    );
    const ed = editor();
    await startFromButton();
    const elsewhere = screen.getByTestId('elsewhere');
    elsewhere.focus();
    act(() => ctx?.dictation?.toggle());
    await settleUntil(() => buttonState() === 'idle', 'idle');
    await advance(20);
    expect(document.activeElement).toBe(elsewhere);
    expect(ed.view.hasFocus()).toBe(false);
    // The phrase still landed in the document.
    expect(phraseCount(ed.state.doc.textContent)).toBe(1);
  });
});
