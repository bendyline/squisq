/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../EditorContext';
import { Toolbar } from '../Toolbar';

const BUTTON_WIDTH = 30;
const ROW_HEIGHT = 28;
// jsdom has no stylesheet, so gaps and separators measure zero and every
// button is BUTTON_WIDTH wide. The ··· trigger has no width of its own here,
// so the measurement reserves the narrowest known item for it: with a 200px
// lane five buttons fit (5 × 30 + 30 = 180) and a sixth does not.
const DEFAULT_LANE_WIDTH = 200;

function rect(left: number, right: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right,
    top: 0,
    bottom: ROW_HEIGHT,
    width: right - left,
    height: ROW_HEIGHT,
    toJSON: () => ({}),
  } as DOMRect;
}

const EMPTY_RECT = { ...rect(0, 0), bottom: 0, height: 0 } as DOMRect;

/** The lane's buttons, in their laid-out order. */
function laneButtons(element: Element): HTMLElement[] {
  const container = element.closest('.squisq-toolbar-actions');
  if (!container) return [];
  return [
    ...container.querySelectorAll<HTMLElement>(
      ':scope > .squisq-toolbar-group:not(.squisq-toolbar-contextual) > .squisq-toolbar-button',
    ),
  ];
}

/**
 * Lay the lane out `laneWidth` wide with its buttons in a row. Chrome buttons
 * listed in `chromeOnRow` (data-toolbar-item ids) share that row; every other
 * element reports an empty rect, as jsdom does.
 */
function layOut(laneWidth: number, chromeOnRow: readonly string[] = []): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    if (this.classList.contains('squisq-toolbar-actions')) return rect(0, laneWidth);
    const chromeId = this.getAttribute('data-toolbar-item');
    if (
      chromeId &&
      chromeOnRow.includes(chromeId) &&
      this.parentElement?.matches('.squisq-toolbar')
    ) {
      return rect(laneWidth, laneWidth + BUTTON_WIDTH);
    }
    if (this.classList.contains('squisq-toolbar-button')) {
      const ordinal = laneButtons(this).indexOf(this as HTMLElement);
      if (ordinal >= 0) return rect(ordinal * BUTTON_WIDTH, (ordinal + 1) * BUTTON_WIDTH);
    }
    return EMPTY_RECT;
  });
}

beforeEach(() => {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  }
  layOut(DEFAULT_LANE_WIDTH);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function overflowed(name: string): boolean {
  return screen
    .getByRole('button', { name, hidden: true })
    .classList.contains('squisq-toolbar-button--overflowed');
}

function openOverflowMenu(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  fireEvent.click(trigger);
  const menu = trigger.parentElement!.querySelector<HTMLElement>('.squisq-toolbar-overflow-menu');
  expect(menu).not.toBeNull();
  return menu!;
}

function renderToolbar() {
  render(
    <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
      <Toolbar />
    </EditorProvider>,
  );
}

describe('<Toolbar> overflow', () => {
  it('keeps Insert and the core formatting inline, collapsing the rest by priority', () => {
    renderToolbar();

    // Insert, Bold, Italic, Bullet list and Heading 1 are the five that fit.
    expect(overflowed('Insert')).toBe(false);
    expect(overflowed('Bold (Ctrl+B)')).toBe(false);
    expect(overflowed('Italic (Ctrl+I)')).toBe(false);
    expect(overflowed('Bullet list')).toBe(false);
    expect(overflowed('Heading 1')).toBe(false);
    for (const name of [
      'Strikethrough',
      'Numbered list',
      'Heading 2',
      'Heading 3',
      'Blockquote',
      'Inline code',
      'Superscript (Ctrl+.)',
      'Subscript (Ctrl+,)',
      'Horizontal rule',
    ]) {
      expect(overflowed(name), name).toBe(true);
    }

    const menu = openOverflowMenu();
    expect(within(menu).getByText('Heading 2')).toBeTruthy();
    expect(within(menu).getByText('Superscript (Ctrl+.)')).toBeTruthy();
    // Insert is still inline, so the menu does not repeat it.
    expect(within(menu).queryByText('Insert...')).toBeNull();
  });

  it('drops Subscript and Superscript before anything else', () => {
    // Twelve of the fourteen lane buttons fit beside the ··· trigger.
    layOut(12 * BUTTON_WIDTH + BUTTON_WIDTH);
    renderToolbar();

    expect(overflowed('Subscript (Ctrl+,)')).toBe(true);
    expect(overflowed('Superscript (Ctrl+.)')).toBe(true);
    expect(overflowed('Inline code')).toBe(false);
    expect(overflowed('Horizontal rule')).toBe(false);
    expect(overflowed('Insert')).toBe(false);
  });

  it('hides a group whose buttons have all collapsed, separator included', () => {
    renderToolbar();

    const blockquote = screen.getByRole('button', { name: 'Blockquote', hidden: true });
    expect(blockquote.closest('.squisq-toolbar-group')!.classList).toContain(
      'squisq-toolbar-group--collapsed',
    );
    const bold = screen.getByRole('button', { name: 'Bold (Ctrl+B)' });
    expect(bold.closest('.squisq-toolbar-group')!.classList).not.toContain(
      'squisq-toolbar-group--collapsed',
    );
  });

  it('collapses document chrome on the same row before lists and headings', () => {
    // The two chrome buttons hand their 60px to the lane when they collapse.
    layOut(DEFAULT_LANE_WIDTH, ['layouts', 'docSettings']);
    renderToolbar();

    expect(overflowed('Custom layouts')).toBe(true);
    expect(overflowed('Document settings')).toBe(true);
    expect(overflowed('Numbered list')).toBe(false);
    expect(overflowed('Heading 2')).toBe(false);
    expect(overflowed('Insert')).toBe(false);

    const menu = openOverflowMenu();
    fireEvent.click(within(menu).getByText('Document settings'));
    expect(screen.getByRole('dialog', { name: /document settings/i })).toBeTruthy();
  });

  it('leaves chrome that sits on another row alone', () => {
    // No chrome on the lane's row: collapsing it would not widen the lane.
    renderToolbar();

    expect(overflowed('Custom layouts')).toBe(false);
    expect(overflowed('Document settings')).toBe(false);
  });

  it('moves Insert into the menu only when nothing else is left to collapse', () => {
    layOut(BUTTON_WIDTH);
    renderToolbar();

    expect(overflowed('Bold (Ctrl+B)')).toBe(true);
    expect(overflowed('Insert')).toBe(true);
    const menu = openOverflowMenu();
    expect(within(menu).getByText('Insert...')).toBeTruthy();
  });

  it('keeps every button inline when they all fit', () => {
    layOut(10_000);
    renderToolbar();

    expect(overflowed('Heading 2')).toBe(false);
    expect(overflowed('Blockquote')).toBe(false);
    expect(overflowed('Insert')).toBe(false);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});
