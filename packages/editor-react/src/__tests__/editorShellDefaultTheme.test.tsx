/**
 * @vitest-environment jsdom
 *
 * `<EditorShell defaultThemeId>` must reach the ONE theme resolution point
 * (`PreviewSettingsProvider`) so the Write surface (whose `themeInheritance`
 * mirroring reads `activeTheme`) and the Use/Play surface agree. The heavy
 * surfaces are stubbed with probes that read the preview settings they get.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { usePreviewSettings, usePreviewSettingsOptional } from '../PreviewControls';

vi.mock('../RawEditor', () => ({
  RawEditor: () => <div data-testid="raw-editor-stub" />,
}));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: function WysiwygThemeProbe() {
    const settings = usePreviewSettingsOptional();
    return <div data-testid="write-theme">{settings?.activeTheme.id ?? 'none'}</div>;
  },
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: function PreviewThemeProbe() {
    const { activeTheme } = usePreviewSettings();
    return <div data-testid="use-theme">{activeTheme.id}</div>;
  },
}));

import { EditorShell } from '../EditorShell';

beforeEach(() => {
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

describe('<EditorShell defaultThemeId>', () => {
  it('renders the Write surface with the host default when the document has no theme', async () => {
    render(<EditorShell initialMarkdown="# Hello" defaultThemeId="warm-earth" />);
    await waitFor(() => expect(screen.getByTestId('write-theme').textContent).toBe('warm-earth'));
  });

  it("renders the Use surface with the document's own theme over the host default", async () => {
    render(
      <EditorShell
        initialMarkdown={'---\nsquisq-theme: bold\n---\n\n# Hello'}
        initialView="preview"
        defaultThemeId="warm-earth"
      />,
    );
    await waitFor(() => expect(screen.getByTestId('use-theme').textContent).toBe('bold'));
  });

  it('renders the Use surface with the host default when the document has no theme', async () => {
    render(<EditorShell initialMarkdown="# Hello" initialView="preview" defaultThemeId="bold" />);
    await waitFor(() => expect(screen.getByTestId('use-theme').textContent).toBe('bold'));
  });

  it('keeps the built-in default without a host default', async () => {
    render(<EditorShell initialMarkdown="# Hello" />);
    await waitFor(() => expect(screen.getByTestId('write-theme').textContent).toBe('standard'));
  });
});
