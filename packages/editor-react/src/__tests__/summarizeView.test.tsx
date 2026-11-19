/**
 * @vitest-environment jsdom
 *
 * Write › Summarize: the Write tab's mode for choosing how slides and video
 * summarize the document. It takes the Write surface's place (which stays
 * mounted behind it, so its changes stay undoable), offers None, the built-in
 * styles and Custom, writes the choice to `squisq-transform`, and shows either
 * the host's Custom designer or the slides the chosen style makes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

vi.mock('../RawEditor', () => ({
  RawEditor: () => <div data-testid="raw-editor-stub" />,
}));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg-editor-stub" />,
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="preview-stub" />,
}));

import { EditorShell, type EditorShellProps } from '../EditorShell';

const TWO_SECTIONS = '# One\n\nThe first section.\n\n## Two\n\nThe second section.\n';

beforeEach(() => {
  if (typeof window.matchMedia !== 'function') {
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

afterEach(cleanup);

/** Renders the shell and reports each source it emits. */
function renderShell(props: Partial<EditorShellProps> = {}) {
  const sources: string[] = [];
  render(
    <EditorShell
      initialMarkdown={TWO_SECTIONS}
      allowRecording={false}
      onChange={(source) => sources.push(source)}
      {...props}
    />,
  );
  return { latest: () => sources[sources.length - 1] ?? '' };
}

function openSummarize() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose Write mode' }));
  const menu = screen.getByRole('menu', { name: 'Write mode' });
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Summarize' }));
  return screen.getByRole('region', { name: 'Summarize' });
}

function styleNames(view: HTMLElement): string[] {
  return within(view)
    .getAllByRole('radio')
    .map((radio) => radio.getAttribute('aria-labelledby'))
    .map((id) => document.getElementById(id!)?.textContent ?? '');
}

describe('Write › Summarize', () => {
  it('takes the Write surface’s place, keeping the editor mounted behind it', () => {
    renderShell();
    const view = openSummarize();

    expect(screen.getByRole('tab', { name: 'Summarize' }).getAttribute('data-view')).toBe(
      'wysiwyg',
    );
    // The editor stays mounted, hidden, so the view's edits stay undoable there.
    const editor = screen.getByTestId('wysiwyg-editor-stub');
    expect(editor.closest('[hidden]')).not.toBeNull();
    expect(view.hidden).toBe(false);
    // Nothing on the toolbar may act on the hidden editor.
    expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  });

  it('offers None, the built-in styles, and Custom, and writes the choice', async () => {
    const { latest } = renderShell();
    const view = openSummarize();

    const names = styleNames(view);
    expect(names[0]).toBe('None');
    expect(names[names.length - 1]).toBe('Custom');
    expect(names).toEqual(expect.arrayContaining(['Minimal', 'Narrative', 'Documentary']));
    expect(names).not.toContain('Dynamic slides');
    expect(within(view).getByRole<HTMLInputElement>('radio', { name: 'None' }).checked).toBe(true);

    fireEvent.click(within(view).getByRole('radio', { name: 'Minimal' }));
    await waitFor(() => expect(latest()).toMatch(/^squisq-transform: minimal$/m));
    expect(within(view).getByRole<HTMLInputElement>('radio', { name: 'Minimal' }).checked).toBe(
      true,
    );

    fireEvent.click(within(view).getByRole('radio', { name: 'Custom' }));
    await waitFor(() => expect(latest()).toMatch(/^squisq-transform: dynamic-slides$/m));

    // None is the default, so it removes the key rather than writing it.
    fireEvent.click(within(view).getByRole('radio', { name: 'None' }));
    await waitFor(() => expect(latest()).not.toMatch(/squisq-transform/));
    expect(latest()).toContain('The second section.');
  });

  it('shows the slides the chosen style makes', async () => {
    renderShell();
    const view = openSummarize();
    const slides = await within(view).findByRole('list', { name: 'Slides' });
    await waitFor(() => expect(within(slides).getAllByRole('listitem').length).toBe(2));
    expect(within(slides).getByRole('img', { name: /^Slide 1/ })).toBeTruthy();
    expect(within(view).getByRole('status').textContent).toBe('2 slides');
  });

  it('shows the host’s designer for Custom, and the slides for every other style', async () => {
    renderShell({
      initialMarkdown: `---\nsquisq-transform: dynamic-slides\n---\n\n${TWO_SECTIONS}`,
      summarizationDesigner: <div data-testid="designer">Custom designer</div>,
    });
    const view = openSummarize();

    expect(within(view).getByRole<HTMLInputElement>('radio', { name: 'Custom' }).checked).toBe(
      true,
    );
    expect(within(view).getByTestId('designer')).toBeTruthy();
    expect(within(view).queryByRole('list', { name: 'Slides' })).toBeNull();

    fireEvent.click(within(view).getByRole('radio', { name: 'Narrative' }));
    await waitFor(() => expect(within(view).queryByTestId('designer')).toBeNull());
    expect(await within(view).findByRole('list', { name: 'Slides' })).toBeTruthy();
  });

  it('previews Custom’s slides when the host has no designer', async () => {
    renderShell({
      initialMarkdown: `---\nsquisq-transform: dynamic-slides\n---\n\n${TWO_SECTIONS}`,
    });
    const view = openSummarize();
    const slides = await within(view).findByRole('list', { name: 'Slides' });
    await waitFor(() => expect(within(slides).getAllByRole('listitem').length).toBeGreaterThan(0));
  });

  it('keeps the designer mounted while Use is open', () => {
    function CountingDesigner() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((n) => n + 1)}>
          Pressed {count}
        </button>
      );
    }
    renderShell({
      initialMarkdown: `---\nsquisq-transform: dynamic-slides\n---\n\n${TWO_SECTIONS}`,
      summarizationDesigner: <CountingDesigner />,
    });
    const view = openSummarize();
    fireEvent.click(within(view).getByRole('button', { name: 'Pressed 0' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Slideshow' }));
    expect(view.hidden).toBe(true);
    expect(view.isConnected).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Summarize' }));
    expect(view.hidden).toBe(false);
    expect(within(view).getByRole('button', { name: 'Pressed 1' })).toBeTruthy();
  });

  it('offers the choice read-only when the editor is read-only', () => {
    renderShell({ readOnly: true });
    const view = openSummarize();
    // The fieldset disables its radios; their own `disabled` stays unset.
    for (const radio of within(view).getAllByRole<HTMLInputElement>('radio')) {
      expect(radio.matches(':disabled')).toBe(true);
    }
  });
});
