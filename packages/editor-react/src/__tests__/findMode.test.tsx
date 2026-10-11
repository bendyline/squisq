/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../RawEditor', () => ({
  RawEditor: () => <div data-testid="raw-editor-stub">Alpha beta alpha</div>,
}));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg-editor-stub" />,
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="preview-panel">Alpha beta alpha</div>,
}));

import { EditorShell } from '../EditorShell';

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

describe('<EditorShell> Find mode', () => {
  it('does not render a Find trigger or textbox by default', () => {
    render(<EditorShell initialMarkdown="Alpha" initialView="raw" />);
    expect(screen.queryByRole('search', { name: 'Find in document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close find' })).toBeNull();
  });

  it('shows search beside the view tabs, clears middle/left actions, and preserves right items', () => {
    const onFindModeChange = vi.fn();
    const { container } = render(
      <EditorShell
        initialMarkdown="Alpha beta alpha"
        initialView="raw"
        findMode
        onFindModeChange={onFindModeChange}
        toolbarSlotLeft={<span data-testid="left-slot">Left</span>}
        toolbarSlotAfterActions={<span data-testid="middle-slot">Middle</span>}
        toolbarSlotRight={<span data-testid="right-slot">Right</span>}
      />,
    );

    const tabs = container.querySelector('.squisq-toolbar-view-tabs');
    const search = screen.getByRole('search', { name: 'Find in document' });
    expect(tabs?.nextElementSibling).toBe(search);
    expect(screen.queryByTestId('left-slot')).toBeNull();
    expect(screen.queryByTestId('middle-slot')).toBeNull();
    expect(screen.getByTestId('right-slot')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Document settings' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close find' }));
    expect(onFindModeChange).toHaveBeenCalledWith(false);
  });

  it('responds to host-controlled mode changes and supports Escape to close', () => {
    const onFindModeChange = vi.fn();
    const { rerender } = render(
      <EditorShell
        initialMarkdown="Alpha"
        initialView="raw"
        findMode={false}
        onFindModeChange={onFindModeChange}
      />,
    );
    expect(screen.queryByRole('search', { name: 'Find in document' })).toBeNull();

    rerender(
      <EditorShell
        initialMarkdown="Alpha"
        initialView="raw"
        findMode
        onFindModeChange={onFindModeChange}
      />,
    );
    const input = screen.getByRole('searchbox', { name: 'Find in document' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onFindModeChange).toHaveBeenCalledWith(false);
  });

  it('opens with a host find request and toggles its options', () => {
    render(
      <EditorShell
        initialMarkdown="Alpha beta alpha"
        initialView="raw"
        findMode
        findRequest={{ query: 'alpha', matchCase: true, occurrence: 1 }}
      />,
    );
    const input = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Find in document' });
    expect(input.value).toBe('alpha');
    const matchCase = screen.getByRole('button', { name: 'Match case' });
    const wholeWord = screen.getByRole('button', { name: 'Match whole word' });
    expect(matchCase.getAttribute('aria-pressed')).toBe('true');
    expect(wholeWord.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(wholeWord);
    expect(wholeWord.getAttribute('aria-pressed')).toBe('true');
  });

  it('offers Replace only for an editable document', () => {
    const { unmount } = render(
      <EditorShell initialMarkdown="Alpha" initialView="raw" findMode readOnly />,
    );
    expect(screen.queryByRole('button', { name: 'Toggle replace' })).toBeNull();
    unmount();

    render(<EditorShell initialMarkdown="Alpha" initialView="raw" findMode />);
    const toggle = screen.getByRole('button', { name: 'Toggle replace' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull();
    fireEvent.click(toggle);
    const replaceInput = screen.getByRole('textbox', { name: 'Replace with' });
    expect(document.activeElement).toBe(replaceInput);
    expect(screen.getByRole('button', { name: 'Replace all' })).toBeTruthy();
  });

  it('binds the find and replace shortcuts inside the editor only when asked', () => {
    const onFindModeChange = vi.fn();
    const { container, rerender } = render(
      <EditorShell
        initialMarkdown="Alpha"
        initialView="raw"
        findMode={false}
        onFindModeChange={onFindModeChange}
      />,
    );
    const inside = container.querySelector<HTMLElement>('.squisq-editor-shell')!;
    fireEvent.keyDown(inside, { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(onFindModeChange).not.toHaveBeenCalled();

    rerender(
      <EditorShell
        initialMarkdown="Alpha"
        initialView="raw"
        findMode={false}
        onFindModeChange={onFindModeChange}
        findShortcut
      />,
    );
    // Outside this editor the shortcut is left alone.
    fireEvent.keyDown(document.body, { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(onFindModeChange).not.toHaveBeenCalled();
    fireEvent.keyDown(inside, { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(onFindModeChange).toHaveBeenCalledWith(true);

    rerender(
      <EditorShell
        initialMarkdown="Alpha"
        initialView="raw"
        findMode
        onFindModeChange={onFindModeChange}
        findShortcut
      />,
    );
    fireEvent.keyDown(inside, { key: 'h', code: 'KeyH', ctrlKey: true });
    expect(screen.getByRole('textbox', { name: 'Replace with' })).toBeTruthy();
  });
});
