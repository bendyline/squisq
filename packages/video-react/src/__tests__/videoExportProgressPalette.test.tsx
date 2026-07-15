import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { VideoExportResult } from '../hooks/useVideoExport';
import type { Doc } from '@bendyline/squisq/schemas';

const useVideoExportMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useVideoExport', () => ({
  useVideoExport: useVideoExportMock,
}));

import { VideoExportModal } from '../VideoExportModal';

const doc: Doc = {
  articleId: 'export-progress-theme-test',
  duration: 5,
  blocks: [{ id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] }],
  audio: { segments: [] },
};

describe('VideoExportModal progress palette', () => {
  beforeEach(() => {
    const result: VideoExportResult = {
      state: 'encoding',
      progress: 37,
      phase: 'Encoding',
      duration: 5,
      outputFormat: 'mp4',
      backend: 'webcodecs',
      downloadUrl: null,
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
    useVideoExportMock.mockReturnValue(result);
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
  });
});
