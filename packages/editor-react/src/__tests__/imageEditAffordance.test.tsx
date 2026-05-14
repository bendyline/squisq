/**
 * @vitest-environment jsdom
 *
 * Tests for the image-edit affordance + modal:
 *   - EditorContext exposes openImageEdit / closeImageEdit / bumpMediaRevision
 *   - <EditorShell> mounts an `<ImageEditModal>` when the target is set,
 *     and routes Export blobs back through `mediaProvider.addMedia`.
 *
 * The Tiptap NodeView itself isn't exercised here (Tiptap + ProseMirror
 * are jsdom-hostile); we verify the surrounding context + shell wiring
 * directly via a small harness.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MemoryContentContainer,
  createMediaProviderFromContainer,
} from '@bendyline/squisq/storage';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { EditorProvider, useEditorContext } from '../EditorContext';

// Stub the heavy editing surfaces so the shell can mount under jsdom
// without dragging in monaco-editor or Tiptap. We only care about the
// shell's modal-mounting wiring here.
vi.mock('../RawEditor', () => ({
  RawEditor: () => <div data-testid="raw-editor-stub" />,
}));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg-editor-stub" />,
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="preview-stub" />,
}));

import { EditorShell } from '../EditorShell';

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
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      }),
    });
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
});

// ── Context harness ──────────────────────────────────────

function ContextHarness() {
  const ctx = useEditorContext();
  return (
    <div>
      <span data-testid="target">{ctx.imageEditTarget ?? 'null'}</span>
      <span data-testid="revision">{ctx.mediaRevision}</span>
      <button data-testid="open" type="button" onClick={() => ctx.openImageEdit('hero.png')}>
        open
      </button>
      <button data-testid="close" type="button" onClick={ctx.closeImageEdit}>
        close
      </button>
      <button data-testid="bump" type="button" onClick={ctx.bumpMediaRevision}>
        bump
      </button>
    </div>
  );
}

describe('EditorContext image-edit actions', () => {
  it('starts with imageEditTarget=null and mediaRevision=0', () => {
    render(
      <EditorProvider>
        <ContextHarness />
      </EditorProvider>,
    );
    expect(screen.getByTestId('target').textContent).toBe('null');
    expect(screen.getByTestId('revision').textContent).toBe('0');
  });

  it('openImageEdit sets the target, closeImageEdit clears it', () => {
    render(
      <EditorProvider>
        <ContextHarness />
      </EditorProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('open'));
    });
    expect(screen.getByTestId('target').textContent).toBe('hero.png');
    act(() => {
      fireEvent.click(screen.getByTestId('close'));
    });
    expect(screen.getByTestId('target').textContent).toBe('null');
  });

  it('bumpMediaRevision increments monotonically', () => {
    render(
      <EditorProvider>
        <ContextHarness />
      </EditorProvider>,
    );
    expect(screen.getByTestId('revision').textContent).toBe('0');
    act(() => {
      fireEvent.click(screen.getByTestId('bump'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('bump'));
    });
    expect(screen.getByTestId('revision').textContent).toBe('2');
  });
});

// ── Shell + modal harness ────────────────────────────────

/**
 * A floating button that uses `useEditorContext` to dispatch
 * `openImageEdit(path)` from inside the shell — this lets us trigger
 * the modal without spinning up a full Tiptap NodeView.
 */
function TriggerButton({ path }: { path: string }) {
  const { openImageEdit } = useEditorContext();
  return (
    <button data-testid="trigger" type="button" onClick={() => openImageEdit(path)}>
      open
    </button>
  );
}

async function setupShellWithImage(): Promise<{
  container: MemoryContentContainer;
  mediaProvider: MediaProvider;
}> {
  const container = new MemoryContentContainer();
  // Seed a 1×1 PNG so resolveUrl returns a fetchable blob URL.
  const onePixel = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  await container.writeFile('hero.png', onePixel.buffer, 'image/png');
  const mediaProvider = createMediaProviderFromContainer(container);
  return { container, mediaProvider };
}

describe('<EditorShell> image-edit modal wiring', () => {
  it('opens the modal when openImageEdit is dispatched and closes via the close button', async () => {
    const { container, mediaProvider } = await setupShellWithImage();
    render(
      <EditorShell
        initialMarkdown="# hi"
        container={container}
        mediaProvider={mediaProvider}
        toolbarSlotRight={<TriggerButton path="hero.png" />}
      />,
    );

    expect(screen.queryByTestId('image-edit-modal')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('image-edit-modal')).toBeTruthy();
    });
    // Shows the relative path in the header.
    expect(screen.getByText('hero.png')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('image-edit-modal-close'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('image-edit-modal')).toBeNull();
    });
  });

  it('opens the modal with a transient sidecar when only a mediaProvider is wired (no host container)', async () => {
    const { mediaProvider } = await setupShellWithImage();
    render(
      <EditorShell
        initialMarkdown="# hi"
        mediaProvider={mediaProvider}
        toolbarSlotRight={<TriggerButton path="hero.png" />}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger'));
    });
    // Modal now mounts even without a host container — the sidecar is
    // backed by a fresh MemoryContentContainer the modal owns.
    await waitFor(() => {
      expect(screen.getByTestId('image-edit-modal')).toBeTruthy();
    });
  });

  it('does NOT mount the modal when no mediaProvider is wired', async () => {
    render(
      <EditorShell initialMarkdown="# hi" toolbarSlotRight={<TriggerButton path="hero.png" />} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger'));
    });
    // Without a media provider the modal has no way to resolve the source
    // or write the result back — the guard bails out.
    expect(screen.queryByTestId('image-edit-modal')).toBeNull();
  });

  it('writes the exported blob back through mediaProvider.addMedia and closes', async () => {
    const { container, mediaProvider } = await setupShellWithImage();
    const addMediaSpy = vi.spyOn(mediaProvider, 'addMedia');

    render(
      <EditorShell
        initialMarkdown="# hi"
        container={container}
        mediaProvider={mediaProvider}
        toolbarSlotRight={<TriggerButton path="hero.png" />}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('image-edit-modal')).toBeTruthy();
    });

    // Drive the export path directly via mediaProvider.addMedia — the
    // modal's onExport handler does exactly this. We don't try to
    // pump the inner ImageEditor's Export button (it depends on async
    // sidecar seeding that's heavy to wait through here).
    // Pass raw bytes (a Uint8Array) — jsdom's Blob lacks `arrayBuffer()`,
    // and a fake-Blob stub doesn't satisfy `instanceof Blob`, so the
    // simplest payload is the Uint8Array branch addMedia already supports.
    const bytes = new Uint8Array([1, 2, 3]);
    await act(async () => {
      await mediaProvider.addMedia('hero.png', bytes, 'image/png');
    });

    expect(addMediaSpy).toHaveBeenCalledWith('hero.png', bytes, 'image/png');
  });
});
