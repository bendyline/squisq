/**
 * @vitest-environment jsdom
 *
 * Prop-contract test for `codeContext`: the shell threads it to the
 * CodeContextZones bridge in code mode only (mirrors the submitOnEnter
 * threading tests). Heavy surfaces are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { CodeContext } from '../codeContext/types';

const zoneOptions: CodeContext[] = [];

vi.mock('../RawEditor', () => ({
  RawEditor: () => <div data-testid="raw-editor-stub" />,
}));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg-editor-stub" />,
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="preview-stub" />,
}));
vi.mock('../codeContext/CodeContextZones', () => ({
  CodeContextZones: ({ options }: { options: CodeContext }) => {
    zoneOptions.push(options);
    return <div data-testid="code-context-stub" />;
  },
}));

import { EditorShell } from '../EditorShell';

beforeEach(() => {
  zoneOptions.length = 0;
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

const codeContext: CodeContext = {
  sections: [{ id: 'foo@2', line: 2, summaryMarkdown: '**foo**', markdown: 'body' }],
};

describe('<EditorShell> codeContext prop', () => {
  it('mounts CodeContextZones with the options in code mode', () => {
    const { queryByTestId } = render(
      <EditorShell initialMarkdown="const x = 1;" fileName="a.ts" codeContext={codeContext} />,
    );
    expect(queryByTestId('code-context-stub')).toBeTruthy();
    expect(zoneOptions[0]).toBe(codeContext);
  });

  it('does not mount without the prop', () => {
    const { queryByTestId } = render(
      <EditorShell initialMarkdown="const x = 1;" fileName="a.ts" />,
    );
    expect(queryByTestId('code-context-stub')).toBeNull();
  });

  it('ignores codeContext in markdown mode', () => {
    const { queryByTestId } = render(
      <EditorShell initialMarkdown="# hi" fileName="a.md" codeContext={codeContext} />,
    );
    expect(queryByTestId('code-context-stub')).toBeNull();
  });
});
