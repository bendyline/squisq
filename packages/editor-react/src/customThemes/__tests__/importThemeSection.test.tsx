/**
 * ImportThemeSection — the "infer theme from a file" affordance. Verifies the
 * draft patch handed to hosts, error handling, drop-type gating, and that a
 * designer save with imported layouts writes theme + selection + templates in
 * a single frontmatter update.
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CustomTemplateDefinition, Theme } from '@bendyline/squisq/schemas';
import { compileTheme } from '@bendyline/squisq/schemas';
import { ImportThemeSection } from '../ImportThemeSection';
import { draftPatchFromImportedTheme } from '../themeDraft';
import { EditorProvider, useEditorContext } from '../../EditorContext';
import { PreviewSettingsProvider, usePreviewSettings } from '../../PreviewControls';

const { inferMock } = vi.hoisted(() => ({ inferMock: vi.fn() }));
vi.mock('@bendyline/squisq-formats/infer', () => ({ inferThemeFromFile: inferMock }));

afterEach(() => {
  cleanup();
  inferMock.mockReset();
});

const importedTheme: Theme = compileTheme({
  id: 'custom-deck',
  name: 'Deck',
  seedColors: { primary: '#4472c4', background: '#fdfdf8', text: '#1a1a2e' },
  typography: {
    titleFont: { stackId: 'playfair' },
    bodyFont: { custom: { name: 'Aptos', fallback: 'sans-serif' } },
  },
  colorSchemes: { accent1: { bg: '#101020', text: '#e2e8f0', accent: '#4472c4' } },
});

const importedLayout: CustomTemplateDefinition = {
  name: 'pptx-two-content',
  label: 'Two Content',
  viewport: { width: 1920, height: 1080 },
  layers: [
    {
      id: 'title',
      type: 'text',
      position: { x: '5%', y: '10%', width: '90%', height: '20%' },
      content: { text: '{title}', style: { fontSize: 88, color: '#111111' } },
    },
  ],
};

function pickFile(name = 'deck.pptx'): void {
  const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], name);
  fireEvent.change(screen.getByLabelText('Import theme from file'), {
    target: { files: [file] },
  });
}

describe('ImportThemeSection', () => {
  it('imports a theme and hands the host a draft patch + layouts', async () => {
    inferMock.mockResolvedValue({
      theme: importedTheme,
      extraction: { sourceFormat: 'pptx', colorMap: { bg1: 'lt1', tx1: 'dk1' }, warnings: [] },
      layouts: [importedLayout],
      warnings: ['theme: accent4 color could not be resolved; dropped'],
    });
    const onImported = vi.fn();
    render(<ImportThemeSection allowLayouts onImported={onImported} />);

    pickFile();
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));

    expect(inferMock).toHaveBeenCalledWith(expect.anything(), {
      inferLayouts: true,
      nameHint: 'deck',
    });

    const [patch, result] = onImported.mock.calls[0]!;
    expect(patch.name).toBe('Deck');
    expect(patch.seeds.primary).toBe('#4472c4');
    expect(patch.accentsEdited).toBe(true);
    expect(patch.accents).toEqual([{ key: 'accent1', color: '#4472c4' }]);
    expect(patch.titleFont).toEqual({ kind: 'curated', stackId: 'playfair' });
    expect(patch.bodyFont).toEqual({
      kind: 'custom',
      customName: 'Aptos',
      customFallback: 'sans-serif',
    });
    // The patch never touches base or style presets.
    expect('baseId' in patch).toBe(false);
    expect('borderRadius' in patch).toBe(false);

    expect(result.layouts).toHaveLength(1);
    expect(result.fileName).toBe('deck.pptx');
    expect(screen.getByText(/1 slide layout/)).toBeTruthy();
    expect(screen.getByText(/accent4/)).toBeTruthy();
  });

  it('shows the inference error and never fires onImported', async () => {
    inferMock.mockRejectedValue(new Error('No theme part found in this file.'));
    const onImported = vi.fn();
    render(<ImportThemeSection onImported={onImported} />);

    pickFile();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('No theme part found'),
    );
    expect(onImported).not.toHaveBeenCalled();
  });

  it('rejects unsupported file types dropped on the zone', async () => {
    const onImported = vi.fn();
    const { container } = render(<ImportThemeSection onImported={onImported} />);
    const zone = container.querySelector('.squisq-theme-import-drop')!;
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(['x'], 'notes.txt')] },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Only .docx, .pptx, or .xlsx'),
    );
    expect(inferMock).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });
});

describe('draftPatchFromImportedTheme', () => {
  it('carries seeds/fonts/accents and nothing else', () => {
    const patch = draftPatchFromImportedTheme(importedTheme);
    expect(Object.keys(patch).sort()).toEqual([
      'accents',
      'accentsEdited',
      'bodyFont',
      'name',
      'seeds',
      'titleFont',
    ]);
    expect(patch.seeds).toMatchObject({ primary: '#4472c4', background: '#fdfdf8' });
  });
});

// ── Designer save with imported layouts → single frontmatter write ───

function DesignerSaveHarness() {
  const settings = usePreviewSettings();
  const { markdownSource } = useEditorContext();
  return (
    <div>
      <button type="button" onClick={() => settings.openThemeDesigner(null)}>
        open designer
      </button>
      <button
        type="button"
        onClick={() =>
          settings.themeDesigner?.onSave(importedTheme, 'doc', { templates: [importedLayout] })
        }
      >
        save with layouts
      </button>
      <pre data-testid="markdown-source">{markdownSource}</pre>
    </div>
  );
}

function HarnessRoot() {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <DesignerSaveHarness />
    </PreviewSettingsProvider>
  );
}

describe('theme designer save with imported layouts', () => {
  it('writes theme payload, selection, and templates in one frontmatter update', async () => {
    render(
      <EditorProvider initialMarkdown={'# Hello\n\nBody.\n'}>
        <HarnessRoot />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByText('open designer'));
    fireEvent.click(screen.getByText('save with layouts'));

    await waitFor(() => {
      const source = screen.getByTestId('markdown-source').textContent ?? '';
      expect(source).toContain('squisq-theme: custom-deck');
      expect(source).toContain('squisq-custom-themes');
      expect(source).toContain('squisq-custom-templates');
      expect(source).toContain('pptx-two-content');
    });
  });
});
