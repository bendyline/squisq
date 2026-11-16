/**
 * The saved video's file name.
 *
 * Every export used to save as `document-<date>.mp4`, whatever the document
 * was called. The name now comes from the host, then the document's own
 * title, and carries no date.
 */

import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VideoExportResult } from '../hooks/useVideoExport';
import type { Doc } from '@bendyline/squisq/schemas';

const useVideoExportMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useVideoExport', () => ({
  useVideoExport: useVideoExportMock,
}));

import { exportFileBaseName } from '../exportFilename';
import { videoExportFilename, VideoExportModal } from '../VideoExportModal';

function docWith(overrides: Partial<Doc> = {}): Doc {
  return {
    articleId: 'export-filename-test',
    duration: 5,
    blocks: [{ id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] }],
    audio: { segments: [] },
    ...overrides,
  };
}

function completedExport(outputFormat: 'mp4' | 'gif' = 'mp4'): VideoExportResult {
  return {
    state: 'complete',
    progress: 100,
    phase: '',
    currentFrameTime: null,
    processingFps: null,
    duration: 5,
    outputFormat,
    backend: 'webcodecs',
    downloadUrl: 'blob:export',
    outputBlob: new Blob(['video'], { type: `video/${outputFormat}` }),
    fileSize: 5,
    audioIncluded: false,
    audioSkippedReason: null,
    error: null,
    elapsed: 2,
    estimatedRemaining: 0,
    startExport: vi.fn(async () => {}),
    cancel: vi.fn(),
    reset: vi.fn(),
  };
}

describe('exportFileBaseName', () => {
  it('keeps a title readable, dots and case included', () => {
    expect(exportFileBaseName('Plan v2.1')).toBe('Plan v2.1');
    expect(exportFileBaseName('Fist Fighter Arts')).toBe('Fist Fighter Arts');
  });

  it('replaces characters filesystems reject and folds whitespace', () => {
    expect(exportFileBaseName('Q3: wins/losses?')).toBe('Q3- wins-losses-');
    expect(exportFileBaseName('  Two\nlines\tand  gaps  ')).toBe('Two lines and gaps');
    expect(exportFileBaseName('Ends with dots...')).toBe('Ends with dots');
    expect(exportFileBaseName('Bell\u0007 and del\u007f')).toBe('Bell- and del-');
  });

  it('is undefined when nothing usable is left', () => {
    expect(exportFileBaseName(undefined)).toBeUndefined();
    expect(exportFileBaseName('')).toBeUndefined();
    expect(exportFileBaseName(' . . ')).toBeUndefined();
  });

  it('fits a long title within a file name without splitting a character', () => {
    const ascii = exportFileBaseName('a'.repeat(400));
    expect(ascii).toBe('a'.repeat(200));
    const wide = exportFileBaseName('界'.repeat(100));
    expect(new TextEncoder().encode(wide).length).toBeLessThanOrEqual(200);
    expect(wide).toBe('界'.repeat(66));
  });
});

describe('videoExportFilename', () => {
  it('prefers the host name, then the frontmatter title, then the cover title', () => {
    const doc = docWith({
      frontmatter: { title: 'Authored Title' },
      startBlock: { title: 'Top Heading' },
    });
    expect(videoExportFilename(doc, 'mp4', 'Host Name')).toBe('Host Name.mp4');
    expect(videoExportFilename(doc, 'mp4')).toBe('Authored Title.mp4');
    expect(videoExportFilename(docWith({ startBlock: { title: 'Top Heading' } }), 'gif')).toBe(
      'Top Heading.gif',
    );
  });

  it('skips a blank host name or frontmatter title', () => {
    const doc = docWith({ frontmatter: { title: '   ' }, startBlock: { title: 'Top Heading' } });
    expect(videoExportFilename(doc, 'mp4', '  ')).toBe('Top Heading.mp4');
  });

  it('falls back to document, with no date', () => {
    expect(videoExportFilename(docWith(), 'mp4')).toBe('document.mp4');
  });
});

describe('VideoExportModal save name', () => {
  it('hands the host save flow the host-supplied name', async () => {
    useVideoExportMock.mockReturnValue(completedExport());
    const saveOutput = vi.fn(async (_blob: Blob, _filename: string) => true);
    const { getByRole } = render(
      <VideoExportModal
        doc={docWith({ startBlock: { title: 'Top Heading' } })}
        fileBaseName="Fist Fighter Arts"
        saveOutput={saveOutput}
        onClose={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /mp4/i }));
    });

    expect(saveOutput).toHaveBeenCalledWith(expect.any(Blob), 'Fist Fighter Arts.mp4');
  });

  it('names a download after the document title when the host names nothing', async () => {
    useVideoExportMock.mockReturnValue(completedExport('gif'));
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    try {
      const { getByRole } = render(
        <VideoExportModal
          doc={docWith({ frontmatter: { title: 'Launch Recap' } })}
          onClose={() => {}}
        />,
      );

      await act(async () => {
        fireEvent.click(getByRole('button', { name: /gif/i }));
      });

      expect(downloads).toEqual(['Launch Recap.gif']);
    } finally {
      click.mockRestore();
    }
  });
});
