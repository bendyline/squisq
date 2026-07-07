/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewModeSwitch, PreviewSettingsProvider, usePreviewSettings } from '../PreviewControls';

function ModeProbe() {
  const { activeDisplayMode } = usePreviewSettings();
  return <div data-testid="active-mode">{activeDisplayMode}</div>;
}

function PreviewHarness() {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <PreviewModeSwitch />
      <ModeProbe />
    </PreviewSettingsProvider>
  );
}

function renderPreviewControls(markdown: string) {
  render(
    <EditorProvider initialMarkdown={markdown}>
      <PreviewHarness />
    </EditorProvider>,
  );
}

afterEach(() => cleanup());

describe('PreviewModeSwitch', () => {
  it('labels the plain document preview as Document and the styled view as Page', () => {
    renderPreviewControls('# Hello');

    const labels = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter(Boolean);

    expect(labels).toEqual(['Video', 'Slideshow', 'Page', 'Document']);

    fireEvent.click(screen.getByRole('button', { name: 'Document' }));
    expect(screen.getByTestId('active-mode').textContent).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: 'Page' }));
    expect(screen.getByTestId('active-mode').textContent).toBe('linear');
  });

  it('maps product-facing display-mode frontmatter to the correct renderer values', async () => {
    renderPreviewControls('---\ndisplay-mode: document\n---\n\n# Hello');

    await waitFor(() => {
      expect(screen.getByTestId('active-mode').textContent).toBe('page');
    });
    expect(screen.getByRole('button', { name: 'Document' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    cleanup();
    renderPreviewControls('---\ndisplay-mode: page\n---\n\n# Hello');

    await waitFor(() => {
      expect(screen.getByTestId('active-mode').textContent).toBe('linear');
    });
    expect(screen.getByRole('button', { name: 'Page' }).getAttribute('aria-pressed')).toBe('true');
  });
});
