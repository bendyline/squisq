/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  IMAGE_EDIT_STATE_FILENAME,
  readImageEditDoc,
  writeImageEditDoc,
  createEmptyImageEditDoc,
} from '@bendyline/squisq/imageEdit';
import { useImageEditor } from '../imageEditor/useImageEditor.js';

beforeEach(() => {
  // jsdom doesn't implement createObjectURL or HTMLImageElement loading.
  // Stub both so the hook can complete its asset-resolution path.
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:stub'),
    });
  } else {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:stub');
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  }
});

describe('useImageEditor', () => {
  it('loads an existing state.json from the container', async () => {
    const container = new MemoryContentContainer();
    const doc = createEmptyImageEditDoc(120, 80);
    await writeImageEditDoc(container, doc);

    const { result } = renderHook(() => useImageEditor({ container, persistDebounceMs: 5 }));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.state?.doc.canvas.width).toBe(120);
    expect(result.current.error).toBe(null);
  });

  it('seeds an empty doc when no state.json and no initialSrc', async () => {
    const container = new MemoryContentContainer();
    const { result } = renderHook(() => useImageEditor({ container, persistDebounceMs: 5 }));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.state?.doc.layers).toHaveLength(0);
    // The seed should have been written back to the container.
    const persisted = await readImageEditDoc(container);
    expect(persisted).not.toBeNull();
  });

  it('persists state.json after a debounced action', async () => {
    const container = new MemoryContentContainer();
    await writeImageEditDoc(container, createEmptyImageEditDoc(50, 50));

    const { result } = renderHook(() => useImageEditor({ container, persistDebounceMs: 5 }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.dispatch({
        type: 'add-layer',
        layer: {
          type: 'shape',
          position: { x: 0, y: 0, width: 10, height: 10 },
          content: { shape: 'rect', fill: '#000' },
        },
      });
    });

    await waitFor(() => expect(result.current.state?.dirty).toBe(false), {
      timeout: 500,
    });

    const persisted = await readImageEditDoc(container);
    expect(persisted?.layers).toHaveLength(1);
  });

  it('uploadAsset writes bytes under assets/ and returns the path', async () => {
    const container = new MemoryContentContainer();
    await writeImageEditDoc(container, createEmptyImageEditDoc(10, 10));

    const { result } = renderHook(() => useImageEditor({ container, persistDebounceMs: 5 }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    const bytes = new Uint8Array([1, 2, 3, 4]);
    // jsdom's Blob predates the arrayBuffer() method on some versions, so
    // shim a minimal Blob-like that the hook only needs `.arrayBuffer()`
    // and `.type` from.
    const file = {
      type: 'image/png',
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Blob;
    let path = '';
    await act(async () => {
      path = await result.current.uploadAsset(file, 'pic.png');
    });
    expect(path).toMatch(/^assets\/.+\.png$/);
    const written = await container.readFile(path);
    expect(written).not.toBeNull();
    expect(written!.byteLength).toBe(4);
  });

  it('flush writes synchronously and clears dirty', async () => {
    const container = new MemoryContentContainer();
    await writeImageEditDoc(container, createEmptyImageEditDoc(10, 10));

    const { result } = renderHook(
      () => useImageEditor({ container, persistDebounceMs: 100000 }), // effectively disabled
    );
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.dispatch({
        type: 'set-canvas',
        canvas: { width: 25, height: 25 },
      });
    });
    expect(result.current.state?.dirty).toBe(true);

    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.state?.dirty).toBe(false);
    const persisted = await readImageEditDoc(container);
    expect(persisted?.canvas.width).toBe(25);
  });

  it('versioning is null when allowVersioning is false', async () => {
    const container = new MemoryContentContainer();
    await writeImageEditDoc(container, createEmptyImageEditDoc(10, 10));
    const { result } = renderHook(() => useImageEditor({ container, persistDebounceMs: 5 }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.versioning).toBe(null);
  });

  it('versioning manager is exposed when allowVersioning is true', async () => {
    const container = new MemoryContentContainer();
    await writeImageEditDoc(container, createEmptyImageEditDoc(10, 10));
    const { result } = renderHook(() =>
      useImageEditor({
        container,
        persistDebounceMs: 5,
        allowVersioning: true,
        versioningAutoSaveIdleMs: 0, // disable autosave
      }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.versioning).not.toBe(null);
  });
});

// Ensure constants are referenced so unused-import lint stays quiet.
void IMAGE_EDIT_STATE_FILENAME;
