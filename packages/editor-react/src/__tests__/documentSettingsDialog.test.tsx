import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DocumentSettingsDialog } from '../DocumentSettingsDialog';

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
