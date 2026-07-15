/** @vitest-environment jsdom */

import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaContext } from '@bendyline/squisq-react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewPanel } from '../PreviewPanel';
import { PreviewSettingsProvider, usePreviewSettings } from '../PreviewControls';
import {
  PresentationModeControl,
  PresentationModeProvider,
} from '../presentation/PresentationMode';
import {
  PrintModeControl,
  PrintModeProvider,
  PrintPreviewToolbar,
  usePrintMode,
} from '../print/PrintMode';

function ModeToolbar() {
  const printMode = usePrintMode();
  if (printMode.active) return <PrintPreviewToolbar />;
  return (
    <>
      <PresentationModeControl />
      <PrintModeControl />
    </>
  );
}

function ModeChooser() {
  const settings = usePreviewSettings();
  return (
    <button type="button" onClick={() => settings.setSelectedDisplayMode('page')}>
      Document mode
    </button>
  );
}

function Harness() {
  const { doc } = useEditorContext();
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef} data-testid="shell">
      <PreviewSettingsProvider doc={doc}>
        <PresentationModeProvider rootRef={rootRef}>
          <PrintModeProvider rootRef={rootRef}>
            <ModeChooser />
            <ModeToolbar />
            <PreviewPanel />
          </PrintModeProvider>
        </PresentationModeProvider>
      </PreviewSettingsProvider>
    </div>
  );
}

function renderHarness() {
  return render(
    <MediaContext.Provider value={null}>
      <EditorProvider
        initialMarkdown={'# Print deck\n\nOpening copy.\n\n## Second slide\n\nMore copy.'}
        initialView="preview"
      >
        <Harness />
      </EditorProvider>
    </MediaContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  document.body.classList.remove('squisq-printing');
  vi.restoreAllMocks();
});

describe('print preview mode', () => {
  it('replaces the presentation controls and lays out the complete slideshow at 1, 2, or 9 slides per page', async () => {
    const { container } = renderHarness();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    const shell = screen.getByTestId('shell');
    await waitFor(() => expect(shell.dataset.printPreview).toBe('true'));
    expect(screen.queryByRole('button', { name: /^Present:/ })).toBeNull();
    expect(screen.getByLabelText('Print preview controls')).toBeTruthy();

    await waitFor(() => {
      expect(container.querySelectorAll('.squisq-print-slide-cell').length).toBeGreaterThan(1);
    });
    const slideCount = container.querySelectorAll('.squisq-print-slide-cell').length;
    expect(container.querySelectorAll('.squisq-print-sheet').length).toBe(slideCount);

    fireEvent.click(screen.getByRole('button', { name: '2 slides per page' }));
    expect(container.querySelectorAll('.squisq-print-sheet').length).toBe(
      Math.ceil(slideCount / 2),
    );

    fireEvent.click(screen.getByRole('button', { name: '9 slides per page' }));
    expect(container.querySelectorAll('.squisq-print-sheet').length).toBe(
      Math.ceil(slideCount / 9),
    );

    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('squisq-printing')).toBe(true);
    fireEvent(window, new Event('afterprint'));
    expect(document.body.classList.contains('squisq-printing')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(shell.hasAttribute('data-print-preview')).toBe(false);
    expect(screen.getByRole('button', { name: /^Present:/ })).toBeTruthy();
  });

  it('prints the isolated clean-HTML document when Document mode is active', async () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Document mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    const frame = await screen.findByTestId('plain-html-preview');
    const frameWindow = (frame as HTMLIFrameElement).contentWindow!;
    const print = vi.spyOn(frameWindow, 'print').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('squisq-printing')).toBe(false);
  });
});
