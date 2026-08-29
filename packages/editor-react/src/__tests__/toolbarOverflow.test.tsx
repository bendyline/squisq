/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../EditorContext';
import { Toolbar } from '../Toolbar';

const BUTTON_WIDTH = 30;
// `right > containerRight + 2` is the overflow predicate, so the sixth button
// (right = 180) is the last that fits and the seventh (right = 210) is first out.
const CONTAINER_RIGHT = 200;

function rect(left: number, right: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right,
    top: 0,
    bottom: 0,
    width: right - left,
    height: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/** The buttons the overflow measurement walks, in their laid-out order. */
function measuredButtons(element: Element): HTMLElement[] {
  const container = element.closest('.squisq-toolbar-actions');
  if (!container) return [];
  return [
    ...container.querySelectorAll<HTMLElement>(
      ':scope > .squisq-toolbar-group:not(.squisq-toolbar-contextual) > .squisq-toolbar-button',
    ),
  ];
}

beforeEach(() => {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  }
  // jsdom reports every rect as zero. Lay the buttons out in a row narrower
  // than the group so the measurement has something to overflow.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    if (this.classList.contains('squisq-toolbar-actions')) return rect(0, CONTAINER_RIGHT);
    if (this.classList.contains('squisq-toolbar-button')) {
      const ordinal = measuredButtons(this).indexOf(this as HTMLElement);
      if (ordinal >= 0) return rect(ordinal * BUTTON_WIDTH, (ordinal + 1) * BUTTON_WIDTH);
    }
    return rect(0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function overflowed(name: string): boolean {
  return screen
    .getByRole('button', { name })
    .classList.contains('squisq-toolbar-button--overflowed');
}

describe('<Toolbar> overflow', () => {
  it('hides the inline buttons that the ··· menu now owns', () => {
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
      </EditorProvider>,
    );

    // Six buttons fit: bold, italic, strikethrough, bullet list, numbered
    // list, and Heading 1. Everything after that lives in the ··· menu.
    expect(overflowed('Bold (Ctrl+B)')).toBe(false);
    expect(overflowed('Heading 1')).toBe(false);
    expect(overflowed('Heading 2')).toBe(true);
    expect(overflowed('Blockquote')).toBe(true);
    // The Insert dropdown stands in for the whole media group and follows the
    // same rule — it is offered in the menu, so its inline copy steps aside.
    expect(overflowed('Insert')).toBe(true);

    const trigger = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(trigger);
    const menu = trigger.parentElement!.querySelector<HTMLElement>('.squisq-toolbar-overflow-menu');
    expect(menu).not.toBeNull();
    expect(within(menu!).getByText('Heading 2')).toBeTruthy();
  });

  it('keeps every button inline when they all fit', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ): DOMRect {
      if (this.classList.contains('squisq-toolbar-actions')) return rect(0, 10_000);
      if (this.classList.contains('squisq-toolbar-button')) {
        const ordinal = measuredButtons(this).indexOf(this as HTMLElement);
        if (ordinal >= 0) return rect(ordinal * BUTTON_WIDTH, (ordinal + 1) * BUTTON_WIDTH);
      }
      return rect(0, 0);
    });

    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
      </EditorProvider>,
    );

    expect(overflowed('Heading 2')).toBe(false);
    expect(overflowed('Blockquote')).toBe(false);
    expect(overflowed('Insert')).toBe(false);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});
