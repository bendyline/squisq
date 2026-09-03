/**
 * @vitest-environment jsdom
 *
 * Focus inside a data-card grid suppresses the formatting toolbar: the grid
 * owns the user's selection, but toolbar commands would still apply to the
 * editor's remembered caret (H1 retargeting the sheet's owning heading).
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../EditorContext';
import { Toolbar } from '../Toolbar';

beforeEach(() => {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  }
});

async function settleFocus(): Promise<void> {
  // The toolbar defers its focus check by a tick (focusout timing).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
  });
}

describe('<Toolbar> data-card focus suppression', () => {
  it('disables formatting while focus is inside a data card, restores after', async () => {
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
      </EditorProvider>,
    );

    // A stand-in grid cell inside a data card, plus ordinary prose focus.
    const card = document.createElement('div');
    card.className = 'squisq-data-card';
    const cell = document.createElement('input');
    card.appendChild(cell);
    document.body.appendChild(card);
    const prose = document.createElement('input');
    document.body.appendChild(prose);

    const bold = screen.getByRole('button', { name: 'Bold (Ctrl+B)' }) as HTMLButtonElement;
    const h1 = screen.getByRole('button', { name: 'Heading 1' }) as HTMLButtonElement;
    const insert = screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement;
    expect(bold.disabled).toBe(false);

    await act(async () => cell.focus());
    await settleFocus();
    expect(bold.disabled).toBe(true);
    expect(h1.disabled).toBe(true);
    expect(insert.disabled).toBe(true);
    expect(bold.getAttribute('data-tooltip')).toMatch(/click into the prose/);

    await act(async () => prose.focus());
    await settleFocus();
    expect(bold.disabled).toBe(false);
    expect(h1.disabled).toBe(false);
    expect(insert.disabled).toBe(false);

    card.remove();
    prose.remove();
  });

  it('suppression is sticky when focus falls to <body> (cell editor closing)', async () => {
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
      </EditorProvider>,
    );
    const card = document.createElement('div');
    card.className = 'squisq-data-card';
    const cell = document.createElement('input');
    card.appendChild(cell);
    document.body.appendChild(card);
    const prose = document.createElement('input');
    document.body.appendChild(prose);
    const bold = screen.getByRole('button', { name: 'Bold (Ctrl+B)' }) as HTMLButtonElement;

    await act(async () => cell.focus());
    await settleFocus();
    expect(bold.disabled).toBe(true);

    // Committing a cell edit unmounts the input → focus drops on <body>.
    // The grid still owns the selection: formatting must STAY suppressed.
    await act(async () => cell.blur());
    await settleFocus();
    expect(document.activeElement).toBe(document.body);
    expect(bold.disabled).toBe(true);

    // Only actually entering another surface re-enables.
    await act(async () => prose.focus());
    await settleFocus();
    expect(bold.disabled).toBe(false);

    card.remove();
    prose.remove();
  });
});
