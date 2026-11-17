/** @vitest-environment jsdom */
import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer, scopeContainer } from '@bendyline/squisq/storage';
import { createEmptyImageEditDoc, writeImageEditDoc } from '@bendyline/squisq/imageEdit';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';

vi.mock('@bendyline/squisq/imageEdit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq/imageEdit')>();
  // jsdom cannot rasterize; the save feedback is what is under test.
  return {
    ...actual,
    exportImageEditDoc: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })),
  };
});

import { ImageEditor, type ImageEditorHandle } from '../ImageEditor';

beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:x' });
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  }
});

async function sidecar() {
  const container = scopeContainer(new MemoryContentContainer(), 'pic');
  await writeImageEditDoc(container, createEmptyImageEditDoc(64, 48));
  return container;
}

describe('<ImageEditor> save feedback', () => {
  it('shows a failed write-back instead of only logging it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onExport = vi.fn(async () => {
      throw new Error('disk full');
    });
    render(
      <ImageEditor
        filesContainer={await sidecar()}
        onExport={onExport}
        saveBehavior="export"
        saveFormat="jpeg"
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Save and close' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('disk full');
    expect(screen.getByRole('button', { name: 'Save and close' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss save error' }));
    expect(screen.queryByRole('alert')).toBeNull();
    warn.mockRestore();
  });

  it('marks the Save button busy and joins concurrent saves', async () => {
    let finish: () => void = () => {};
    const onExport = vi.fn(
      (_blob: Blob, _format: string, _doc: ImageEditDoc) =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const ref = createRef<ImageEditorHandle>();
    render(
      <ImageEditor
        ref={ref}
        filesContainer={await sidecar()}
        onExport={onExport}
        saveBehavior="export"
        saveFormat="jpeg"
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Save and close' }));

    const busy = await screen.findByRole('button', { name: 'Saving…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    // A close arriving mid-save rides the same save.
    const closeSave = ref.current!.save();
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(onExport.mock.calls[0]![2]).toEqual(ref.current!.getDoc());

    await act(async () => finish());
    await expect(closeSave).resolves.toBe(true);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save and close' })).toBeTruthy();
  });
});
