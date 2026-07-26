/**
 * Prop-surface tests for the video export components.
 *
 * `playerScript` is unused on the browser export path (frames are captured
 * from a live in-page DocPlayer), so both VideoExportButton and
 * VideoExportModal must accept being rendered without it.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, renderHook } from '@testing-library/react';
import axe from 'axe-core';
import { VideoExportButton } from '../VideoExportButton';
import { resolveVideoSaveActionLabel, VideoExportModal } from '../VideoExportModal';
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

  it('forwards host palette overrides to its portaled modal', () => {
    const { getByRole } = render(
      <VideoExportButton doc={minimalDoc()} uiPalette={{ surface: '#123456' }} />,
    );
    fireEvent.click(getByRole('button', { name: 'Export Video' }));
    const modal = document.querySelector<HTMLElement>('[data-squisq-video-export-modal]');
    expect(modal?.style.background).toBe('rgb(18, 52, 86)');
  });
});

describe('VideoExportModal', () => {
  it('describes the default browser action as saving to Downloads', () => {
    expect(resolveVideoSaveActionLabel('mp4')).toBe('Save MP4 to Downloads');
    expect(resolveVideoSaveActionLabel('gif')).toBe('Save GIF to Downloads');
    expect(resolveVideoSaveActionLabel('mp4', () => 'Save MP4 as...')).toBe('Save MP4 as...');
  });

  it('is only dismissed by explicit controls and has no automated WCAG A/AA violations', async () => {
    const onClose = vi.fn();
    const { container, getByRole } = render(
      <VideoExportModal doc={minimalDoc()} onClose={onClose} />,
    );
    const dialog = getByRole('dialog', { name: 'Export Video' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const results = await axe.run(dialog, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);

    fireEvent.click(container.querySelector('[data-color-scheme="light"]')!);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(getByRole('button', { name: 'Close export dialog' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from the explicit Cancel button', () => {
    const onClose = vi.fn();
    const { getByRole } = render(<VideoExportModal doc={minimalDoc()} onClose={onClose} />);

    fireEvent.click(getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the configure state without a playerScript prop', () => {
    const { container } = render(<VideoExportModal doc={minimalDoc()} onClose={() => {}} />);
    expect(container.textContent).toContain('Export Video');
  });

  it('defaults MP4 export to 30fps', () => {
    const { container } = render(<VideoExportModal doc={minimalDoc()} onClose={() => {}} />);
    expect((container.querySelector('[aria-label="Frame Rate"]') as HTMLSelectElement).value).toBe(
      '30',
    );
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
      (container.querySelector('[aria-label="Include audio"]') as HTMLInputElement).checked,
    ).toBe(true);
    expect(container.textContent).toContain('Include audio');
    expect(container.textContent).not.toContain('Best effort');
  });

  it('normalizes the internal best-effort policy to the simple include-audio choice', () => {
    const { container } = render(
      <VideoExportModal
        doc={minimalDoc()}
        defaultConfig={{ audioPolicy: 'best-effort' }}
        onClose={() => {}}
      />,
    );
    const checkbox = container.querySelector('[aria-label="Include audio"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('defaults GIF export to 10fps, standard captions, and animations disabled', () => {
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
    expect((container.querySelector('[aria-label="Captions"]') as HTMLSelectElement).value).toBe(
      'standard',
    );
    expect(container.textContent).toContain('Landscape (960 × 540)');
    expect(getByRole('button', { name: 'Export GIF' })).toBeTruthy();
  });

  it('applies format recommendations when the format selection changes', () => {
    const { container } = render(<VideoExportModal doc={minimalDoc()} onClose={() => {}} />);
    const format = container.querySelector('[aria-label="Format"]')!;
    fireEvent.change(format, {
      target: { value: 'gif' },
    });

    expect((container.querySelector('[aria-label="Frame Rate"]') as HTMLSelectElement).value).toBe(
      '10',
    );
    expect(
      (container.querySelector('[aria-label="Animations and transitions"]') as HTMLSelectElement)
        .value,
    ).toBe('disabled');
    expect((container.querySelector('[aria-label="Captions"]') as HTMLSelectElement).value).toBe(
      'standard',
    );

    fireEvent.change(format, {
      target: { value: 'mp4' },
    });

    expect((container.querySelector('[aria-label="Frame Rate"]') as HTMLSelectElement).value).toBe(
      '30',
    );
    expect(
      (container.querySelector('[aria-label="Animations and transitions"]') as HTMLSelectElement)
        .value,
    ).toBe('enabled');
    expect((container.querySelector('[aria-label="Captions"]') as HTMLSelectElement).value).toBe(
      'off',
    );
  });

  it('preserves an explicit captions-off override for GIF export', () => {
    const { container } = render(
      <VideoExportModal
        doc={minimalDoc()}
        defaultConfig={{ outputFormat: 'gif', captionMode: 'off' }}
        onClose={() => {}}
      />,
    );

    expect((container.querySelector('[aria-label="Captions"]') as HTMLSelectElement).value).toBe(
      'off',
    );
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

  it('applies host palette overrides to the dialog, controls, and primary action', () => {
    const { container, getByRole } = render(
      <VideoExportModal
        doc={minimalDoc()}
        uiPalette={{
          surface: '#123456',
          control: '#234567',
          primary: '#345678',
          primaryBorder: '#456789',
          primaryText: '#f1f2f3',
        }}
        onClose={() => {}}
      />,
    );
    const modal = container.querySelector<HTMLElement>('[data-squisq-video-export-modal]');
    const select = container.querySelector<HTMLSelectElement>('select');
    const primary = getByRole('button', { name: 'Export Video' });
    expect(modal?.style.background).toBe('rgb(18, 52, 86)');
    expect(select?.style.background).toBe('rgb(35, 69, 103)');
    expect(primary.style.background).toBe('rgb(52, 86, 120)');
    expect(primary.style.borderColor).toBe('rgb(69, 103, 137)');
    expect(primary.style.color).toBe('rgb(241, 242, 243)');
  });

  it('accepts a host save flow and action-label formatter', () => {
    const saveOutput = vi.fn();
    const { container } = render(
      <VideoExportModal
        doc={minimalDoc()}
        saveOutput={saveOutput}
        saveActionLabel={(format) => `Save ${format.toUpperCase()} as...`}
        onClose={() => {}}
      />,
    );

    expect(container.textContent).toContain('Export Video');
  });
});

describe('useVideoExport result shape', () => {
  it('exposes the additive audio result fields, defaulted for idle', () => {
    const { result } = renderHook(() => useVideoExport());
    expect(result.current.outputFormat).toBe('mp4');
    expect(result.current.outputBlob).toBeNull();
    expect(result.current.audioIncluded).toBe(false);
    expect(result.current.audioSkippedReason).toBeNull();
  });
});
