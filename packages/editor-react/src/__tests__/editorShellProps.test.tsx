/**
 * @vitest-environment jsdom
 *
 * Prop-contract tests for the v1.5 naming renames:
 *   - `<EditorShell>`'s light/dark chrome prop is `colorScheme` (was
 *     `theme`), and it drives the `data-theme` attribute on the shell root.
 *   - `<RawEditor>`'s Monaco theme-string prop is `monacoTheme` (was
 *     `theme`); the shell maps `colorScheme` → `monacoTheme` (`'dark'` →
 *     `'vs-dark'`, `'light'` → `'vs'`).
 *
 * The heavy editing surfaces are stubbed so the shell mounts under jsdom
 * without dragging in monaco-editor or Tiptap. The RawEditor stub records
 * the props it receives so we can assert `monacoTheme` reaches it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RawEditorProps } from '../RawEditor';

// Records the props the shell passes to RawEditor on each render.
const rawEditorProps: RawEditorProps[] = [];

vi.mock('../RawEditor', () => ({
  RawEditor: (props: RawEditorProps) => {
    rawEditorProps.push(props);
    return <div data-testid="raw-editor-stub" />;
  },
}));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg-editor-stub" />,
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="preview-stub" />,
}));

import { EditorShell } from '../EditorShell';

beforeEach(() => {
  rawEditorProps.length = 0;
  // jsdom lacks matchMedia / ResizeObserver, which the Toolbar uses.
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
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

describe('<EditorShell> colorScheme prop', () => {
  it('applies dark chrome via data-theme when colorScheme="dark"', () => {
    const { container } = render(
      <EditorShell initialMarkdown="# hi" initialView="raw" colorScheme="dark" />,
    );
    const shell = container.querySelector('.squisq-editor-shell');
    expect(shell?.getAttribute('data-theme')).toBe('dark');
  });

  it('defaults to light chrome when colorScheme is omitted', () => {
    const { container } = render(<EditorShell initialMarkdown="# hi" initialView="raw" />);
    const shell = container.querySelector('.squisq-editor-shell');
    expect(shell?.getAttribute('data-theme')).toBe('light');
  });
});

describe('RawEditor monacoTheme prop', () => {
  it('maps colorScheme="dark" to monacoTheme="vs-dark"', () => {
    render(<EditorShell initialMarkdown="# hi" initialView="raw" colorScheme="dark" />);
    expect(screen.getByTestId('raw-editor-stub')).toBeTruthy();
    const last = rawEditorProps[rawEditorProps.length - 1];
    expect(last?.monacoTheme).toBe('vs-dark');
  });

  it('maps colorScheme="light" to monacoTheme="vs"', () => {
    render(<EditorShell initialMarkdown="# hi" initialView="raw" colorScheme="light" />);
    expect(screen.getByTestId('raw-editor-stub')).toBeTruthy();
    const last = rawEditorProps[rawEditorProps.length - 1];
    expect(last?.monacoTheme).toBe('vs');
  });
});
