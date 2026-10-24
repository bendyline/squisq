/**
 * Escape in the Export Video dialog.
 *
 * The dialog ignored Escape outright, unlike every other dialog, so a user who
 * opened it by mistake had to find the close button (and DocBlocks' UX crawl
 * stalled behind it). Escape now closes it whenever nothing would be lost: not
 * mid-export, which closing cancels, and not over a finished export that has
 * not been saved, which closing discards.
 */

import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { VideoExportResult, VideoExportState } from '../hooks/useVideoExport';
import type { Doc } from '@bendyline/squisq/schemas';

const useVideoExportMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useVideoExport', () => ({
  useVideoExport: useVideoExportMock,
}));

import { VideoExportModal } from '../VideoExportModal';

const doc: Doc = {
  articleId: 'export-escape-test',
  duration: 5,
  blocks: [{ id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] }],
  audio: { segments: [] },
};

function exportResult(state: VideoExportState): VideoExportResult {
  const complete = state === 'complete';
  return {
    state,
    progress: complete ? 100 : 40,
    phase: '',
    currentFrameTime: null,
    processingFps: null,
    duration: 5,
    outputFormat: 'mp4',
    backend: 'webcodecs',
    downloadUrl: complete ? 'blob:export' : null,
    outputBlob: complete ? new Blob(['video'], { type: 'video/mp4' }) : null,
    fileSize: complete ? 5 : 0,
    audioIncluded: false,
    audioSkippedReason: null,
    error: state === 'error' ? 'Encoder unavailable' : null,
    elapsed: 2,
    estimatedRemaining: 0,
    startExport: vi.fn(async () => {}),
    cancel: vi.fn(),
    reset: vi.fn(),
  };
}

function pressEscape(): void {
  fireEvent.keyDown(document, { key: 'Escape' });
}

describe('VideoExportModal Escape', () => {
  let onClose: Mock<() => void>;

  beforeEach(() => {
    onClose = vi.fn<() => void>();
  });

  for (const state of ['idle', 'error'] as const) {
    it(`closes on Escape when ${state === 'idle' ? 'choosing options' : 'an export failed'}`, () => {
      const result = exportResult(state);
      useVideoExportMock.mockReturnValue(result);
      render(<VideoExportModal doc={doc} onClose={onClose} />);

      pressEscape();

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(result.reset).toHaveBeenCalledTimes(1);
    });
  }

  for (const state of ['preparing', 'capturing', 'encoding'] as const) {
    it(`ignores Escape while ${state}, which would cancel the export`, () => {
      const result = exportResult(state);
      useVideoExportMock.mockReturnValue(result);
      render(<VideoExportModal doc={doc} onClose={onClose} />);

      pressEscape();

      expect(onClose).not.toHaveBeenCalled();
      expect(result.cancel).not.toHaveBeenCalled();
    });
  }

  it('exports the chosen preset while preserving the audio choice', async () => {
    const result = exportResult('idle');
    useVideoExportMock.mockReturnValue(result);
    const { getByRole, container } = render(
      <VideoExportModal doc={doc} onClose={onClose} defaultConfig={{ audioPolicy: 'omit' }} />,
    );
    expect(container.querySelector('details')?.open).toBe(false);
    fireEvent.change(getByRole('combobox', { name: 'Preset' }), { target: { value: 'social' } });
    await act(async () => fireEvent.click(getByRole('button', { name: 'Export Video' })));
    expect(result.startExport).toHaveBeenLastCalledWith(
      doc,
      expect.objectContaining({
        orientation: 'portrait',
        quality: 'normal',
        fps: 30,
        captionMode: 'social',
        animationsEnabled: true,
        audioPolicy: 'omit',
      }),
    );
    fireEvent.change(getByRole('combobox', { name: 'Preset' }), { target: { value: 'small' } });
    await act(async () => fireEvent.click(getByRole('button', { name: 'Export Video' })));
    expect(result.startExport).toHaveBeenLastCalledWith(
      doc,
      expect.objectContaining({
        orientation: 'landscape',
        quality: 'draft',
        fps: 15,
        captionMode: 'off',
        animationsEnabled: false,
        audioPolicy: 'omit',
      }),
    );
  });

  for (const format of ['mp4', 'gif'] as const) {
    it(`previews the completed ${format} before saving without autoplay`, () => {
      const result = { ...exportResult('complete'), outputFormat: format };
      useVideoExportMock.mockReturnValue(result);
      const { container } = render(<VideoExportModal doc={doc} onClose={onClose} />);
      const preview = container.querySelector(format === 'gif' ? 'img' : 'video');
      expect(preview?.getAttribute('src')).toBe(result.downloadUrl);
      expect(preview?.hasAttribute('autoplay')).toBe(false);
      if (format === 'mp4') expect(preview?.hasAttribute('controls')).toBe(true);
      expect(container.textContent).toContain('Preview your export before saving.');
    });
  }

  it('ignores Escape over a finished export that has not been saved', () => {
    useVideoExportMock.mockReturnValue(exportResult('complete'));
    render(<VideoExportModal doc={doc} onClose={onClose} />);

    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape once the finished export has been saved', async () => {
    useVideoExportMock.mockReturnValue(exportResult('complete'));
    const saveOutput = vi.fn(async () => true);
    const { getByRole } = render(
      <VideoExportModal doc={doc} onClose={onClose} saveOutput={saveOutput} />,
    );

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /mp4/i }));
    });
    expect(saveOutput).toHaveBeenCalledTimes(1);
    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('places host save options above Save and disables them while saving', async () => {
    useVideoExportMock.mockReturnValue(exportResult('complete'));
    let finishSave: (value: boolean) => void = () => {};
    const saveOutput = () =>
      new Promise<boolean>((resolve) => {
        finishSave = resolve;
      });
    const { getByRole } = render(
      <VideoExportModal
        doc={doc}
        onClose={onClose}
        saveOutput={saveOutput}
        saveOptions={
          <label>
            <input type="checkbox" />
            Open in app after saving
          </label>
        }
      />,
    );
    const checkbox = getByRole('checkbox', { name: 'Open in app after saving' });
    const save = getByRole('button', { name: /mp4/i });
    expect(checkbox.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(save);
    expect(checkbox.closest('fieldset')?.disabled).toBe(true);
    await act(async () => {
      finishSave(true);
    });
    expect(checkbox.closest('fieldset')?.disabled).toBe(false);
  });

  it('keeps ignoring Escape when the save picker was cancelled', async () => {
    useVideoExportMock.mockReturnValue(exportResult('complete'));
    const saveOutput = vi.fn(async () => false);
    const { getByRole } = render(
      <VideoExportModal doc={doc} onClose={onClose} saveOutput={saveOutput} />,
    );

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /mp4/i }));
    });
    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
  });
});
