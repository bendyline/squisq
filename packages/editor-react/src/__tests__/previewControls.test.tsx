/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { compileTheme } from '@bendyline/squisq/schemas';
import { EditorProvider, useEditorContext } from '../EditorContext';
import {
  PreviewModeSwitch,
  PreviewSettingsProvider,
  PreviewToolbarControls,
  usePreviewSettings,
} from '../PreviewControls';
import {
  clearThemeLibrary,
  CustomThemeProvider,
  saveLibraryTheme,
  useDocCustomThemes,
} from '../customThemes';

function ModeProbe() {
  const { activeDisplayMode, activeThemeId, activeTransformStyle } = usePreviewSettings();
  return (
    <div
      data-testid="active-mode"
      data-theme-id={activeThemeId}
      data-transform-style={activeTransformStyle}
    >
      {activeDisplayMode}
    </div>
  );
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

function PreviewToolbarHarness() {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <PreviewToolbarControls />
    </PreviewSettingsProvider>
  );
}

function LibraryThemeProbe() {
  const { activeTheme, setSelectedThemeId } = usePreviewSettings();
  const { markdownSource } = useEditorContext();
  return (
    <>
      <button type="button" onClick={() => setSelectedThemeId('library-theme')}>
        Select library theme
      </button>
      <div data-testid="active-theme-name">{activeTheme.name}</div>
      <pre data-testid="markdown-source">{markdownSource}</pre>
    </>
  );
}

function LibraryThemeHarness() {
  const { doc } = useEditorContext();
  const { docThemes, onDocThemesChange } = useDocCustomThemes();
  return (
    <CustomThemeProvider docThemes={docThemes} onDocThemesChange={onDocThemesChange}>
      <PreviewSettingsProvider doc={doc}>
        <LibraryThemeProbe />
      </PreviewSettingsProvider>
    </CustomThemeProvider>
  );
}

function renderPreviewControls(markdown: string) {
  render(
    <EditorProvider initialMarkdown={markdown}>
      <PreviewHarness />
    </EditorProvider>,
  );
}

function renderPreviewToolbar(markdown: string) {
  render(
    <EditorProvider initialMarkdown={markdown}>
      <PreviewToolbarHarness />
    </EditorProvider>,
  );
}

afterEach(() => {
  cleanup();
  clearThemeLibrary();
});

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

  it('uses the shared squisq-theme, themeId, theme fallback order', async () => {
    renderPreviewControls('---\nthemeId: bold\ntheme: cinematic\n---\n\n# Hello');

    await waitFor(() => {
      expect(screen.getByTestId('active-mode').getAttribute('data-theme-id')).toBe('bold');
    });
  });

  it('canonicalizes the stored dataDriven transform id', async () => {
    renderPreviewControls('---\nsquisq-transform: dataDriven\n---\n\n# Hello');

    await waitFor(() => {
      expect(screen.getByTestId('active-mode').getAttribute('data-transform-style')).toBe(
        'data-driven',
      );
    });
  });

  it('copies a selected browser-library theme into the document atomically', async () => {
    saveLibraryTheme(
      compileTheme({
        id: 'library-theme',
        name: 'Library Theme',
        seedColors: { primary: '#456789' },
      }),
    );
    render(
      <EditorProvider initialMarkdown="# Hello">
        <LibraryThemeHarness />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select library theme' }));

    await waitFor(() => {
      expect(screen.getByTestId('active-theme-name').textContent).toBe('Library Theme');
      const source = screen.getByTestId('markdown-source').textContent ?? '';
      expect(source).toContain('squisq-theme: library-theme');
      expect(source).toContain('squisq-custom-themes:');
      expect(source).toContain('library-theme');
    });
  });
});

describe('PreviewToolbarControls', () => {
  it('keeps the overflow popover inside the left viewport edge', async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    );

    class ResizeObserverStub implements ResizeObserver {
      readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback([], this);
      }

      unobserve() {}

      disconnect() {}
    }

    globalThis.ResizeObserver = ResizeObserverStub;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList.contains('squisq-preview-controls-popover')) {
        return new DOMRect(0, 0, 220, 240);
      }
      if (this.getAttribute('aria-label') === 'More preview settings') {
        return new DOMRect(6, 20, 28, 28);
      }
      if (this.classList.contains('squisq-preview-control')) {
        return new DOMRect(0, 0, 100, 24);
      }
      return new DOMRect(0, 0, 0, 0);
    };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList.contains('squisq-preview-controls') ? 40 : 0;
      },
    });

    try {
      renderPreviewToolbar('# Hello');

      fireEvent.click(await screen.findByRole('button', { name: 'More preview settings' }));

      await waitFor(() => {
        const popover = document.querySelector<HTMLElement>('.squisq-preview-controls-popover');
        expect(popover).not.toBeNull();
        expect(popover?.style.left).toBe('8px');
      });
    } finally {
      if (originalResizeObserver) {
        globalThis.ResizeObserver = originalResizeObserver;
      } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
      }
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
      }
    }
  });
});
