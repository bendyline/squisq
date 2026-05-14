/**
 * @vitest-environment jsdom
 *
 * High-level smoke test for the `<ImageEditor>` shell — verifies it
 * mounts against a sidecar container, finishes its initial seed, and
 * renders the toolbar / canvas / panels.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryContentContainer, scopeContainer } from '@bendyline/squisq/storage';
import { writeImageEditDoc, createEmptyImageEditDoc } from '@bendyline/squisq/imageEdit';
import { ImageEditor } from '../ImageEditor.js';

beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:stub'),
    });
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  }
});

describe('<ImageEditor>', () => {
  it('mounts an existing state.json and shows toolbar / layers / properties', async () => {
    const parent = new MemoryContentContainer();
    const sidecar = scopeContainer(parent, 'pic_files');
    await writeImageEditDoc(sidecar, createEmptyImageEditDoc(64, 48));

    render(<ImageEditor filesContainer={sidecar} />);

    await waitFor(() => {
      expect(screen.getByTestId('image-editor')).toBeTruthy();
    });

    expect(screen.getByTestId('image-editor-toolbar')).toBeTruthy();
    expect(screen.getByTestId('image-editor-layers')).toBeTruthy();
    expect(screen.getByTestId('image-editor-properties')).toBeTruthy();

    // SVG canvas viewBox reflects the doc dimensions.
    const svg = document.querySelector('svg.squisq-image-editor-canvas');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 64 48');
  });

  it('shows the loading state before the seed completes', () => {
    const parent = new MemoryContentContainer();
    const sidecar = scopeContainer(parent, 'pic_files');
    render(<ImageEditor filesContainer={sidecar} />);
    expect(screen.getByText(/loading image editor/i)).toBeTruthy();
  });
});
