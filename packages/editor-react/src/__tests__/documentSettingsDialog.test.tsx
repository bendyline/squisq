import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DocumentSettingsDialog } from '../DocumentSettingsDialog';
import type { PageTemplateSettings } from '../pageTemplates';

afterEach(() => cleanup());

function open(source: string, onSave: (next: string) => void) {
  return render(
    <DocumentSettingsDialog markdownSource={source} onSave={onSave} onClose={() => {}} />,
  );
}

function clickSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

/**
 * Open the Theme picker popover and click the theme whose row title
 * matches `name`. The picker is portaled to `document.body`, so the
 * listbox lives outside the dialog form — testing-library's `screen`
 * still finds it because it queries the whole document.
 */
function pickTheme(name: string) {
  // Trigger button has aria-label "Theme"
  fireEvent.click(screen.getByLabelText('Theme'));
  // Scope the option lookup to the popover — the Transform <select> in
  // the same dialog also exposes role="option" entries (one of which is
  // literally "Documentary"), so a global query would collide.
  const popover = document.querySelector<HTMLElement>('.squisq-theme-picker-popover')!;
  fireEvent.click(within(popover).getByRole('option', { name }));
}

describe('DocumentSettingsDialog', () => {
  it('shows the inferred title as the placeholder when no title in frontmatter', () => {
    const onSave = vi.fn();
    open('# My Document\n\nBody.', onSave);
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('My Document');
  });

  it('does not write title when input is left empty', () => {
    const onSave = vi.fn();
    open('# My Document\n\nBody.', onSave);
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).not.toMatch(/^---[\s\S]*title:/);
  });

  it('does not write title when value matches the inferred title', () => {
    const onSave = vi.fn();
    open('# My Document\n\nBody.', onSave);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My Document' } });
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).not.toMatch(/^---[\s\S]*title:/);
  });

  it('strips an existing title key when the user clears the input', () => {
    const onSave = vi.fn();
    const src = '---\ntitle: Old\n---\n\n# My Document\n';
    open(src, onSave);
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    expect(input.value).toBe('Old');
    fireEvent.change(input, { target: { value: '' } });
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).not.toMatch(/title:/);
  });

  it('writes a title that differs from the inferred value', () => {
    const onSave = vi.fn();
    open('# My Document\n\nBody.', onSave);
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Custom Title' },
    });
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).toMatch(/^---\ntitle: Custom Title\n---/);
  });

  it('shows the inferred cover subtitle as the placeholder', () => {
    const onSave = vi.fn();
    open('# My Document\n\nAn inferred subtitle.\n\n## Section\n\nBody.', onSave);

    const input = screen.getByLabelText('Subtitle') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('An inferred subtitle.');
  });

  it('reads and writes an explicit document subtitle', () => {
    const onSave = vi.fn();
    open('---\nsubtitle: Existing line\n---\n\n# Doc\n\nFallback line.', onSave);

    const input = screen.getByLabelText('Subtitle') as HTMLInputElement;
    expect(input.value).toBe('Existing line');
    fireEvent.change(input, { target: { value: 'Edited cover line' } });
    clickSave();

    const next = onSave.mock.calls[0][0] as string;
    expect(next).toContain('subtitle: Edited cover line');
  });

  it('removes the explicit subtitle when the field is cleared', () => {
    const onSave = vi.fn();
    open('---\nsubtitle: Existing line\n---\n\n# Doc\n\nFallback line.', onSave);

    fireEvent.change(screen.getByLabelText('Subtitle'), { target: { value: '' } });
    clickSave();

    const next = onSave.mock.calls[0][0] as string;
    expect(next).not.toMatch(/^subtitle:/m);
  });

  it('does not store a subtitle that matches the inferred cover text', () => {
    const onSave = vi.fn();
    open('# Doc\n\nFallback line.', onSave);

    fireEvent.change(screen.getByLabelText('Subtitle'), { target: { value: 'Fallback line.' } });
    clickSave();

    const next = onSave.mock.calls[0][0] as string;
    expect(next).not.toMatch(/^subtitle:/m);
  });

  it('writes squisq-theme when the user picks a theme', () => {
    const onSave = vi.fn();
    open('# Doc\n', onSave);
    pickTheme('Documentary');
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).toContain('squisq-theme: documentary');
  });

  it('clears the legacy theme key when switching themes', () => {
    const onSave = vi.fn();
    const src = '---\ntheme: bold\n---\n\n# Doc\n';
    open(src, onSave);
    pickTheme('Documentary');
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).toContain('squisq-theme: documentary');
    expect(next).not.toMatch(/^theme:/m);
  });

  it('reads themeId and canonicalizes both legacy theme keys on save', () => {
    const onSave = vi.fn();
    const src = '---\nthemeId: bold\ntheme: cinematic\n---\n\n# Doc\n';
    open(src, onSave);

    expect(screen.getByLabelText('Theme').textContent).toContain('Bold');
    clickSave();

    const next = onSave.mock.calls[0][0] as string;
    expect(next).toContain('squisq-theme: bold');
    expect(next).not.toMatch(/^themeId:/m);
    expect(next).not.toMatch(/^theme:/m);
  });

  it('removes squisq-theme when reverting to default', () => {
    const onSave = vi.fn();
    const src = '---\nsquisq-theme: documentary\n---\n\n# Doc\n';
    open(src, onSave);
    pickTheme('Default');
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).not.toContain('squisq-theme');
  });

  it('removes explicit managed defaults and their legacy aliases on save', () => {
    const onSave = vi.fn();
    const src = `---
squisq-theme: standard
themeId: standard
theme: standard
squisq-captions: standard
caption-style: standard
author: Keep
---

# Doc
`;
    open(src, onSave);
    clickSave();

    const next = onSave.mock.calls[0][0] as string;
    expect(next).not.toMatch(/^(?:squisq-theme|themeId|theme):/m);
    expect(next).not.toMatch(/^(?:squisq-captions|caption-style):/m);
    expect(next).toContain('author: Keep');
  });

  it('writes squisq-transform when a transform is picked', () => {
    const onSave = vi.fn();
    open('# Doc\n', onSave);
    const select = screen.getByLabelText('Transform') as HTMLSelectElement;
    // Pick any non-empty option from the dropdown
    const first = Array.from(select.options).find((o) => o.value !== '');
    if (!first) throw new Error('no transform options available');
    fireEvent.change(select, { target: { value: first.value } });
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).toContain(`squisq-transform: ${first.value}`);
  });

  it('canonicalizes a stored dataDriven transform id', () => {
    const onSave = vi.fn();
    open('---\ntransform-style: dataDriven\n---\n\n# Doc\n', onSave);

    const select = screen.getByLabelText('Transform') as HTMLSelectElement;
    expect(select.value).toBe('data-driven');
    clickSave();

    const next = onSave.mock.calls[0][0] as string;
    expect(next).toContain('squisq-transform: data-driven');
    expect(next).not.toContain('dataDriven');
    expect(next).not.toContain('transform-style');
  });

  it('writes squisq-captions when picked', () => {
    const onSave = vi.fn();
    open('# Doc\n', onSave);
    fireEvent.change(screen.getByLabelText('Captions'), { target: { value: 'social' } });
    clickSave();
    const next = onSave.mock.calls[0][0] as string;
    expect(next).toContain('squisq-captions: social');
  });

  it('sets the Write view’s styling from the theme on Save, outside the document', () => {
    const onSave = vi.fn();
    const onEditorStylingChange = vi.fn();
    render(
      <DocumentSettingsDialog
        markdownSource="# Doc"
        onSave={onSave}
        onClose={() => {}}
        editorStyling="fonts"
        onEditorStylingChange={onEditorStylingChange}
      />,
    );
    const editor = screen.getByRole('group', { name: 'Editor' });
    const styling = within(editor).getByLabelText<HTMLSelectElement>('Editor styling from theme');
    expect(styling.value).toBe('fonts');
    fireEvent.change(styling, { target: { value: 'fonts-colors' } });
    expect(onEditorStylingChange).not.toHaveBeenCalled();

    clickSave();
    expect(onEditorStylingChange).toHaveBeenCalledWith('fonts-colors');
    // A personal preference: the document itself is untouched.
    expect(onSave).toHaveBeenCalledWith('# Doc');
  });

  it('leaves the editor styling alone when unchanged, and hides it without a handler', () => {
    const onEditorStylingChange = vi.fn();
    render(
      <DocumentSettingsDialog
        markdownSource="# Doc"
        onSave={() => {}}
        onClose={() => {}}
        editorStyling="none"
        onEditorStylingChange={onEditorStylingChange}
      />,
    );
    clickSave();
    expect(onEditorStylingChange).not.toHaveBeenCalled();
    cleanup();

    open('# Doc\n', () => {});
    expect(screen.queryByLabelText('Editor styling from theme')).toBeNull();
  });

  it('closes when the Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<DocumentSettingsDialog markdownSource="# Doc" onSave={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to the H2 when no H1 exists', () => {
    const onSave = vi.fn();
    open('## Subtitle\n\nBody.', onSave);
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    expect(input.placeholder).toBe('Subtitle');
  });
});

describe('DocumentSettingsDialog page template', () => {
  const templates: PageTemplateSettings = {
    listTemplates: async () => [
      { value: '/_templates/post.html', label: '_templates/post.html' },
      { value: '/_templates/page.html', label: '_templates/page.html' },
    ],
    defaultLabel: 'Workspace default (_templates/post.html)',
  };

  function openWithTemplates(
    source: string,
    onSave: (next: string) => void,
    pageTemplates: PageTemplateSettings | null = templates,
  ) {
    return render(
      <DocumentSettingsDialog
        markdownSource={source}
        onSave={onSave}
        onClose={() => {}}
        pageTemplates={pageTemplates}
      />,
    );
  }

  it('is offered only when the host renders through page templates', () => {
    open('# Doc\n', () => {});
    expect(screen.queryByLabelText('Page template')).toBeNull();
  });

  it('lists the host templates after the default and None', async () => {
    openWithTemplates('# Doc\n', () => {});
    const select = screen.getByLabelText('Page template') as HTMLSelectElement;
    await screen.findByRole('option', { name: '_templates/post.html' });
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Workspace default (_templates/post.html)',
      'None',
      '_templates/post.html',
      '_templates/page.html',
    ]);
    expect(select.value).toBe('');
  });

  it('writes the chosen template, None, or removes the key for the default', async () => {
    for (const [choice, expected] of [
      ['/_templates/page.html', 'squisq-output-template: /_templates/page.html'],
      ['none', 'squisq-output-template: none'],
    ] as const) {
      const onSave = vi.fn();
      openWithTemplates('# Doc\n', onSave);
      await screen.findByRole('option', { name: '_templates/page.html' });
      fireEvent.change(screen.getByLabelText('Page template'), { target: { value: choice } });
      clickSave();
      expect(onSave.mock.calls[0][0]).toContain(expected);
      cleanup();
    }

    const onSave = vi.fn();
    openWithTemplates('---\nsquisq-output-template: none\n---\n# Doc\n', onSave);
    expect((screen.getByLabelText('Page template') as HTMLSelectElement).value).toBe('none');
    fireEvent.change(screen.getByLabelText('Page template'), { target: { value: '' } });
    clickSave();
    expect(onSave.mock.calls[0][0]).not.toContain('squisq-output-template');
  });

  it('keeps an authored path the host does not list, untouched on save', async () => {
    const onSave = vi.fn();
    const source = '---\nsquisq-output-template: ../layouts/custom.html\n---\n# Doc\n';
    openWithTemplates(source, onSave);
    await screen.findByRole('option', { name: '_templates/post.html' });
    const select = screen.getByLabelText('Page template') as HTMLSelectElement;
    expect(select.value).toBe('../layouts/custom.html');
    clickSave();
    expect(onSave.mock.calls[0][0]).toContain('squisq-output-template: ../layouts/custom.html');
  });

  it('calls the only choice None when no default applies, and reports listing errors', async () => {
    openWithTemplates('# Doc\n', () => {}, {
      listTemplates: async () => {
        throw new Error('offline');
      },
    });
    const select = screen.getByLabelText('Page template') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['None']);
    expect((await screen.findByRole('alert')).textContent).toContain('offline');
  });
});

describe('DocumentSettingsDialog properties', () => {
  const SOURCE = [
    '---',
    'author: Ines',
    'squisq-theme: gezellig',
    'tags:',
    '  - harbor',
    '  - silt',
    'description: Notes',
    '---',
    '',
    '# Survey',
    '',
  ].join('\n');

  function propertiesGroup() {
    return screen.getByRole('group', { name: 'Properties' });
  }

  it('lists only the document’s own keys', () => {
    open(SOURCE, vi.fn());
    const names = within(propertiesGroup())
      .getAllByRole('textbox', { name: 'Property name' })
      .map((input) => (input as HTMLInputElement).value);
    expect(names).toEqual(['author', 'tags', 'description']);
    expect(
      (
        within(propertiesGroup()).getByRole('textbox', {
          name: 'Value of tags',
        }) as HTMLInputElement
      ).value,
    ).toBe('harbor, silt');
  });

  it('shows only the Add button for a document without properties', () => {
    open('# Doc\n', vi.fn());
    expect(within(propertiesGroup()).queryAllByRole('textbox')).toEqual([]);
    expect(within(propertiesGroup()).getByRole('button', { name: '+ Add property' })).toBeTruthy();
  });

  it('leaves untouched properties byte-identical', () => {
    const onSave = vi.fn();
    open(SOURCE, onSave);
    clickSave();
    expect(onSave.mock.calls[0][0]).toBe(SOURCE);
  });

  it('adds, renames in place, edits a list and deletes in one Save', () => {
    const onSave = vi.fn();
    open(SOURCE, onSave);
    const group = propertiesGroup();
    fireEvent.change(within(group).getByRole('textbox', { name: 'Value of tags' }), {
      target: { value: 'harbor, silt, storms' },
    });
    const [author] = within(group).getAllByRole('textbox', { name: 'Property name' });
    fireEvent.change(author, { target: { value: 'writer' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Delete property description' }));
    fireEvent.click(within(group).getByRole('button', { name: '+ Add property' }));
    const names = within(group).getAllByRole('textbox', { name: 'Property name' });
    const added = names[names.length - 1];
    expect(document.activeElement).toBe(added);
    fireEvent.change(added, { target: { value: 'draft' } });
    fireEvent.change(within(group).getByRole('textbox', { name: 'Value of draft' }), {
      target: { value: 'true' },
    });
    clickSave();
    expect(onSave.mock.calls[0][0]).toBe(
      [
        '---',
        'writer: Ines',
        'squisq-theme: gezellig',
        'tags:',
        '  - harbor',
        '  - silt',
        '  - storms',
        'draft: true',
        '---',
        '',
        '# Survey',
        '',
      ].join('\n'),
    );
  });

  it('writes settings and properties together', () => {
    const onSave = vi.fn();
    open('# Doc\n', onSave);
    fireEvent.change(screen.getByLabelText('Captions'), { target: { value: 'social' } });
    fireEvent.click(within(propertiesGroup()).getByRole('button', { name: '+ Add property' }));
    fireEvent.change(within(propertiesGroup()).getByRole('textbox', { name: 'Property name' }), {
      target: { value: 'author' },
    });
    fireEvent.change(within(propertiesGroup()).getByRole('textbox', { name: 'Value of author' }), {
      target: { value: 'Ines' },
    });
    clickSave();
    expect(onSave.mock.calls[0][0]).toBe(
      '---\nsquisq-captions: social\nauthor: Ines\n---\n# Doc\n',
    );
  });

  it('refuses to save a duplicate or managed name, and says why', () => {
    const onSave = vi.fn();
    open(SOURCE, onSave);
    const group = propertiesGroup();
    fireEvent.click(within(group).getByRole('button', { name: '+ Add property' }));
    const names = within(group).getAllByRole('textbox', { name: 'Property name' });
    fireEvent.change(names[names.length - 1], { target: { value: 'author' } });
    expect(names[names.length - 1].getAttribute('aria-invalid')).toBe('true');
    expect(group.textContent).toContain('already a property named “author”');
    clickSave();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(names[names.length - 1], { target: { value: 'title' } });
    expect(group.textContent).toContain('“title” is a document setting');
    clickSave();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('asks for a name only once Save is tried', () => {
    const onSave = vi.fn();
    open('# Doc\n', onSave);
    const group = propertiesGroup();
    fireEvent.click(within(group).getByRole('button', { name: '+ Add property' }));
    fireEvent.change(within(group).getByRole('textbox', { name: 'Value of new property' }), {
      target: { value: 'orphan' },
    });
    expect(group.textContent).not.toContain('Give this property a name');
    clickSave();
    expect(onSave).not.toHaveBeenCalled();
    expect(group.textContent).toContain('Give this property a name');
    expect(document.activeElement).toBe(
      within(group).getByRole('textbox', { name: 'Property name' }),
    );
  });

  it('drops a row that was added but never filled in', () => {
    const onSave = vi.fn();
    open('# Doc\n', onSave);
    fireEvent.click(within(propertiesGroup()).getByRole('button', { name: '+ Add property' }));
    clickSave();
    expect(onSave.mock.calls[0][0]).toBe('# Doc\n');
  });
});
