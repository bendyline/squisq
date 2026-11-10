/**
 * The Source view's gutter shrinks to line numbers on a narrow editor.
 *
 * On a phone, Monaco's default gutter (five-digit line numbers, a glyph
 * margin and a folding column) took about a quarter of the screen. RawEditor
 * measures its own box and hands Monaco a compact gutter below 520px, then
 * restores every option when the editor widens again — `updateOptions` merges,
 * so a key left out of the full set would stay compact.
 */

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MonacoOptions = Record<string, unknown>;

const captured = vi.hoisted(() => ({ options: null as MonacoOptions | null }));

vi.mock('@monaco-editor/react', () => ({
  default: (props: { options: MonacoOptions }) => {
    captured.options = props.options;
    return null;
  },
  loader: { config: () => undefined },
}));

vi.mock('../useMonacoLoader', () => ({
  useMonacoLoader: () => ({ monaco: null, ready: true }),
  preloadMonaco: () => Promise.resolve(),
}));

import { EditorProvider } from '../EditorContext';
import { RawEditor } from '../RawEditor';

/** Stands in for the browser's observer so a test can set the editor's width. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  resize(width: number): void {
    this.callback(
      [{ contentRect: { width } as DOMRectReadOnly } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function renderAtWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
  } as DOMRect);
  return render(
    <EditorProvider initialMarkdown={'# Title\n\nBody\n'}>
      <RawEditor />
    </EditorProvider>,
  );
}

function gutterOf(options: MonacoOptions | null) {
  return {
    lineNumbersMinChars: options?.lineNumbersMinChars,
    glyphMargin: options?.glyphMargin,
    folding: options?.folding,
    lineDecorationsWidth: options?.lineDecorationsWidth,
  };
}

beforeEach(() => {
  captured.options = null;
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RawEditor compact gutter', () => {
  it('keeps the full gutter on a wide editor', () => {
    const { getByTestId } = renderAtWidth(900);

    expect(gutterOf(captured.options)).toEqual({
      lineNumbersMinChars: 5,
      glyphMargin: true,
      folding: true,
      lineDecorationsWidth: 22,
    });
    const host = getByTestId('raw-editor');
    expect(host.style.getPropertyValue('--squisq-raw-editor-breathing')).toBe('12px');
    expect(host.style.getPropertyValue('--squisq-raw-editor-number-inset')).toBe('0px');
  });

  it('trims the gutter to line numbers on a narrow editor', () => {
    const { getByTestId } = renderAtWidth(390);

    expect(gutterOf(captured.options)).toEqual({
      lineNumbersMinChars: 2,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 16,
    });
    const host = getByTestId('raw-editor');
    expect(host.style.getPropertyValue('--squisq-raw-editor-breathing')).toBe('6px');
    expect(host.style.getPropertyValue('--squisq-raw-editor-number-inset')).toBe('4px');
  });

  it('restores every gutter option when the editor widens', () => {
    renderAtWidth(390);
    expect(captured.options?.glyphMargin).toBe(false);

    act(() => FakeResizeObserver.instances.at(-1)?.resize(1024));
    expect(gutterOf(captured.options)).toEqual({
      lineNumbersMinChars: 5,
      glyphMargin: true,
      folding: true,
      lineDecorationsWidth: 22,
    });
  });

  it('keeps its last answer while the editor is hidden', () => {
    renderAtWidth(390);

    act(() => FakeResizeObserver.instances.at(-1)?.resize(0));
    expect(captured.options?.lineNumbersMinChars).toBe(2);
  });
});
