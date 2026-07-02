/**
 * CustomThemeDialog — the designer modal. Verifies live-preview `onChange`,
 * the two save targets, and that adding an accent yields `colorSchemes`.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomThemeDialog } from '../CustomThemeDialog';

describe('CustomThemeDialog', () => {
  it('edits the name, previews live, and saves a compiled theme to the document', () => {
    const onSave = vi.fn();
    const onChange = vi.fn();
    render(
      <CustomThemeDialog value={null} onChange={onChange} onSave={onSave} onClose={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText('Theme name'), { target: { value: 'Brandy' } });
    expect(onChange).toHaveBeenCalled(); // live preview fired

    fireEvent.click(screen.getByText('Save to document'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [theme, target] = onSave.mock.calls[0];
    expect(target).toBe('doc');
    expect(theme.name).toBe('Brandy');
    expect(theme.schemaVersion).toBe('1');
    expect(theme.id).toMatch(/^custom-/);
  });

  it('saves to the library via the library button', () => {
    const onSave = vi.fn();
    render(<CustomThemeDialog value={null} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Save to library'));
    expect(onSave.mock.calls[0][1]).toBe('library');
  });

  it('adding an accent produces colorSchemes in the compiled theme', () => {
    const onSave = vi.fn();
    render(<CustomThemeDialog value={null} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByText('+ Add accent'));
    fireEvent.click(screen.getByText('Save to document'));
    const theme = onSave.mock.calls[0][0];
    expect(Object.keys(theme.colorSchemes).length).toBeGreaterThan(0);
  });
});
