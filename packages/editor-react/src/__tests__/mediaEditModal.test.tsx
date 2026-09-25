/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MediaEditRenderManager } from '@bendyline/squisq-video-react/media-edit';
import { EditorProvider, useEditorContext } from '../EditorContext';
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
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
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

  it('offers no frame controls for audio', async () => {
    await openModal('{[audio src=audio/take.webm anchor=document]}\n\n# One\n', fakeManager());
    expect(screen.queryByRole('slider', { name: 'Crop area' })).toBeNull();
  });
});
