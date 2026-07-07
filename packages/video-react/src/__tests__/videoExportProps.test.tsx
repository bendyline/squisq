/**
 * Prop-surface tests for the video export components.
 *
 * `playerScript` is unused on the browser export path (frames are captured
 * from a live in-page DocPlayer), so both VideoExportButton and
 * VideoExportModal must accept being rendered without it.
 */

import { describe, it, expect } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { VideoExportButton } from '../VideoExportButton';
import { VideoExportModal } from '../VideoExportModal';
import { useVideoExport } from '../hooks/useVideoExport';
import type { Doc } from '@bendyline/squisq/schemas';

function minimalDoc(): Doc {
  return {
    articleId: 'export-test',
    duration: 5,
    blocks: [{ id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] }],
    audio: { segments: [] },
  };
}

describe('VideoExportButton', () => {
  it('renders without a playerScript prop', () => {
    const { getByRole } = render(<VideoExportButton doc={minimalDoc()} />);
    expect(getByRole('button', { name: 'Export Video' })).toBeTruthy();
  });

  it('accepts a defaultConfig prop', () => {
    const { getByRole } = render(
      <VideoExportButton doc={minimalDoc()} defaultConfig={{ quality: 'high', fps: 30 }} />,
    );
    expect(getByRole('button', { name: 'Export Video' })).toBeTruthy();
  });
});

describe('VideoExportModal', () => {
  it('renders the configure state without a playerScript prop', () => {
    const { container } = render(<VideoExportModal doc={minimalDoc()} onClose={() => {}} />);
    expect(container.textContent).toContain('Export Video');
  });

  it('seeds the initial selections from defaultConfig', () => {
    const { container } = render(
      <VideoExportModal
        doc={minimalDoc()}
        defaultConfig={{
          quality: 'high',
          fps: 30,
          orientation: 'portrait',
          captionMode: 'standard',
        }}
        onClose={() => {}}
      />,
    );
    const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
    // Order in the configure form: Quality, Frame Rate, Orientation, Captions.
    expect(selects[0].value).toBe('high');
    expect(selects[1].value).toBe('30');
    expect(selects[2].value).toBe('portrait');
    expect(selects[3].value).toBe('standard');
  });
});

describe('useVideoExport result shape', () => {
  it('exposes the additive audio result fields, defaulted for idle', () => {
    const { result } = renderHook(() => useVideoExport());
    expect(result.current.audioIncluded).toBe(false);
    expect(result.current.audioSkippedReason).toBeNull();
  });
});
