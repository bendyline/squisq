import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { VideoExportResult } from '../hooks/useVideoExport';
import type { Doc } from '@bendyline/squisq/schemas';

const useVideoExportMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useVideoExport', () => ({
  useVideoExport: useVideoExportMock,
}));

import { drawVideoExportPreview, VideoExportModal } from '../VideoExportModal';

const doc: Doc = {
  articleId: 'export-progress-theme-test',
  duration: 5,
  blocks: [{ id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] }],
  audio: { segments: [] },
};

let currentResult: VideoExportResult;

describe('VideoExportModal progress palette', () => {
  beforeEach(() => {
    currentResult = {
      state: 'encoding',
      progress: 37,
      phase: 'Encoding',
      currentFrameTime: 16.5,
      processingFps: 0.625,
      duration: 5,
      outputFormat: 'mp4',
      backend: 'webcodecs',
      downloadUrl: null,
      outputBlob: null,
      fileSize: 0,
      audioIncluded: false,
      audioSkippedReason: null,
      error: null,
      elapsed: 2,
      estimatedRemaining: 3,
      startExport: vi.fn(async () => {}),
      cancel: vi.fn(),
      reset: vi.fn(),
    };
    useVideoExportMock.mockReturnValue(currentResult);
  });

  it('uses the host accent for the progress fill and tint for its track', () => {
    const { container } = render(
      <VideoExportModal
        doc={doc}
        uiPalette={{ primary: '#345678', secondary: '#123456' }}
        onClose={() => {}}
      />,
    );

    const track = container.querySelector<HTMLElement>('[data-squisq-video-export-progress-track]');
    const progress = container.querySelector<HTMLElement>('[data-squisq-video-export-progress]');
    expect(track?.style.background).toBe('rgb(18, 52, 86)');
    expect(progress?.style.background).toBe('rgb(52, 86, 120)');
    expect(progress?.style.width).toBe('37%');
    expect(container.querySelector('[data-squisq-video-export-preview]')).not.toBeNull();
    expect(useVideoExportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        onFramePreview: expect.any(Function),
        previewEveryNFrames: 15,
      }),
    );
    expect(
      container.querySelector<HTMLElement>('[data-squisq-video-export-phase]')?.textContent,
    ).toBe('Encoding - 0.63 fps · 0.03× realtime');
    expect(
      container.querySelector<HTMLElement>('[data-squisq-video-export-progress-label]')
        ?.textContent,
    ).toBe('37.0% complete, @ 16.5 seconds');
  });

  it('keeps encoder implementation details out of the progress dialog', () => {
    const { container } = render(<VideoExportModal doc={doc} onClose={() => {}} />);

    expect(container.textContent).not.toContain('Encoder:');
    expect(container.textContent).not.toContain('H.264');
    expect(container.textContent).not.toContain('ffmpeg.wasm');
  });

  it('passes the completed Blob to a host save flow', async () => {
    const outputBlob = new Blob(['video'], { type: 'video/mp4' });
    const saveOutput = vi.fn(async (_blob: Blob, _filename: string) => true);
    useVideoExportMock.mockReturnValue({
      ...currentResult,
      state: 'complete',
      progress: 100,
      phase: 'Export complete',
      downloadUrl: 'blob:completed-video',
      outputBlob,
      fileSize: outputBlob.size,
    });

    const { getByRole } = render(
      <VideoExportModal
        doc={doc}
        saveOutput={saveOutput}
        saveActionLabel={() => 'Save MP4 as...'}
        onClose={() => {}}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Save MP4 as...' }));

    await waitFor(() => expect(saveOutput).toHaveBeenCalledOnce());
    expect(saveOutput.mock.calls[0]?.[0]).toBe(outputBlob);
    expect(saveOutput.mock.calls[0]?.[1]).toMatch(/^document-\d{4}-\d{2}-\d{2}\.mp4$/);
  });

  it('letterboxes portrait previews instead of stretching them', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const source = { width: 1080, height: 1920 } as HTMLCanvasElement;
    const context = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    drawVideoExportPreview(canvas, source);

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 480, 270);
    expect(context.drawImage).toHaveBeenCalledWith(source, 164.0625, 0, 151.875, 270);
  });
});
