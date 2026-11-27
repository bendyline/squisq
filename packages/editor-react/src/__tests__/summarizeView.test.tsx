/**
 * @vitest-environment jsdom
 *
 * Edit › Summaries: the Write tab's mode for choosing how slides and video
 * summarize the document. It takes the Write surface's place (which stays
 * mounted behind it, so its changes stay undoable), offers None, Custom and the
 * built-in styles from the Summary style dropdown, writes the choice to
 * `squisq-transform`, and shows either the host's Custom designer or the slides
 * the chosen style makes.
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
const FACTS = [
  '# Results',
  '',
  'Revenue grew 40% in 2025, the best year since 1999. Most of it came from new customers in the north. "We doubled the team," said the founder.',
  '',
  '## Next',
  '',
  'We open three new offices in March 2026 and hire forty people across the regions. Sales should reach $12 million by 2027.',
].join('\n');

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
  chooseView('Summaries');
  return screen.getByRole('region', { name: 'Summaries' });
}

/** Chooses a view from the View menu, whatever view is on screen. */
function chooseView(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /^View: / }));
  const menu = screen.getByRole('menu', { name: 'View' });
  fireEvent.click(within(menu).getByRole('menuitemradio', { name }));
}

/** The Summary style dropdown, named for the field and the style it shows. */
function styleTrigger(view: HTMLElement, style = /.*/): HTMLButtonElement {
  return within(view).getByRole<HTMLButtonElement>('button', {
    name: new RegExp(`^Summary style ${style.source}$`),
  });
}

/** Opens the Summary style list, which is portaled to the body. */
function openStyles(view: HTMLElement): HTMLElement {
  fireEvent.click(styleTrigger(view));
  return screen.getByRole('listbox', { name: 'Summary style' });
}

function chooseStyle(view: HTMLElement, name: string) {
  fireEvent.click(within(openStyles(view)).getByRole('option', { name }));
}

/** Each group of slides in the deck, by the block (or addition) it names. */
function groupNames(deck: HTMLElement): string[] {
  return within(deck)
    .getAllByRole('group')
    .map((group) => document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent!);
}

function nameOf(element: Element): string {
  return document.getElementById(element.getAttribute('aria-labelledby')!)?.textContent ?? '';
}

describe('Edit › Summaries', () => {
  it('takes the Write surface’s place, keeping the editor mounted behind it', () => {
    renderShell();
    const view = openSummarize();

    expect(
      screen.getByRole('button', { name: 'View: Summaries' }).getAttribute('data-active-view'),
    ).toBe('wysiwyg');
    // The editor stays mounted, hidden, so the view's edits stay undoable there.
    const editor = screen.getByTestId('wysiwyg-editor-stub');
    expect(editor.closest('[hidden]')).not.toBeNull();
    expect(view.hidden).toBe(false);
    // Nothing on the toolbar may act on the hidden editor.
    expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  });

  it('offers None, Custom, and the built-in styles from a dropdown, and writes the choice', async () => {
    const { latest } = renderShell();
    const view = openSummarize();

    // The trigger names the chosen style; beside it is what that style does,
    // as the list says for each.
    const trigger = styleTrigger(view, /None/);
    expect(trigger.textContent).toBe('None');
    const described = document.getElementById(trigger.getAttribute('aria-describedby')!)!;
    expect(described.textContent).toBe('Each section is one slide, shown as you wrote it');
    expect(described.className).toBe('squisq-summarize-style-note');
    const list = openStyles(view);
    const options = within(list).getAllByRole('option');
    const names = options.map(nameOf);
    expect(names.slice(0, 2)).toEqual(['None', 'Custom']);
    expect(names).toEqual(expect.arrayContaining(['Minimal', 'Narrative', 'Documentary']));
    expect(names).not.toContain('Dynamic slides');
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(
      names.map((name) => String(name === 'None')),
    );
    for (const option of options)
      expect(
        document.getElementById(option.getAttribute('aria-describedby')!)?.textContent,
      ).toBeTruthy();

    fireEvent.click(within(list).getByRole('option', { name: 'Minimal' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(latest()).toMatch(/^squisq-transform: minimal$/m));
    expect(styleTrigger(view, /Minimal/)).toBeTruthy();

    chooseStyle(view, 'Custom');
    await waitFor(() => expect(latest()).toMatch(/^squisq-transform: dynamic-slides$/m));

    // None is the default, so it removes the key rather than writing it.
    chooseStyle(view, 'None');
    await waitFor(() => expect(latest()).not.toMatch(/squisq-transform/));
    expect(latest()).toContain('The second section.');
  });

  it('opens from the keyboard on the chosen style, moves with the arrows, and closes', async () => {
    const { latest } = renderShell();
    const view = openSummarize();
    const trigger = styleTrigger(view, /None/);

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox', { name: 'Summary style' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Focus lands once the list is shown; a browser will not focus a hidden one.
    expect(list.style.visibility).toBe('visible');
    expect(nameOf(document.activeElement!)).toBe('None');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(nameOf(document.activeElement!)).toBe('Custom');
    fireEvent.keyDown(list, { key: 'End' });
    fireEvent.keyDown(list, { key: 'Home' });
    expect(nameOf(document.activeElement!)).toBe('None');

    // Escape closes without choosing, and gives focus back to the field.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(latest()).not.toMatch(/squisq-transform/);

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    fireEvent.click(document.activeElement!);
    await waitFor(() => expect(latest()).toMatch(/^squisq-transform: dynamic-slides$/m));
    expect(document.activeElement).toBe(styleTrigger(view, /Custom/));
  });

  it('shows the slides the chosen style makes, beside the block each came from', async () => {
    renderShell();
    const view = openSummarize();
    const slides = await within(view).findByRole('group', { name: 'Slides' });
    await waitFor(() => expect(within(slides).getAllByRole('listitem').length).toBe(2));
    expect(within(slides).getByRole('img', { name: /^Slide 1/ })).toBeTruthy();
    expect(within(view).getByRole('status').textContent).toBe('2 slides');
    expect(groupNames(slides)).toEqual(['One 1 slide', 'Two 1 slide']);
  });

  it('groups a style’s slides by block, and sets apart the slides it adds', async () => {
    renderShell({ initialMarkdown: `---\nsquisq-transform: narrative\n---\n\n${FACTS}` });
    const view = openSummarize();
    const slides = await within(view).findByRole('group', { name: 'Slides' });
    // A section header and a dated event from Next, then the closing title.
    await waitFor(() =>
      expect(groupNames(slides)).toEqual(['Next 2 slides', 'Document title 1 slide']),
    );
    const groups = within(slides).getAllByRole('group');
    expect(groups.map((group) => group.hasAttribute('data-added'))).toEqual([false, true]);
    // Numbered through the deck, not within each group.
    expect(within(groups[1]!).getByRole('img').getAttribute('aria-label')).toMatch(/^Slide 3/);
  });

  it('shows the host’s designer for Custom, and the slides for every other style', async () => {
    renderShell({
      initialMarkdown: `---\nsquisq-transform: dynamic-slides\n---\n\n${TWO_SECTIONS}`,
      summarizationDesigner: <div data-testid="designer">Custom designer</div>,
    });
    const view = openSummarize();

    expect(styleTrigger(view, /Custom/)).toBeTruthy();
    expect(within(view).getByTestId('designer')).toBeTruthy();
    expect(within(view).queryByRole('group', { name: 'Slides' })).toBeNull();

    chooseStyle(view, 'Narrative');
    await waitFor(() => expect(within(view).queryByTestId('designer')).toBeNull());
    expect(await within(view).findByRole('group', { name: 'Slides' })).toBeTruthy();
  });

  it('designs Custom with the built-in designer when the host supplies none', async () => {
    renderShell({
      initialMarkdown: `---\nsquisq-transform: dynamic-slides\n---\n\n${TWO_SECTIONS}`,
    });
    const view = openSummarize();
    const designer = await within(view).findByRole('region', { name: 'Summarization designer' });
    const list = await within(designer).findByRole('navigation', { name: 'Presentation slides' });
    await waitFor(() => expect(within(list).getAllByRole('button').length).toBeGreaterThan(0));
    expect(within(view).queryByRole('group', { name: 'Slides' })).toBeNull();
    // With no assistant there is no AI to offer.
    expect(within(designer).queryByRole('button', { name: 'Suggest with AI' })).toBeNull();
    // One designer: the view names it, and the designer inside is not a second one.
    expect(within(view).getAllByRole('region', { name: 'Summarization designer' })).toHaveLength(1);
  });

  it('puts the designer’s controls on the Summary style’s row', async () => {
    const { latest } = renderShell({
      initialMarkdown: `---\nsquisq-transform: dynamic-slides\n---\n\n${TWO_SECTIONS}`,
      summarizationAssistant: { readiness: () => null, suggestSlides: async () => undefined },
    });
    const view = openSummarize();
    const designer = await within(view).findByRole('region', { name: 'Summarization designer' });
    const length = await within(designer).findByRole<HTMLSelectElement>('combobox', {
      name: 'Summary length',
    });
    const style = styleTrigger(view, /Custom/);
    const row = style.closest('.squisq-summarize-controls')!;
    // The style, the length, supporting slides, and the actions, in that order.
    const controls = [
      style,
      length,
      within(designer).getByRole('checkbox', { name: 'Add supporting slides' }),
      within(designer).getByRole('button', { name: 'Reset design' }),
      await within(designer).findByRole('button', { name: 'Suggest with AI' }),
    ];
    for (const control of controls) expect(row.contains(control)).toBe(true);
    for (let at = 1; at < controls.length; at++)
      expect(
        controls[at - 1]!.compareDocumentPosition(controls[at]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    // On a shared row the style is one line: what it does is its tooltip, and
    // still describes it.
    expect(style.textContent).toBe('Custom');
    expect(style.title).toMatch(/^Concise slides and diagrams/);
    expect(document.getElementById(style.getAttribute('aria-describedby')!)!.textContent).toBe(
      style.title,
    );
    // They are still the designer's controls: a choice there changes the design.
    fireEvent.change(length, { target: { value: 'section' } });
    await waitFor(() => expect(latest()).toMatch(/^squisq-summary-density: section$/m));

    // Another style has the row to itself, with what it does beside it, and
    // focus stays on the dropdown that chose it.
    style.focus();
    chooseStyle(view, 'Minimal');
    await waitFor(() =>
      expect(within(view).queryByRole('combobox', { name: 'Summary length' })).toBeNull(),
    );
    const minimal = styleTrigger(view, /Minimal/);
    expect(minimal).toBe(style);
    expect(document.activeElement).toBe(minimal);
    expect(minimal.title).toBe('');
    expect(within(view).queryByRole('region', { name: 'Summarization designer' })).toBeNull();
  });

  it('lends the host’s assistant to the built-in designer', async () => {
    renderShell({
      initialMarkdown: `---\nsquisq-transform: dynamic-slides\n---\n\n${TWO_SECTIONS}`,
      summarizationAssistant: { readiness: () => null, suggestSlides: async () => undefined },
    });
    const view = openSummarize();
    const suggest = await within(view).findByRole<HTMLButtonElement>('button', {
      name: 'Suggest with AI',
    });
    await waitFor(() => expect(suggest.disabled).toBe(false));
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

    chooseView('Slideshow');
    expect(view.hidden).toBe(true);
    expect(view.isConnected).toBe(true);

    chooseView('Summaries');
    expect(view.hidden).toBe(false);
    expect(within(view).getByRole('button', { name: 'Pressed 1' })).toBeTruthy();
  });

  it('offers the choice read-only when the editor is read-only', () => {
    renderShell({ readOnly: true });
    const view = openSummarize();
    const trigger = styleTrigger(view, /None/);
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
