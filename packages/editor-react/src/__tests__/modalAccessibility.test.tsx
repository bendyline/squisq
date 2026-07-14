import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkDialog } from '../LinkDialog';

function LinkDialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open link dialog
      </button>
      {open && (
        <LinkDialog
          mode="insert"
          initialText=""
          initialUrl=""
          onConfirm={vi.fn()}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

describe('editor modal accessibility', () => {
  it('labels and isolates the dialog, traps focus, and restores the opener', () => {
    render(<LinkDialogHarness />);
    const opener = screen.getByRole('button', { name: 'Open link dialog' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Insert link' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(opener.inert).toBe(true);
    expect(screen.getByPlaceholderText('Link caption')).toBe(document.activeElement);

    const submit = screen.getByRole('button', { name: 'Insert' });
    submit.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toBe(document.activeElement);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener.inert).toBe(false);
    expect(opener).toBe(document.activeElement);
  });
});
