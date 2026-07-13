/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { RecorderModal } from '../recorder/RecorderModal';
import { RecorderPanel } from '../recorder/RecorderPanel';

const mediaProvider: MediaProvider = {
  resolveUrl: vi.fn(async (path: string) => path),
  listMedia: vi.fn(async () => []),
  addMedia: vi.fn(async (name: string) => name),
  removeMedia: vi.fn(async () => undefined),
  dispose: vi.fn(),
};

describe('recorder theme propagation', () => {
  it('creates a dark theme scope for the recorder dialog', () => {
    render(<RecorderModal mediaProvider={mediaProvider} colorScheme="dark" onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Record media' });
    expect(dialog.getAttribute('data-theme')).toBe('dark');
    expect(dialog.classList.contains('squisq-editor-shell')).toBe(true);
    expect(dialog.style.colorScheme).toBe('dark');
    expect(dialog.style.getPropertyValue('--squisq-recorder-surface')).toBe(
      'var(--squisq-bg, #1f2937)',
    );
    expect(dialog.style.getPropertyValue('--squisq-recorder-text')).toBe(
      'var(--squisq-text, #e5e7eb)',
    );
  });

  it('passes the requested scheme through the portaled panel wrapper', () => {
    render(<RecorderPanel mediaProvider={mediaProvider} colorScheme="dark" />);
    fireEvent.click(screen.getByRole('button', { name: 'Record media' }));

    expect(screen.getByRole('dialog', { name: 'Record media' }).getAttribute('data-theme')).toBe(
      'dark',
    );
  });
});
