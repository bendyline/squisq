/** @vitest-environment jsdom */

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
}));

vi.mock('../../useMonacoLoader', () => ({
  useMonacoLoader: () => ({ monaco: {}, ready: true }),
}));

vi.mock('../codeSnippetData', () => ({
  useCodeSnippetData: () => ({
    fenceLanguage: 'ts',
    label: 'Ts',
    monacoLanguage: 'typescript',
    source: 'export const answer = 42;',
  }),
}));

import { CodeSnippetWidget } from '../CodeSnippetWidget';

function editorStub(): Editor {
  return {
    isEditable: true,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor;
}

function copyButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('.squisq-code-snippet-copy');
  if (!button) throw new Error('copy button missing');
  return button;
}

/**
 * The snippet header's Copy button. A host that owns clipboard permissions
 * (Electron, a native shell) supplies `onCopyCode`; everyone else falls
 * through to `navigator.clipboard`. Either way the button reports what
 * happened rather than failing silently.
 */
describe('CodeSnippetWidget copy button', () => {
  it('prefers the host clipboard adapter and reports success', async () => {
    const onCopy = vi.fn(async () => undefined);
    const view = render(
      <CodeSnippetWidget editor={editorStub()} blockId="b1" onCopyCode={() => onCopy} />,
    );

    await act(async () => {
      fireEvent.click(copyButton(view.container));
    });

    await waitFor(() =>
      expect(onCopy).toHaveBeenCalledWith('export const answer = 42;', { language: 'ts' }),
    );
    await waitFor(() => expect(copyButton(view.container).dataset.copyState).toBe('copied'));
    view.unmount();
  });

  it('falls back to navigator.clipboard when no adapter is supplied', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const view = render(<CodeSnippetWidget editor={editorStub()} blockId="b1" />);
    await act(async () => {
      fireEvent.click(copyButton(view.container));
    });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('export const answer = 42;'));
    view.unmount();
  });

  it('surfaces a failed copy instead of claiming success', async () => {
    const onCopy = vi.fn(async () => {
      throw new Error('denied');
    });
    const view = render(
      <CodeSnippetWidget editor={editorStub()} blockId="b1" onCopyCode={() => onCopy} />,
    );

    await act(async () => {
      fireEvent.click(copyButton(view.container));
    });

    await waitFor(() => expect(copyButton(view.container).dataset.copyState).toBe('failed'));
    view.unmount();
  });

  it('reads the adapter at click time so a host can swap it live', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    let current = first;
    const view = render(
      <CodeSnippetWidget editor={editorStub()} blockId="b1" onCopyCode={() => current} />,
    );

    current = second;
    await act(async () => {
      fireEvent.click(copyButton(view.container));
    });

    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
    view.unmount();
  });
});
