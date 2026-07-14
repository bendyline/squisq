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
});
