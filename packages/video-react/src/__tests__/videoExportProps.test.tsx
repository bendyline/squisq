/**
 * Prop-surface tests for the video export components.
 *
 * `playerScript` is unused on the browser export path (frames are captured
 * from a live in-page DocPlayer), so both VideoExportButton and
 * VideoExportModal must accept being rendered without it.
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, renderHook } from '@testing-library/react';
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

  it('uses a GIF-specific default label when configured for GIF output', () => {
    const { getByRole } = render(
      <VideoExportButton doc={minimalDoc()} defaultConfig={{ outputFormat: 'gif' }} />,
    );
    expect(getByRole('button', { name: 'Export GIF' })).toBeTruthy();
  });

  it('forwards the requested color scheme to its portaled modal', () => {
    const { getByRole } = render(<VideoExportButton doc={minimalDoc()} colorScheme="dark" />);
    fireEvent.click(getByRole('button', { name: 'Export Video' }));
    expect(document.querySelector('[data-color-scheme="dark"]')).toBeTruthy();
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
    expect((container.querySelector('[aria-label="Format"]') as HTMLSelectElement).value).toBe(
      'mp4',
    );
    expect((container.querySelector('[aria-label="Quality"]') as HTMLSelectElement).value).toBe(
      'high',
    );
    expect((container.querySelector('[aria-label="Frame Rate"]') as HTMLSelectElement).value).toBe(
      '30',
    );
    expect((container.querySelector('[aria-label="Orientation"]') as HTMLSelectElement).value).toBe(
      'portrait',
    );
    expect((container.querySelector('[aria-label="Captions"]') as HTMLSelectElement).value).toBe(
      'standard',
    );
    expect(
      (container.querySelector('[aria-label="Animations and transitions"]') as HTMLSelectElement)
        .value,
    ).toBe('enabled');
    expect(
      (container.querySelector('[aria-label="Audio handling"]') as HTMLSelectElement).value,
    ).toBe('require');
  });

  it('allows an explicit best-effort or omit audio policy', () => {
    const { container } = render(
      <VideoExportModal
        doc={minimalDoc()}
        defaultConfig={{ audioPolicy: 'best-effort' }}
        onClose={() => {}}
      />,
    );
    const select = container.querySelector('[aria-label="Audio handling"]') as HTMLSelectElement;
    expect(select.value).toBe('best-effort');
    fireEvent.change(select, { target: { value: 'omit' } });
    expect(select.value).toBe('omit');
  });

  it('defaults GIF export to 10fps with animations and transitions disabled', () => {
    const { container, getByRole } = render(
      <VideoExportModal
        doc={minimalDoc()}
        defaultConfig={{ outputFormat: 'gif' }}
        onClose={() => {}}
      />,
    );

    expect(getByRole('heading', { name: 'Export Animated GIF' })).toBeTruthy();
    expect((container.querySelector('[aria-label="Frame Rate"]') as HTMLSelectElement).value).toBe(
      '10',
    );
    expect(
      (container.querySelector('[aria-label="Animations and transitions"]') as HTMLSelectElement)
        .value,
    ).toBe('disabled');
    expect(container.textContent).toContain('Landscape (960 × 540)');
    expect(getByRole('button', { name: 'Export GIF' })).toBeTruthy();
  });

  it('applies GIF recommendations when the format selection changes', () => {
    const { container } = render(<VideoExportModal doc={minimalDoc()} onClose={() => {}} />);
    fireEvent.change(container.querySelector('[aria-label="Format"]')!, {
      target: { value: 'gif' },
    });

    expect((container.querySelector('[aria-label="Frame Rate"]') as HTMLSelectElement).value).toBe(
      '10',
    );
    expect(
      (container.querySelector('[aria-label="Animations and transitions"]') as HTMLSelectElement)
        .value,
    ).toBe('disabled');
  });

  it('applies dark colors to the modal surface and native controls', () => {
    const { container } = render(
      <VideoExportModal doc={minimalDoc()} colorScheme="dark" onClose={() => {}} />,
    );
    const overlay = container.querySelector('[data-color-scheme="dark"]');
    const modal = overlay?.firstElementChild as HTMLElement | null;
    const select = container.querySelector('select');
    expect(modal?.style.colorScheme).toBe('dark');
    expect(modal?.style.background).toBe('rgb(17, 24, 39)');
    expect(select?.style.colorScheme).toBe('dark');
  });
});

describe('useVideoExport result shape', () => {
  it('exposes the additive audio result fields, defaulted for idle', () => {
    const { result } = renderHook(() => useVideoExport());
    expect(result.current.outputFormat).toBe('mp4');
    expect(result.current.audioIncluded).toBe(false);
    expect(result.current.audioSkippedReason).toBeNull();
  });
});
