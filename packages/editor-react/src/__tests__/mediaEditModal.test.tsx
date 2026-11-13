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
      waveform: vi.fn(async () => ({
        peaks: new Float32Array(1000),
        peaksPerSec: 100,
        durationSec: 10,
      })),
      preview: vi.fn(async () => ({
        sampleRate: 48000,
        startSec: 0,
        original: [new Float32Array(10)],
        processed: [new Float32Array(10)],
      })),
      bake: vi.fn(),
      dispose: vi.fn(),
    },
    sync: vi.fn(),
    processedAudio: () => undefined,
    status: () => null,
    whenReady: vi.fn(async () => {}),
    retry: vi.fn(),
    loadSource: vi.fn(async () => new Blob(['x'])),
    bakedMedia: () => undefined,
    bake: vi.fn(async (_clip, options) => {
      options?.onProgress?.(1);
      return '.mediaEdits/take.0123456789ab.baked.m4a';
    }),
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
    // The status takes the slack to the left of the footer's three actions.
    expect(
      within(footer)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Save edited copy…', 'Cancel', 'Apply']);
    expect(status.nextElementSibling).toBe(
      within(footer).getByRole('button', { name: 'Save edited copy…' }),
    );
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

/** Open the Cuts tab and wait for the clip's length (read with the waveform). */
async function openCutsTab() {
  fireEvent.click(screen.getByRole('tab', { name: /^Cuts/ }));
  return screen.findByRole('group', { name: 'Clip timeline' });
}

describe('MediaEditModal — cuts', () => {
  const audio = '{[audio src=audio/take.webm anchor=document]}\n\n# One\n';

  it('reads the waveform only once the Cuts tab is opened', async () => {
    const manager = fakeManager();
    await openModal(audio, manager);
    expect(manager.renderer.waveform).not.toHaveBeenCalled();
    await openCutsTab();
    expect(manager.renderer.waveform).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No cuts yet.')).toBeTruthy();
    expect(screen.getByText('0:00.0 / 0:10.0')).toBeTruthy();
  });

  it('cuts a section marked at the playhead and writes it to the clip', async () => {
    const { source } = await openModal(audio, fakeManager());
    const timeline = await openCutsTab();
    const cut = screen.getByRole('button', { name: 'Cut selection' });
    expect(cut).toHaveProperty('disabled', true);

    // Playhead to 2 s, mark the start; on to 5 s, mark the end.
    fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Set start' }));
    expect(screen.getByTestId('media-edit-selection-text').textContent).toBe('From 0:02.0');
    expect(cut).toHaveProperty('disabled', true);
    for (let i = 0; i < 3; i++) fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Set end' }));
    expect(screen.getByTestId('media-edit-selection-text').textContent).toBe(
      '0:02.0 – 0:05.0 (3.0 s)',
    );

    fireEvent.click(cut);
    expect(screen.getAllByTestId('media-edit-cut')).toHaveLength(1);
    expect(screen.queryByTestId('media-edit-selection')).toBeNull();
    expect(
      screen.getByText('1 cut removes 3.0 s: the clip plays for 0:07 instead of 0:10.'),
    ).toBeTruthy();
    // The readout is in result time: the playhead sits on the join, 2 s in, of 7 s.
    expect(screen.getByText('0:02.0 / 0:07.0')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Cuts (edited)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(source().split('\n')[0]).toBe(
        '{[audio src=audio/take.webm anchor=document cuts=2-5]}',
      ),
    );
  });

  it('makes several cuts from the keyboard, merging the ones that overlap', async () => {
    const { source } = await openModal(audio, fakeManager());
    const timeline = await openCutsTab();
    const press = (key: string, times = 1) => {
      for (let i = 0; i < times; i++) fireEvent.keyDown(timeline, { key });
    };
    press('ArrowRight');
    press('i');
    press('ArrowRight', 2);
    press('o');
    press('x'); // 1–3
    press('ArrowRight', 5); // playhead 6
    press('i');
    press('ArrowRight', 2);
    press('o');
    press('Delete'); // 6–8
    expect(screen.getAllByTestId('media-edit-cut')).toHaveLength(2);
    // A third cut bridging the gap fuses all three.
    press('Home');
    press('ArrowRight', 2);
    press('[');
    press('ArrowRight', 5);
    press(']');
    press('x'); // 2–7
    expect(screen.getAllByTestId('media-edit-cut')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(source().split('\n')[0]).toContain('cuts=1-8'));
  });

  it('shows saved cuts when reopened, and adjusts, restores and undoes them', async () => {
    const { source } = await openModal(
      '{[audio src=audio/take.webm anchor=document cuts="2-3 6-8"]}\n\n# One\n',
      fakeManager(),
    );
    await openCutsTab();
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(screen.getAllByTestId('media-edit-cut')).toHaveLength(2);
    const rows = within(screen.getByRole('list', { name: 'Cuts' })).getAllByRole('listitem');
    expect(rows.map((row) => row.firstChild?.textContent)).toEqual([
      '0:02.0 – 0:03.0',
      '0:06.0 – 0:08.0',
    ]);
    // Opening the tab changes nothing.
    expect(apply).toHaveProperty('disabled', true);

    // Pull the first cut's end half a second later.
    const end = screen.getByRole('slider', { name: 'Cut 1 end' });
    expect(end.getAttribute('aria-valuetext')).toBe('0:03.0');
    for (let i = 0; i < 5; i++) fireEvent.keyDown(end, { key: 'ArrowRight' });
    expect(end.getAttribute('aria-valuetext')).toBe('0:03.5');
    // An edge stops at its neighbour instead of running into it.
    for (let i = 0; i < 6; i++) fireEvent.keyDown(end, { key: 'ArrowRight', shiftKey: true });
    expect(end.getAttribute('aria-valuenow')).toBe('5.99');
    for (let i = 0; i < 6; i++) fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true });
    expect(end.getAttribute('aria-valuenow')).toBe('2.05');

    fireEvent.click(screen.getByRole('button', { name: 'Restore cut 2' }));
    expect(screen.getAllByTestId('media-edit-cut')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getAllByTestId('media-edit-cut')).toHaveLength(2);

    // Undo all the way back: nothing left to apply.
    const undo = screen.getByRole('button', { name: 'Undo' });
    while (!(undo as HTMLButtonElement).disabled) fireEvent.click(undo);
    expect(screen.getByRole('slider', { name: 'Cut 1 end' }).getAttribute('aria-valuetext')).toBe(
      '0:03.0',
    );
    expect(apply).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Restore all' }));
    expect(screen.queryByTestId('media-edit-cut')).toBeNull();
    fireEvent.click(apply);
    await waitFor(() =>
      expect(source().split('\n')[0]).toBe('{[audio src=audio/take.webm anchor=document]}'),
    );
  });

  it('plays the result, skipping cuts, and previews one cut in context', async () => {
    await openModal(
      '{[audio src=audio/take.webm anchor=document cuts="0-2 6-8"]}\n\n# One\n',
      fakeManager(),
    );
    await openCutsTab();
    const media = document.querySelector('audio')!;
    const play = vi.spyOn(media, 'play');

    // The clip opens on a cut: the result starts after it.
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(media.currentTime).toBe(2);

    // "Original" plays through the cuts from where the playhead is.
    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    const timeline = screen.getByRole('group', { name: 'Clip timeline' });
    fireEvent.keyDown(timeline, { key: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(media.currentTime).toBe(0);
    expect(screen.getByText('0:00.0 / 0:10.0')).toBeTruthy();

    // Previewing a cut starts shortly before it, whatever the mode.
    fireEvent.click(screen.getByRole('button', { name: 'Preview cut 2' }));
    expect(media.currentTime).toBe(4.5);
    expect(play).toHaveBeenCalledTimes(3);
  });

  it('adds found pauses to the cuts already made', async () => {
    const manager = fakeManager();
    const { source } = await openModal(
      '{[audio src=audio/take.webm anchor=document cuts=7-8]}\n\n# One\n',
      manager,
    );
    await openCutsTab();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find pauses' }));
    });
    expect(manager.renderer.pauses).toHaveBeenCalledWith(
      expect.objectContaining({ options: { maxPauseSec: 0.8, keepSec: 0.4 } }),
      expect.anything(),
    );
    await screen.findByText('1 pause shortened.');
    expect(screen.getAllByTestId('media-edit-cut')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(source().split('\n')[0]).toBe(
        '{[audio src=audio/take.webm anchor=document cuts="2-3.5 7-8"]}',
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
    await openCutsTab();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find pauses' }));
    });
    await screen.findByText('1 pause shortened.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const lines = source().split('\n');
      expect(lines[2]).toContain('data-squisq-video-cuts="2-3.5"');
      // Camera started 0.5 s into its own file: the same moment is 2.5–4 there.
      expect(lines[4]).toContain('data-squisq-video-cuts="2.5-4"');
      expect(lines[4]).toContain('data-squisq-video-gain="-6"');
    });
  });

  it('keeps cuts inside a trimmed clip and labels them from its start', async () => {
    const markdown =
      '# One\n\n<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-clip-start="2" data-squisq-video-clip-end="8"></video>\n';
    const { source } = await openModal(markdown, fakeManager(), 'video/screen.webm');
    const timeline = await openCutsTab();
    expect(screen.getByText('0:00.0 / 0:06.0')).toBeTruthy();
    // One second into the clip is 3 s into the file.
    fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    fireEvent.keyDown(timeline, { key: 'i' });
    fireEvent.keyDown(timeline, { key: 'End' });
    fireEvent.keyDown(timeline, { key: 'o' });
    expect(screen.getByTestId('media-edit-selection-text').textContent).toBe(
      '0:01.0 – 0:06.0 (5.0 s)',
    );
    fireEvent.keyDown(timeline, { key: 'x' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(source().split('\n')[2]).toContain('data-squisq-video-cuts="3-8"'));
  });

  it('drops a selection on Escape before Escape closes the dialog', async () => {
    const { onClose } = await openModal(audio, fakeManager());
    const timeline = await openCutsTab();
    fireEvent.keyDown(timeline, { key: 'i' });
    expect(screen.getByTestId('media-edit-selection')).toBeTruthy();
    fireEvent.keyDown(timeline, { key: 'Escape' });
    expect(screen.queryByTestId('media-edit-selection')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(timeline, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('still cuts by time when the waveform cannot be read', async () => {
    const manager = fakeManager();
    vi.mocked(manager.renderer.waveform).mockRejectedValue(new Error('unsupported codec'));
    await openModal(audio, manager);
    fireEvent.click(screen.getByRole('tab', { name: /^Cuts/ }));
    await screen.findByText('This clip could not be read: unsupported codec');
    expect(screen.queryByRole('group', { name: 'Clip timeline' })).toBeNull();
    // The player knows the length even though the decoder failed.
    const media = document.querySelector('audio')!;
    Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
    fireEvent.durationChange(media);
    expect(await screen.findByRole('group', { name: 'Clip timeline' })).toBeTruthy();
    expect(
      screen.getByText('The waveform could not be read; cuts still work by time.'),
    ).toBeTruthy();
  });

  it('gives a silent recording its timeline from the length read out of the file', async () => {
    // A screen recording with no audio track: no waveform to draw, and (as a
    // recorder's WebM) no length the player can report either.
    const manager = fakeManager();
    vi.mocked(manager.renderer.waveform).mockResolvedValue({
      peaks: new Float32Array(0),
      peaksPerSec: 100,
      durationSec: 10,
    });
    const markdown =
      '# One\n\n<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>\n';
    const { source } = await openModal(markdown, manager, 'video/screen.webm');
    const timeline = await openCutsTab();
    expect(screen.getByText('0:00.0 / 0:10.0')).toBeTruthy();
    expect(screen.queryByText(/length/)).toBeNull();
    fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    fireEvent.keyDown(timeline, { key: 'i' });
    fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    fireEvent.keyDown(timeline, { key: 'o' });
    fireEvent.keyDown(timeline, { key: 'x' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(source().split('\n')[2]).toContain('data-squisq-video-cuts="1-2"'));
  });

  it('asks the player for the length when the file cannot be read at all', async () => {
    const manager = fakeManager();
    vi.mocked(manager.renderer.waveform).mockRejectedValue(new Error('unsupported container'));
    const markdown =
      '# One\n\n<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>\n';
    await openModal(markdown, manager, 'video/screen.webm');
    // A recording as the player first sees it: no length yet.
    const media = document.querySelector<HTMLVideoElement>('[role="tabpanel"] video')!;
    Object.defineProperty(media, 'duration', { configurable: true, value: Infinity });
    fireEvent.click(screen.getByRole('tab', { name: /^Cuts/ }));
    await screen.findByText('This clip could not be read: unsupported container');
    // Seeking far past the end makes the browser work the length out.
    await waitFor(() => expect(media.currentTime).toBe(1e101));
    Object.defineProperty(media, 'duration', { configurable: true, value: 10 });
    fireEvent.durationChange(media);
    expect(await screen.findByRole('group', { name: 'Clip timeline' })).toBeTruthy();
    expect(screen.getByText('0:00.0 / 0:10.0')).toBeTruthy();
  });
});

describe('MediaEditModal — size', () => {
  it('fills the app for a video clip and stays compact for audio', async () => {
    await openModal(
      '# One\n\n<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>\n',
      fakeManager(),
      'video/screen.webm',
    );
    expect(screen.getByRole('dialog').className).toContain(
      'squisq-media-edit-modal__surface--large',
    );
    cleanup();
    await openModal('{[audio src=audio/take.webm anchor=document]}\n\n# One\n', fakeManager());
    expect(screen.getByRole('dialog').className).not.toContain('--large');
  });
});

describe('MediaEditModal — save edited copy', () => {
  const audio = '{[audio src=audio/take.webm anchor=document]}\n\n# One\n';

  function renderWithSaver(
    markdown: string,
    manager: MediaEditRenderManager,
    saveMediaEditOutput: (blob: Blob, filename: string) => boolean | void,
  ) {
    render(
      <EditorProvider
        initialMarkdown={markdown}
        mediaEditRenders={manager}
        saveMediaEditOutput={saveMediaEditOutput}
      >
        <SourceProbe />
        <MediaEditModal target={{ src: 'audio/take.webm', kind: 'audio' }} onClose={vi.fn()} />
      </EditorProvider>,
    );
    return screen.findByRole('checkbox', { name: 'Loudness' });
  }

  it('has nothing to save for an unedited clip', async () => {
    await openModal(audio, fakeManager());
    expect(screen.getByRole('button', { name: 'Save edited copy…' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('bakes the recipe on screen, applied or not, and hands the file to the host', async () => {
    const manager = fakeManager();
    const saved: Array<{ filename: string; type: string }> = [];
    await renderWithSaver(
      '{[audio src=audio/take.webm anchor=document clipStart=1 cuts=2-3]}\n\n# One\n',
      manager,
      (blob, filename) => {
        saved.push({ filename, type: blob.type });
      },
    );
    // An edit made in the dialog and not applied is part of the copy.
    fireEvent.click(screen.getByRole('tab', { name: 'Volume & fades' }));
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '-3' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save edited copy…' }));
    });
    expect(manager.bake).toHaveBeenCalledTimes(1);
    expect(vi.mocked(manager.bake).mock.calls[0][0]).toMatchObject({
      src: 'audio/take.webm',
      kind: 'audio',
      clipStart: 1,
      edits: { cuts: [{ start: 2, end: 3 }], gain: -3 },
    });
    expect(manager.loadSource).toHaveBeenCalledWith('.mediaEdits/take.0123456789ab.baked.m4a');
    await screen.findByText('Saved take-edited.m4a.');
    expect(saved).toEqual([{ filename: 'take-edited.m4a', type: 'audio/mp4' }]);
    // The document is untouched: saving a copy applies nothing.
    expect(screen.getByTestId('source').textContent).toContain('cuts=2-3]}');
    expect(screen.getByTestId('source').textContent).not.toContain('gain');
  });

  it('shows progress while the copy is made and the reason when it fails', async () => {
    const manager = fakeManager();
    let finish: (error: Error) => void = () => {};
    vi.mocked(manager.bake).mockImplementation(
      (_clip, options) =>
        new Promise<string>((_resolve, reject) => {
          options?.onProgress?.(0.42);
          finish = reject;
        }),
    );
    await openModal('{[audio src=audio/take.webm anchor=document cuts=2-3]}\n\n# One\n', manager);
    fireEvent.click(screen.getByRole('button', { name: 'Save edited copy…' }));
    const busy = await screen.findByRole('button', { name: 'Saving copy… 42%' });
    expect(busy).toHaveProperty('disabled', true);
    await act(async () => finish(new Error('This browser cannot encode video.')));
    await screen.findByText('The copy could not be made: This browser cannot encode video.');
    expect(screen.getByRole('button', { name: 'Save edited copy…' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('stays quiet when the host reports the save was cancelled', async () => {
    const manager = fakeManager();
    await renderWithSaver(
      '{[audio src=audio/take.webm anchor=document cuts=2-3]}\n\n# One\n',
      manager,
      () => false,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save edited copy…' }));
    });
    await waitFor(() => expect(manager.loadSource).toHaveBeenCalled());
    expect(screen.queryByText(/^Saved /)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save edited copy…' })).toHaveProperty(
      'disabled',
      false,
    );
  });
});

describe('MediaEditModal — volume & fades', () => {
  it('writes volume and fades', async () => {
    const { source } = await openModal(
      '{[audio src=audio/take.webm anchor=document]}\n\n# One\n',
      fakeManager(),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Volume & fades' }));
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '-3' } });
    fireEvent.change(screen.getByLabelText('Fade in'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(source().split('\n')[0]).toBe(
        '{[audio src=audio/take.webm anchor=document gain=-3 fadeIn=0.5]}',
      ),
    );
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
      'Cuts',
      'Volume & fades',
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
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Audio cleanup',
      'Cuts',
      'Volume & fades',
      'Frame',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Audio cleanup' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Find pauses' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Cuts' }));
    expect(screen.getByRole('tabpanel', { name: 'Cuts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find pauses' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Loudness' })).toBeNull();
  });

  it('moves between tabs with the arrow, Home and End keys', async () => {
    await openModal(video, fakeManager(), 'video/screen.webm');
    const audio = screen.getByRole('tab', { name: 'Audio cleanup' });
    expect(audio.tabIndex).toBe(0);
    fireEvent.keyDown(audio, { key: 'ArrowRight' });
    const cuts = screen.getByRole('tab', { name: 'Cuts' });
    expect(cuts.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(cuts);
    expect(audio.tabIndex).toBe(-1);
    fireEvent.keyDown(cuts, { key: 'End' });
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
    expect(edited()).toEqual(['Volume & fades']);
    expect(screen.getByRole('tab', { name: 'Volume & fades (edited)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Levels only' }));
    expect(edited()).toEqual(['Audio cleanup', 'Volume & fades']);
  });

  it('keeps each tab’s settings when switching away and back', async () => {
    const { source } = await openModal(video, fakeManager(), 'video/screen.webm');
    fireEvent.click(screen.getByRole('button', { name: 'Levels only' }));
    fireEvent.click(screen.getByRole('tab', { name: /Volume/ }));
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
