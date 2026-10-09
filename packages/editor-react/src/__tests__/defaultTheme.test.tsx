/**
 * @vitest-environment jsdom
 *
 * Host default document theme (`EditorShell` / `PreviewSettingsProvider`
 * `defaultThemeId`): a FALLBACK for documents that name no theme. The
 * document's own theme always wins, an in-session selection wins over both,
 * and while a host default is present the pickers write every concrete
 * choice (the built-in `standard` included) so a document can pin itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { compileTheme } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import { setFrontmatterValues } from '@bendyline/squisq/markdown';
import {
  FRONTMATTER_CUSTOM_THEMES_KEY,
  writeCustomThemesToFrontmatter,
} from '@bendyline/squisq/doc';
import { EditorProvider, useEditorContext } from '../EditorContext';
import {
  PreviewSettingsProvider,
  PreviewToolbarControls,
  usePreviewSettings,
} from '../PreviewControls';
import { DocumentSettingsDialog } from '../DocumentSettingsDialog';
import { CustomThemeProvider, clearThemeLibrary, useDocCustomThemes } from '../customThemes';
import { themeFrontmatterValue } from '../frontmatterSettings';

afterEach(() => {
  cleanup();
  clearThemeLibrary();
});

function ThemeProbe() {
  const s = usePreviewSettings();
  const { markdownSource } = useEditorContext();
  return (
    <>
      <button type="button" onClick={() => s.setSelectedThemeId('standard')}>
        Pick standard
      </button>
      <button type="button" onClick={() => s.setSelectedThemeId('bold')}>
        Pick bold
      </button>
      <button type="button" onClick={() => s.setSelectedThemeId('')}>
        Follow default
      </button>
      <div
        data-testid="theme"
        data-active={s.activeThemeId}
        data-active-name={s.activeTheme.name}
        data-explicit={s.explicitThemeId ?? ''}
        data-inherited={s.inheritedThemeId ?? ''}
        data-label={s.inheritedThemeLabel}
      />
      <pre data-testid="markdown-source">{markdownSource}</pre>
    </>
  );
}

interface HarnessProps {
  defaultThemeId?: string;
  defaultThemeLabel?: string;
  themeOverride?: Theme | null;
  toolbar?: boolean;
}

function Harness({ defaultThemeId, defaultThemeLabel, themeOverride, toolbar }: HarnessProps) {
  const { doc } = useEditorContext();
  const { docThemes, onDocThemesChange } = useDocCustomThemes();
  return (
    <CustomThemeProvider docThemes={docThemes} onDocThemesChange={onDocThemesChange}>
      <PreviewSettingsProvider
        doc={doc}
        defaultThemeId={defaultThemeId}
        defaultThemeLabel={defaultThemeLabel}
        themeOverride={themeOverride}
      >
        {toolbar && <PreviewToolbarControls />}
        <ThemeProbe />
      </PreviewSettingsProvider>
    </CustomThemeProvider>
  );
}

function renderHarness(markdown: string, props: HarnessProps = {}) {
  return render(
    <EditorProvider initialMarkdown={markdown}>
      <Harness {...props} />
    </EditorProvider>,
  );
}

const probe = () => screen.getByTestId('theme');
const source = () => screen.getByTestId('markdown-source').textContent ?? '';

describe('defaultThemeId resolution', () => {
  it('applies the host default when the document names no theme', async () => {
    renderHarness('# Hello', { defaultThemeId: 'warm-earth' });
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('warm-earth'));
    expect(probe().getAttribute('data-active-name')).toBe('Warm Earth');
    expect(probe().getAttribute('data-explicit')).toBe('');
    expect(probe().getAttribute('data-inherited')).toBe('warm-earth');
    expect(probe().getAttribute('data-label')).toBe('Default');
  });

  it("lets the document's own theme win, including legacy keys", async () => {
    renderHarness('---\nsquisq-theme: bold\n---\n\n# Hello', { defaultThemeId: 'warm-earth' });
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('bold'));
    expect(probe().getAttribute('data-explicit')).toBe('bold');
    cleanup();

    renderHarness('---\ntheme: cinematic\n---\n\n# Hello', { defaultThemeId: 'warm-earth' });
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('cinematic'));
    cleanup();

    // An explicit `standard` is a real choice once a host default exists.
    renderHarness('---\nsquisq-theme: standard\n---\n\n# Hello', {
      defaultThemeId: 'warm-earth',
    });
    await waitFor(() => expect(probe().getAttribute('data-explicit')).toBe('standard'));
    expect(probe().getAttribute('data-active')).toBe('standard');
  });

  it('keeps the in-session selection and themeOverride ahead of the default', async () => {
    renderHarness('# Hello', { defaultThemeId: 'warm-earth' });
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('warm-earth'));
    fireEvent.click(screen.getByRole('button', { name: 'Pick bold' }));
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('bold'));
    cleanup();

    const override = compileTheme({ id: 'designer-draft', name: 'Draft' });
    renderHarness('# Hello', { defaultThemeId: 'warm-earth', themeOverride: override });
    expect(probe().getAttribute('data-active')).toBe('designer-draft');
    expect(probe().getAttribute('data-inherited')).toBe('warm-earth');
  });

  it('resolves a custom-theme default and loose built-in spellings', async () => {
    const custom = compileTheme({ id: 'house-style', name: 'House Style' });
    const markdown = setFrontmatterValues('# Hello', {
      [FRONTMATTER_CUSTOM_THEMES_KEY]: writeCustomThemesToFrontmatter([custom]) ?? null,
    });
    renderHarness(markdown, { defaultThemeId: 'house-style' });
    await waitFor(() => expect(probe().getAttribute('data-active-name')).toBe('House Style'));
    expect(probe().getAttribute('data-inherited')).toBe('house-style');
    cleanup();

    renderHarness('# Hello', { defaultThemeId: ' Warm Earth ' });
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('warm-earth'));
  });

  it('falls back to the built-in default for an unknown host id, still as a host default', async () => {
    renderHarness('# Hello', { defaultThemeId: 'no-such-theme' });
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('standard'));
    expect(probe().getAttribute('data-inherited')).toBe('standard');
  });

  it('exposes no inherited theme without a host default', () => {
    renderHarness('# Hello');
    expect(probe().getAttribute('data-active')).toBe('standard');
    expect(probe().getAttribute('data-inherited')).toBe('');
  });

  it('accepts a host label for the inherited entry', () => {
    renderHarness('# Hello', { defaultThemeId: 'bold', defaultThemeLabel: 'Workspace default' });
    expect(probe().getAttribute('data-label')).toBe('Workspace default');
  });
});

describe('theme write semantics', () => {
  it('pure rule: explicit standard only with a host default; "" always removes', () => {
    expect(themeFrontmatterValue('standard', false)).toBeNull();
    expect(themeFrontmatterValue('bold', false)).toBe('bold');
    expect(themeFrontmatterValue('', false)).toBeNull();
    expect(themeFrontmatterValue('standard', true)).toBe('standard');
    expect(themeFrontmatterValue('bold', true)).toBe('bold');
    expect(themeFrontmatterValue('', true)).toBeNull();
  });

  it('writes an explicit standard when a host default exists, and "" clears it', async () => {
    renderHarness('---\ntitle: Hello\n---\n\n# Hello', { defaultThemeId: 'warm-earth' });
    fireEvent.click(screen.getByRole('button', { name: 'Pick standard' }));
    await waitFor(() => expect(source()).toContain('squisq-theme: standard'));
    await waitFor(() => expect(probe().getAttribute('data-explicit')).toBe('standard'));
    expect(probe().getAttribute('data-active')).toBe('standard');

    fireEvent.click(screen.getByRole('button', { name: 'Follow default' }));
    await waitFor(() => expect(source()).not.toContain('squisq-theme'));
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('warm-earth'));
    expect(probe().getAttribute('data-explicit')).toBe('');
    expect(source()).toContain('title: Hello');
  });

  it('keeps removing standard without a host default (unchanged behavior)', async () => {
    renderHarness('---\nsquisq-theme: bold\ntitle: Hello\n---\n\n# Hello');
    await waitFor(() => expect(probe().getAttribute('data-active')).toBe('bold'));
    fireEvent.click(screen.getByRole('button', { name: 'Pick standard' }));
    await waitFor(() => expect(source()).not.toContain('squisq-theme'));
    expect(probe().getAttribute('data-active')).toBe('standard');
  });
});

describe('toolbar theme picker with a host default', () => {
  function withResizeObserver(run: () => Promise<void>) {
    return async () => {
      const original = globalThis.ResizeObserver;
      class ResizeObserverStub implements ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      globalThis.ResizeObserver = ResizeObserverStub;
      try {
        await run();
      } finally {
        if (original) globalThis.ResizeObserver = original;
        else Reflect.deleteProperty(globalThis, 'ResizeObserver');
      }
    };
  }

  function openPicker() {
    fireEvent.click(document.querySelector<HTMLElement>('.squisq-theme-picker-trigger')!);
    return document.querySelector<HTMLElement>('.squisq-theme-picker-popover')!;
  }

  it(
    'labels the inherited entry and pins Standard explicitly',
    withResizeObserver(async () => {
      renderHarness('# Hello', { defaultThemeId: 'warm-earth', toolbar: true });
      const trigger = document.querySelector<HTMLElement>('.squisq-theme-picker-trigger')!;
      expect(trigger.textContent).toContain('Default (Warm Earth)');

      const popover = openPicker();
      const inherited = within(popover).getByRole('option', { name: 'Default (Warm Earth)' });
      expect(inherited.getAttribute('aria-selected')).toBe('true');
      fireEvent.click(within(popover).getByRole('option', { name: 'Standard Light' }));

      await waitFor(() => expect(source()).toContain('squisq-theme: standard'));
      await waitFor(() =>
        expect(document.querySelector('.squisq-theme-picker-trigger')!.textContent).not.toContain(
          'Default',
        ),
      );

      fireEvent.click(within(openPicker()).getByRole('option', { name: 'Default (Warm Earth)' }));
      await waitFor(() => expect(source()).not.toContain('squisq-theme'));
      expect(probe().getAttribute('data-active')).toBe('warm-earth');
    }),
  );

  it(
    'uses the host label and offers no default entry without a host default',
    withResizeObserver(async () => {
      renderHarness('# Hello', {
        defaultThemeId: 'bold',
        defaultThemeLabel: 'Workspace default',
        toolbar: true,
      });
      expect(within(openPicker()).getByRole('option', { name: 'Workspace default (Bold)' }));
      cleanup();

      renderHarness('# Hello', { toolbar: true });
      const popover = openPicker();
      expect(within(popover).queryByRole('option', { name: /^Default/ })).toBeNull();
    }),
  );
});

describe('DocumentSettingsDialog with a host default', () => {
  function openDialog(markdown: string, onSave: (next: string) => void, defaultThemeId?: string) {
    return render(
      <DocumentSettingsDialog
        markdownSource={markdown}
        onSave={onSave}
        onClose={() => {}}
        defaultThemeId={defaultThemeId}
      />,
    );
  }

  function pickTheme(name: string) {
    fireEvent.click(screen.getByLabelText('Theme'));
    const popover = document.querySelector<HTMLElement>('.squisq-theme-picker-popover')!;
    fireEvent.click(within(popover).getByRole('option', { name }));
  }

  function save(onSave: ReturnType<typeof vi.fn>): string {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    return onSave.mock.calls[0]![0] as string;
  }

  it('names the inherited theme for a document with no theme', () => {
    openDialog('# Doc\n', vi.fn(), 'warm-earth');
    expect(screen.getByLabelText('Theme').textContent).toContain('Default (Warm Earth)');
  });

  it('writes an explicit standard', () => {
    const onSave = vi.fn();
    openDialog('# Doc\n', onSave, 'warm-earth');
    pickTheme('Standard Light');
    expect(save(onSave)).toContain('squisq-theme: standard');
  });

  it('keeps an existing explicit standard and canonicalizes its legacy spelling', () => {
    const onSave = vi.fn();
    openDialog('---\ntheme: standard\n---\n\n# Doc\n', onSave, 'warm-earth');
    const next = save(onSave);
    expect(next).toContain('squisq-theme: standard');
    expect(next).not.toMatch(/^theme:/m);
  });

  it('removes the key when the inherited default is chosen', () => {
    const onSave = vi.fn();
    openDialog('---\nsquisq-theme: standard\n---\n\n# Doc\n', onSave, 'warm-earth');
    pickTheme('Default (Warm Earth)');
    expect(save(onSave)).not.toContain('squisq-theme');
  });

  it('still removes standard when the host gives no default', () => {
    const onSave = vi.fn();
    openDialog('---\nsquisq-theme: bold\n---\n\n# Doc\n', onSave);
    pickTheme('Standard Light');
    expect(save(onSave)).not.toContain('squisq-theme');
  });
});
