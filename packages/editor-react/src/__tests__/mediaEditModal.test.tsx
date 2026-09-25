/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type {
  MediaEditRenderManager,
  MediaEditRenderStatus,
} from '@bendyline/squisq-video-react/media-edit';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { MediaEditButton } from '../mediaEdit/MediaEditButton';
import { MediaEditModal } from '../mediaEdit/MediaEditModal';
import {
  findEditableMedia,
  groupCompanions,
  listEditableMedia,
  mediaTargetFromAnnotationText,
  mediaTargetFromElement,
} from '../mediaEdit/mediaEditTargets';

afterEach(cleanup);

function fakeManager(overrides: Partial<MediaEditRenderManager> = {}): MediaEditRenderManager {
  return {
    renderer: {
      render: vi.fn(),
      analyze: vi.fn(),
      pauses: vi.fn(async () => ({ cuts: [{ start: 2, end: 3.5 }], durationSec: 10 })),
      preview: vi.fn(async () => ({
        sampleRate: 48000,
        startSec: 0,
        original: [new Float32Array(10)],
        processed: [new Float32Array(10)],
      })),
      dispose: vi.fn(),
    },
    sync: vi.fn(),
    processedAudio: () => undefined,
    status: () => null,
    whenReady: vi.fn(async () => {}),
    retry: vi.fn(),
    loadSource: vi.fn(async () => new Blob(['x'])),
    collectGarbage: vi.fn(async () => []),
    subscribe: () => () => {},
    getVersion: () => 0,
    getIndexVersion: () => 0,
    dispose: vi.fn(),
    ...overrides,
  };
}

function SourceProbe() {
  const { markdownSource } = useEditorContext();
  return <pre data-testid="source">{markdownSource}</pre>;
}

async function openModal(
  markdown: string,
  manager: MediaEditRenderManager,
  src = 'audio/take.webm',
) {
  const onClose = vi.fn();
  render(
    <EditorProvider initialMarkdown={markdown} mediaEditRenders={manager}>
      <SourceProbe />
      <MediaEditModal
        target={{ src, kind: src.startsWith('video/') ? 'video' : 'audio' }}
        onClose={onClose}
      />
    </EditorProvider>,
  );
  await screen.findByRole('checkbox', { name: 'Loudness' });
  return { onClose, source: () => screen.getByTestId('source').textContent ?? '' };
}

describe('MediaEditModal', () => {
  it('applies the "Clean up voice" preset to the clip as one source edit', async () => {
    const markdown = '{[audio src=audio/take.webm anchor=document]}\n\n# One\n\nBody.\n';
    const { onClose, source } = await openModal(markdown, fakeManager());
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Clean up voice' }));
    expect(screen.getByRole('checkbox', { name: 'Noise reduction' })).toHaveProperty(
      'checked',
      true,
    );
    fireEvent.click(apply);
    await waitFor(() =>
      expect(source().split('\n')[0]).toBe(
        '{[audio src=audio/take.webm anchor=document fx="highpass:80 denoise:0.8 debreath:-15 loudness:-16"]}',
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('starts from the saved recipe and removes it with "None"', async () => {
    const markdown =
      '{[audio src=audio/take.webm anchor=document fx="loudness:-14" gain=-2]}\n\n# One\n';
    const { source } = await openModal(markdown, fakeManager());
    expect(screen.getByRole('checkbox', { name: 'Loudness' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: 'Noise reduction' })).toHaveProperty(
      'checked',
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(source().split('\n')[0]).toBe('{[audio src=audio/take.webm anchor=document gain=-2]}'),
    );
  });

  it('propagates the recipe to grouped companion clips', async () => {
    const markdown =
      '# One\n\n' +
      '<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-group="rec-a"></video>\n\n' +
      '<video src="video/camera.webm" data-squisq-video-placement="picture-in-picture" data-squisq-video-lock-to-block="false" data-squisq-video-group="rec-a"></video>\n';
    const { source } = await openModal(markdown, fakeManager(), 'video/screen.webm');
    expect(screen.getByText(/also apply to 1 linked clip/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Levels only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const lines = source().split('\n');
      expect(lines[2]).toContain('data-squisq-video-fx="loudness:-16"');
      expect(lines[4]).toContain('data-squisq-video-fx="loudness:-16"');
    });
  });

  it('renders a preview window through the manager', async () => {
    const manager = fakeManager();
    await openModal('{[audio src=audio/take.webm anchor=document]}\n\n# One\n', manager);
    fireEvent.click(screen.getByRole('button', { name: 'Levels only' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
    });
    expect(manager.loadSource).toHaveBeenCalledWith('audio/take.webm');
    expect(manager.renderer.preview).toHaveBeenCalledWith(
      expect.objectContaining({ fx: 'loudness:-16', startSec: 0, endSec: 10 }),
      expect.anything(),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Processed' })).toHaveProperty('disabled', false),
    );
  });

  it('follows and seeks the playhead across the preview window', async () => {
    /** Just enough Web Audio for the A/B player; `currentTime` is the test's clock. */
    class FakeAudioContext {
      static latest: FakeAudioContext;
      currentTime = 0;
      destination = {};
      starts: number[] = [];
      constructor() {
        FakeAudioContext.latest = this;
      }
      createBuffer(channels: number, length: number) {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return { getChannelData: (c: number) => data[c] };
      }
      createBufferSource() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          stop: vi.fn(),
          start: (_when: number, offset: number) => this.starts.push(offset),
        };
      }
      close() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    try {
      // A 10 s window at 12 s into the clip (10 Hz keeps the buffers tiny).
      const manager = fakeManager();
      vi.mocked(manager.renderer.preview).mockResolvedValue({
        sampleRate: 10,
        startSec: 12,
        original: [new Float32Array(100)],
        processed: [new Float32Array(100)],
      });
      await openModal('{[audio src=audio/take.webm anchor=document]}\n\n# One\n', manager);
      fireEvent.click(screen.getByRole('button', { name: 'Levels only' }));
      // No transport until there is something to play.
      expect(screen.queryByRole('slider', { name: 'Playback position' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Original' })).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Create preview' }));
      });
      const bar = await screen.findByRole('slider', { name: 'Playback position' });
      expect(screen.getByText('Stopped')).toBeTruthy();
      expect(screen.getByText('0:00 / 0:10')).toBeTruthy();
      // The transport sits beneath the bar.
      const original = screen.getByRole('button', { name: 'Original' });
      expect(bar.compareDocumentPosition(original) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Original' }));
      const ctx = FakeAudioContext.latest;
      const last = () => ctx.starts[ctx.starts.length - 1];
      expect(screen.getByText('Original from 12 s')).toBeTruthy();
      ctx.currentTime = 3.2;
      await waitFor(() => expect(Number((bar as HTMLInputElement).value)).toBeCloseTo(3.2));
      expect(bar.getAttribute('aria-valuetext')).toBe('0:03 of 0:10');

      // Switching sides restarts at the cue point (the window start)…
      fireEvent.click(screen.getByRole('button', { name: 'Processed' }));
      expect(ctx.starts).toEqual([0, 0]);
      expect(screen.getByText('Processed from 12 s')).toBeTruthy();
      expect(Number((bar as HTMLInputElement).value)).toBe(0);

      // …and dropping the playhead moves the cue: playback resumes there, and
      // the other side starts there too.
      fireEvent.change(bar, { target: { value: '6' } });
      expect(last()).toBe(6);
      ctx.currentTime = 5.2;
      fireEvent.click(screen.getByRole('button', { name: 'Original' }));
      expect(last()).toBe(6);

      // Stop returns to the window start.
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
      expect(Number((bar as HTMLInputElement).value)).toBe(0);
      expect(screen.getByText('Stopped')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Processed' }));
      expect(last()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows a failed render with a retry', async () => {
    const manager = fakeManager({
      status: () => ({ key: 'k', state: 'failed', error: 'no audio track' }),
    });
    await openModal(
      '{[audio src=audio/take.webm anchor=document fx=loudness]}\n\n# One\n',
      manager,
    );
    expect(screen.getByText(/Processing failed: no audio track/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(manager.retry).toHaveBeenCalled();
  });

  it('shows the render status in the title bar and beside the footer actions', async () => {
    const manager = fakeManager({
      status: () => ({ key: 'k', state: 'rendering', progress: 0.39 }),
    });
    await openModal(
      '{[audio src=audio/take.webm anchor=document fx=loudness]}\n\n# One\n',
      manager,
    );
    const dialog = screen.getByRole('dialog');
    const header = dialog.querySelector('header')!;
    const footer = dialog.querySelector('footer')!;
    expect(within(header).getByText('Processing 39%')).toBeTruthy();
    const status = within(footer).getByRole('status');
    expect(status.textContent).toBe('Processing… 39%');
    expect(status.nextElementSibling).toBe(within(footer).getByRole('button', { name: 'Cancel' }));
  });

  it('shows no render status without a saved cleanup recipe', async () => {
    const manager = fakeManager({
      status: () => ({ key: 'k', state: 'rendering', progress: 0.5 }),
    });
    await openModal('{[audio src=audio/take.webm anchor=document gain=-2]}\n\n# One\n', manager);
    expect(screen.queryByText(/Processing/)).toBeNull();
  });
});

describe('media edit targets', () => {
  const md =
    '{[audio src=audio/take.webm anchor=document group=g1]}\n\n# One\n\n' +
    '<video src="video/a.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-group="g1"></video>\n\n' +
    '<audio src="audio/note.webm" controls></audio>\n';
  const doc = markdownToDoc(parseMarkdown(md));

  it('lists each authoring line once, in source order', () => {
    expect(listEditableMedia(doc).map((m) => [m.sourceLine, m.src])).toEqual([
      [1, 'audio/take.webm'],
      [5, 'video/a.webm'],
      [7, 'audio/note.webm'],
    ]);
  });

  it('finds a clip by line, falling back to src, and its group', () => {
    const byLine = findEditableMedia(doc, { src: '', kind: 'audio', sourceLine: 7 });
    expect(byLine?.src).toBe('audio/note.webm');
    const bySrc = findEditableMedia(doc, { src: 'video/a.webm', kind: 'video' });
    expect(bySrc?.sourceLine).toBe(5);
    expect(groupCompanions(doc, bySrc!).map((m) => m.src)).toEqual(['audio/take.webm']);
  });

  it('does not offer a markdown link to a media file (it cannot carry a recipe)', () => {
    const linked = markdownToDoc(parseMarkdown('# One\n\n[take](audio/take.webm)\n'));
    expect(listEditableMedia(linked)).toEqual([]);
  });

  it('reads targets from annotation text and media node views', () => {
    expect(mediaTargetFromAnnotationText('{[audio src="a b.webm" anchor=document]}')).toEqual({
      src: 'a b.webm',
      kind: 'audio',
    });
    expect(mediaTargetFromAnnotationText('Just text')).toBeNull();
    const node = document.createElement('div');
    node.dataset.squisqMediaSrc = 'video/a.webm';
    node.dataset.squisqMediaKind = 'video';
    const child = document.createElement('span');
    node.appendChild(child);
    expect(mediaTargetFromElement(child)).toEqual({ src: 'video/a.webm', kind: 'video' });
  });
});

describe('MediaEditModal — timing', () => {
  it('shortens pauses with proposed cuts and writes volume and fades', async () => {
    const manager = fakeManager();
    const { source } = await openModal(
      '{[audio src=audio/take.webm anchor=document]}\n\n# One\n',
      manager,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Timing' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find pauses' }));
    });
    expect(manager.renderer.pauses).toHaveBeenCalledWith(
      expect.objectContaining({ options: { maxPauseSec: 0.8, keepSec: 0.4 } }),
      expect.anything(),
    );
    await screen.findByText('1 pause shortened, saving 0:02.');
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '-3' } });
    fireEvent.change(screen.getByLabelText('Fade in'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(source().split('\n')[0]).toBe(
        '{[audio src=audio/take.webm anchor=document cuts=2-3.5 gain=-3 fadeIn=0.5]}',
      ),
    );
  });

  it('carries cuts to a companion in its own source time, keeping its own gain', async () => {
    const markdown =
      '# One\n\n' +
      '<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-group="rec-a"></video>\n\n' +
      '<video src="video/camera.webm" data-squisq-video-placement="picture-in-picture" data-squisq-video-lock-to-block="false" data-squisq-video-clip-start="0.5" data-squisq-video-gain="-6" data-squisq-video-group="rec-a"></video>\n';
    const { source } = await openModal(markdown, fakeManager(), 'video/screen.webm');
    expect(screen.getByText('Edit clip')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Timing' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find pauses' }));
    });
    await screen.findByText('1 pause shortened, saving 0:02.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const lines = source().split('\n');
      expect(lines[2]).toContain('data-squisq-video-cuts="2-3.5"');
      // Camera started 0.5 s into its own file: the same moment is 2.5–4 there.
      expect(lines[4]).toContain('data-squisq-video-cuts="2.5-4"');
      expect(lines[4]).toContain('data-squisq-video-gain="-6"');
    });
  });
});

describe('MediaEditModal — frame', () => {
  it('crops a video with the keyboard and writes the crop', async () => {
    const markdown =
      '# One\n\n<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>\n';
    const { source } = await openModal(markdown, fakeManager(), 'video/screen.webm');
    fireEvent.click(screen.getByRole('tab', { name: 'Frame' }));
    const rect = screen.getByRole('slider', { name: 'Crop area' });
    // Shrink by 10% each way, then move 5% right.
    for (let i = 0; i < 10; i++) fireEvent.keyDown(rect, { key: 'ArrowLeft', shiftKey: true });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(rect, { key: 'ArrowUp', shiftKey: true });
    for (let i = 0; i < 5; i++) fireEvent.keyDown(rect, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(source().split('\n')[2]).toContain('data-squisq-video-crop="0.05 0 0.9 0.9"'),
    );
  });

  it('offers no frame tab or controls for audio', async () => {
    await openModal('{[audio src=audio/take.webm anchor=document]}\n\n# One\n', fakeManager());
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Audio cleanup',
      'Timing',
    ]);
    expect(screen.queryByRole('slider', { name: 'Crop area', hidden: true })).toBeNull();
  });
});

describe('MediaEditModal — tabs', () => {
  const video =
    '# One\n\n<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>\n';

  it('opens on audio cleanup and shows one panel at a time', async () => {
    await openModal(video, fakeManager(), 'video/screen.webm');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Audio cleanup', 'Timing', 'Frame']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Audio cleanup' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Find pauses' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Timing' }));
    expect(screen.getByRole('tabpanel', { name: 'Timing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find pauses' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Loudness' })).toBeNull();
  });

  it('moves between tabs with the arrow, Home and End keys', async () => {
    await openModal(video, fakeManager(), 'video/screen.webm');
    const audio = screen.getByRole('tab', { name: 'Audio cleanup' });
    expect(audio.tabIndex).toBe(0);
    fireEvent.keyDown(audio, { key: 'ArrowRight' });
    const timing = screen.getByRole('tab', { name: 'Timing' });
    expect(timing.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(timing);
    expect(audio.tabIndex).toBe(-1);
    fireEvent.keyDown(timing, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Frame' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(audio);
    fireEvent.keyDown(audio, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Frame' }).getAttribute('aria-selected')).toBe('true');
  });

  it('flags the tabs whose settings would be written', async () => {
    await openModal(
      '# One\n\n<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-gain="-3"></video>\n',
      fakeManager(),
      'video/screen.webm',
    );
    const edited = () =>
      screen
        .getAllByRole('tab')
        .filter((tab) => tab.dataset.edited === 'true')
        .map((tab) => tab.firstChild?.textContent);
    expect(edited()).toEqual(['Timing']);
    expect(screen.getByRole('tab', { name: 'Timing (edited)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Levels only' }));
    expect(edited()).toEqual(['Audio cleanup', 'Timing']);
  });

  it('keeps each tab’s settings when switching away and back', async () => {
    const { source } = await openModal(video, fakeManager(), 'video/screen.webm');
    fireEvent.click(screen.getByRole('button', { name: 'Levels only' }));
    fireEvent.click(screen.getByRole('tab', { name: /Timing/ }));
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('tab', { name: /Audio cleanup/ }));
    expect(screen.getByRole('checkbox', { name: 'Loudness' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const line = source().split('\n')[2];
      expect(line).toContain('data-squisq-video-fx="loudness:-16"');
      expect(line).toContain('data-squisq-video-gain="-3"');
    });
  });
});

describe('MediaEditButton', () => {
  /** A manager whose status can change after mount, notifying subscribers. */
  function liveManager(initial: MediaEditRenderStatus | null) {
    let current = initial;
    let version = 0;
    const listeners = new Set<() => void>();
    const manager = fakeManager({
      status: vi.fn(() => current),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getVersion: () => version,
    });
    const setStatus = (next: MediaEditRenderStatus | null) =>
      act(() => {
        current = next;
        version++;
        listeners.forEach((listener) => listener());
      });
    return { manager, setStatus };
  }

  function renderButton(manager: MediaEditRenderManager, fx: string | null = 'loudness:-16') {
    render(
      <EditorProvider initialMarkdown="# One\n" mediaEditRenders={manager}>
        <MediaEditButton src="video/a.webm" kind="video" fx={fx} />
      </EditorProvider>,
    );
    return screen.getByRole('button', { name: /^Edit clip/ });
  }

  it('shows a spinner and the progress while the recipe renders', () => {
    const { manager, setStatus } = liveManager({ key: 'k', state: 'rendering', progress: 0.39 });
    const button = renderButton(manager);
    expect(manager.status).toHaveBeenCalledWith(
      expect.objectContaining({
        src: 'video/a.webm',
        edits: { fx: { ops: [{ id: 'loudness', value: -16 }], unknown: [] } },
      }),
    );
    expect(button.dataset.processing).toBe('true');
    expect(button.querySelector('.squisq-media-edit-button__spinner')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Edit clip ?, processing 39%$/ })).toBe(button);

    setStatus({ key: 'k', state: 'rendering', progress: 0.72 });
    expect(button.querySelector('.squisq-media-edit-button__progress')?.textContent).toContain(
      '72%',
    );

    setStatus({ key: 'k', state: 'ready' });
    expect(button.dataset.processing).toBeUndefined();
    expect(button.querySelector('.squisq-media-edit-button__spinner')).toBeNull();
    expect(button.textContent).toBe('Edit clip');
    expect(button.dataset.edited).toBe('true');
  });

  it('shows no progress while queued, failed, or without a recipe', () => {
    const { manager, setStatus } = liveManager({ key: 'k', state: 'queued' });
    const button = renderButton(manager);
    expect(button.dataset.processing).toBeUndefined();
    setStatus({ key: 'k', state: 'failed', error: 'no audio track' });
    expect(button.dataset.processing).toBeUndefined();
    cleanup();

    const bare = liveManager({ key: 'k', state: 'rendering', progress: 0.5 });
    const plain = renderButton(bare.manager, null);
    expect(plain.dataset.processing).toBeUndefined();
    expect(bare.manager.status).not.toHaveBeenCalled();
  });
});
