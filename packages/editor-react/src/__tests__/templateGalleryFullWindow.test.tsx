import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateBadgePopover } from '../TemplatePicker';
import { FULL_WINDOW_DIALOG_QUERY, safeAreaPadding } from '../dialogLayout';

/**
 * On a phone-sized window the block type gallery fills the whole window, so its
 * header can run up under the status bar; elsewhere it covers the editor shell
 * it was opened from. A host shell laid out below the status bar would
 * otherwise leave that strip showing above the dialog.
 */

const anchorRect = new DOMRect(20, 80, 80, 24);
const originalElementsFromPoint = document.elementsFromPoint;
const originalMatchMedia = window.matchMedia;
let shell: HTMLElement;

function emulateWindow(fillsWindow: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: fillsWindow && query === FULL_WINDOW_DIALOG_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function gallery(): HTMLElement {
  render(
    <TemplateBadgePopover anchorRect={anchorRect} value="" onChange={vi.fn()} onClose={vi.fn()} />,
  );
  const dialog = document.querySelector<HTMLElement>('.squisq-template-gallery-dialog');
  expect(dialog).not.toBeNull();
  return dialog!;
}

beforeEach(() => {
  // The editor shell sits below a 60px status bar, as a host app lays it out.
  shell = document.createElement('div');
  shell.className = 'squisq-editor-shell';
  shell.getBoundingClientRect = () =>
    new DOMRect(0, 60, window.innerWidth, window.innerHeight - 60);
  document.body.append(shell);
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [shell],
  });
});

afterEach(() => {
  cleanup();
  shell.remove();
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: originalElementsFromPoint,
  });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
});

describe('block type gallery placement', () => {
  it('covers the editor shell it was opened from on a wide window', () => {
    emulateWindow(false);
    const dialog = gallery();
    expect(dialog.style.top).toBe('60px');
    expect(dialog.style.height).toBe(`${window.innerHeight - 60}px`);
  });

  it('fills the whole window, status bar strip included, on a phone-sized one', () => {
    emulateWindow(true);
    const dialog = gallery();
    expect(dialog.style.top).toBe('0px');
    expect(dialog.style.left).toBe('0px');
    expect(dialog.style.width).toBe(`${window.innerWidth}px`);
    expect(dialog.style.height).toBe(`${window.innerHeight}px`);
  });
});

describe('safe-area padding for inline-styled modals', () => {
  it('keeps the margin beyond the host-published insets, falling back to the browser', () => {
    const padding = safeAreaPadding(24);
    const sides = padding.split(/ (?=calc\()/);
    expect(sides).toEqual([
      'calc(var(--squisq-safe-area-top, env(safe-area-inset-top, 0px)) + 24px)',
      'calc(var(--squisq-safe-area-right, env(safe-area-inset-right, 0px)) + 24px)',
      'calc(var(--squisq-safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 24px)',
      'calc(var(--squisq-safe-area-left, env(safe-area-inset-left, 0px)) + 24px)',
    ]);
  });
});
