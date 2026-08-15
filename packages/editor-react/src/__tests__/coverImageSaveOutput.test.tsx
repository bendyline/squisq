/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewSettingsProvider, PreviewToolbarControls } from '../PreviewControls';

vi.mock('@bendyline/squisq-video-react/cover-image', () => ({
  CoverImageExportModal: ({ saveOutput }: { saveOutput?: unknown }) => (
    <div
      data-testid="cover-image-export-modal"
      data-has-host-save={typeof saveOutput === 'function'}
    />
  ),
}));

function PreviewHarness() {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <PreviewToolbarControls />
    </PreviewSettingsProvider>
  );
}

function Harness({ saveOutput }: { saveOutput?: (blob: Blob, filename: string) => void }) {
  return (
    <EditorProvider initialMarkdown="# Cover" saveCoverImageOutput={saveOutput}>
      <PreviewHarness />
    </EditorProvider>
  );
}

describe('cover image host save output', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    cleanup();
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  });

  it('passes the EditorProvider host save callback into the cover export modal', () => {
    class ResizeObserverStub implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;

    render(<Harness saveOutput={vi.fn()} />);

    fireEvent.click(document.querySelector('.squisq-cover-slide-trigger')!);
    fireEvent.click(screen.getByRole('button', { name: 'Export cover as image…' }));

    expect(screen.getByTestId('cover-image-export-modal').dataset.hasHostSave).toBe('true');
  });
});
