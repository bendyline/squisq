/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { compileTheme } from '@bendyline/squisq/schemas';
import { EditorProvider, useEditorContext } from '../EditorContext';
import {
  PreviewModeSwitch,
  PreviewSettingsProvider,
  PreviewToolbarControls,
  usePreviewSettings,
} from '../PreviewControls';
import { Toolbar } from '../Toolbar';
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

function UseTabHarness() {
  const { activeView, doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <Toolbar />
      <ModeProbe />
      <div data-testid="active-view">{activeView}</div>
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

function CoverSlideProbe() {
  const { activeCoverSlide, setCoverSlideEnabled } = usePreviewSettings();
  const { markdownSource } = useEditorContext();
  return (
    <>
      <button type="button" onClick={() => setCoverSlideEnabled(false)}>
        Hide cover slide
      </button>
      <button type="button" onClick={() => setCoverSlideEnabled(true)}>
        Use default cover slide
      </button>
      <div data-testid="active-cover-slide">{String(activeCoverSlide)}</div>
      <pre data-testid="markdown-source">{markdownSource}</pre>
    </>
  );
}

function CoverSlideHarness() {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <CoverSlideProbe />
    </PreviewSettingsProvider>
  );
}

function ManagedDefaultsProbe() {
  const {
    activeThemeId,
    activeTransformStyle,
    activeCaptionStyle,
    activeCaptionsEnabled,
    setSelectedThemeId,
    setSelectedTransformStyle,
    setCaptionMode,
  } = usePreviewSettings();
  const { markdownSource } = useEditorContext();
  return (
    <>
      <button type="button" onClick={() => setSelectedThemeId('standard')}>
        Use default theme
      </button>
      <button type="button" onClick={() => setSelectedTransformStyle('')}>
        Use default transform
      </button>
      <button type="button" onClick={() => setCaptionMode('standard')}>
        Use default captions
      </button>
      <div
        data-testid="managed-defaults"
        data-theme={activeThemeId}
        data-transform={activeTransformStyle}
        data-caption-style={activeCaptionStyle}
        data-captions-enabled={String(activeCaptionsEnabled)}
      />
      <pre data-testid="markdown-source">{markdownSource}</pre>
    </>
  );
}

function ManagedDefaultsHarness() {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <ManagedDefaultsProbe />
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

    expect(labels).toEqual(['Slideshow', 'Video', 'Page', 'Document', 'Narrate']);
    expect(screen.getByTestId('active-mode').textContent).toBe('slideshow');

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

describe('cover-slide frontmatter', () => {
  it('writes the non-default as a boolean and removes the default value', async () => {
    render(
      <EditorProvider initialMarkdown="# Hello">
        <CoverSlideHarness />
      </EditorProvider>,
    );

    expect(screen.getByTestId('active-cover-slide').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Hide cover slide' }));

    await waitFor(() => {
      const source = screen.getByTestId('markdown-source').textContent ?? '';
      expect(source).toContain('squisq-cover-slide: false');
      expect(source).not.toContain('squisq-cover-slide: "false"');
    });
    expect(screen.getByTestId('active-cover-slide').textContent).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Use default cover slide' }));

    await waitFor(() => {
      const source = screen.getByTestId('markdown-source').textContent ?? '';
      expect(source).not.toContain('squisq-cover-slide');
      expect(source).not.toContain('---');
    });
    expect(screen.getByTestId('active-cover-slide').textContent).toBe('true');
  });

  it('removes a legacy cover-slide override when restoring the default', async () => {
    render(
      <EditorProvider initialMarkdown={'---\ncover-slide: false\ntitle: Hello\n---\n\n# Hello'}>
        <CoverSlideHarness />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-cover-slide').textContent).toBe('false');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use default cover slide' }));

    await waitFor(() => {
      const source = screen.getByTestId('markdown-source').textContent ?? '';
      expect(source).not.toContain('cover-slide');
      expect(source).toContain('title: Hello');
    });
    expect(screen.getByTestId('active-cover-slide').textContent).toBe('true');
  });
});

describe('managed preview-setting defaults', () => {
  it('removes default theme, transform, and caption values plus their legacy aliases', async () => {
    const markdown = `---
squisq-theme: documentary
themeId: bold
theme: cinematic
squisq-transform: documentary
transform-style: magazine
squisq-captions: social
caption-style: off
title: Hello
---

# Hello`;
    render(
      <EditorProvider initialMarkdown={markdown}>
        <ManagedDefaultsHarness />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use default theme' }));
    await waitFor(() => {
      const source = screen.getByTestId('markdown-source').textContent ?? '';
      expect(source).not.toMatch(/^(?:squisq-theme|themeId|theme):/m);
    });
    expect(screen.getByTestId('managed-defaults').getAttribute('data-theme')).toBe('standard');

    fireEvent.click(screen.getByRole('button', { name: 'Use default transform' }));
    await waitFor(() => {
      const source = screen.getByTestId('markdown-source').textContent ?? '';
      expect(source).not.toMatch(/^(?:squisq-transform|transform-style):/m);
    });
    expect(screen.getByTestId('managed-defaults').getAttribute('data-transform')).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Use default captions' }));
    await waitFor(() => {
      const source = screen.getByTestId('markdown-source').textContent ?? '';
      expect(source).not.toMatch(/^(?:squisq-captions|caption-style):/m);
      expect(source).toContain('title: Hello');
    });
    const defaults = screen.getByTestId('managed-defaults');
    expect(defaults.getAttribute('data-caption-style')).toBe('standard');
    expect(defaults.getAttribute('data-captions-enabled')).toBe('true');
  });
});

describe('PreviewToolbarControls', () => {
  it('presents transforms as summarization without implying the source is changed', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverStub implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    globalThis.ResizeObserver = ResizeObserverStub;
    try {
      renderPreviewToolbar('# Hello');

      const summarizeLabels = screen.getAllByText('Summarize:');
      expect(summarizeLabels.length).toBeGreaterThan(0);
      for (const label of summarizeLabels) {
        expect(label.getAttribute('title')).toBe(
          'Extract and summarize content for presentation with these Use modes. Your underlying content is not changed.',
        );
      }
      expect(screen.queryByText('Transform:')).toBeNull();
      expect(document.querySelector('[role="group"][aria-label="Display mode"]')).toBeNull();
      expect(document.querySelector('[role="group"][aria-label="Aspect ratio"]')).not.toBeNull();
    } finally {
      if (originalResizeObserver) {
        globalThis.ResizeObserver = originalResizeObserver;
      } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
      }
    }
  });

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

describe('Use tab mode menu', () => {
  it('lists the Use modes beside the tab and selects a mode without a toolbar radio group', () => {
    render(
      <EditorProvider initialMarkdown="# Hello" initialView="wysiwyg" allowRecording={false}>
        <UseTabHarness />
      </EditorProvider>,
    );

    const useTab = screen.getByRole('tab', { name: 'Slideshow' });
    expect(screen.queryByRole('tab', { name: 'Use' })).toBeNull();
    const tabGroup = useTab.parentElement;
    expect(tabGroup).not.toBeNull();
    expect(within(tabGroup!).getByRole('button', { name: 'Choose Use mode' })).toBeTruthy();

    // The first click enters Use; once active, clicking the tab again opens
    // the mode menu.
    fireEvent.click(useTab);
    expect(screen.getByTestId('active-view').textContent).toBe('preview');
    expect(screen.queryByRole('menu', { name: 'Use mode' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Slideshow' }));

    const menu = screen.getByRole('menu', { name: 'Use mode' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.querySelector('.squisq-use-mode-menu-label')?.textContent),
    ).toEqual(['Slideshow', 'Video', 'Page', 'Document', 'Narrate']);
    const slideshowItem = within(menu).getByRole('menuitemradio', { name: 'Slideshow' });
    expect(slideshowItem.getAttribute('aria-checked')).toBe('true');
    expect(within(slideshowItem).getByText('Present designed slides one at a time.')).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Document' }));
    expect(screen.getByTestId('active-mode').textContent).toBe('page');
    expect(screen.getByTestId('active-view').textContent).toBe('preview');
    expect(screen.getByRole('tab', { name: 'Document' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Use mode' })).toBeNull();
  });
});

describe('Narrate mode gating', () => {
  function renderWithNarrateGate(markdown: string, allowNarrate: boolean) {
    render(
      <EditorProvider initialMarkdown={markdown} allowNarrate={allowNarrate}>
        <PreviewHarness />
      </EditorProvider>,
    );
  }

  it('selects narrate from the switch and resolves teleprompter frontmatter aliases', async () => {
    renderPreviewControls('# Hello');
    fireEvent.click(screen.getByRole('button', { name: 'Narrate' }));
    expect(screen.getByTestId('active-mode').textContent).toBe('narrate');

    cleanup();
    renderPreviewControls('---\ndisplay-mode: teleprompter\n---\n\n# Hello');
    await waitFor(() => {
      expect(screen.getByTestId('active-mode').textContent).toBe('narrate');
    });
    expect(screen.getByRole('button', { name: 'Narrate' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('allowNarrate=false hides the button and clamps frontmatter-forced narrate to video', async () => {
    renderWithNarrateGate('---\ndisplay-mode: narrate\n---\n\n# Hello', false);

    expect(screen.queryByRole('button', { name: 'Narrate' })).toBeNull();
    // Give the frontmatter parse a tick, then confirm the clamp held.
    await waitFor(() => {
      expect(screen.getByTestId('active-mode').textContent).toBe('video');
    });
  });

  it('allowNarrate=true (default) honors frontmatter narrate', async () => {
    renderWithNarrateGate('---\ndisplay-mode: narrate\n---\n\n# Hello', true);
    await waitFor(() => {
      expect(screen.getByTestId('active-mode').textContent).toBe('narrate');
    });
  });
});
