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
