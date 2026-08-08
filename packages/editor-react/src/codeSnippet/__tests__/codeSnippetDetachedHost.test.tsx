/** @vitest-environment jsdom */

import { act, render } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';

const monacoThemes = vi.hoisted(() => [] as string[]);

vi.mock('@monaco-editor/react', () => ({
  default: ({ theme }: { theme?: string }) => {
    if (theme) monacoThemes.push(theme);
    return <div data-testid="monaco-editor" />;
  },
}));

vi.mock('../../useMonacoLoader', () => ({
  useMonacoLoader: () => ({ monaco: {}, ready: true }),
}));

vi.mock('../codeSnippetData', () => ({
  useCodeSnippetData: () => ({
    fenceLanguage: 'sh',
    label: 'Sh',
    monacoLanguage: 'shell',
    source: 'echo hello',
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

function flushAnimationFrame(): Promise<void> {
  return act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

/**
 * Monaco's theme is page-global — a widget must not mount `<MonacoEditor>`
 * (and thereby re-apply its own theme to every editor on the page) when its
 * host sits in a detached tree, which happens when ProseMirror rebuilds
 * decorations while the WYSIWYG view is being torn down. Regression coverage
 * for the dark-mode Source view flipping light after a Write → Source switch.
 */
describe('CodeSnippetWidget detached host', () => {
  it('resolves the scheme from a connected [data-theme] ancestor', () => {
    monacoThemes.length = 0;
    const shell = document.createElement('div');
    shell.dataset.theme = 'dark';
    const host = document.createElement('div');
    shell.appendChild(host);
    document.body.appendChild(shell);

    const view = render(<CodeSnippetWidget editor={editorStub()} blockId="b1" host={host} />);
    expect(view.queryByTestId('monaco-editor')).not.toBeNull();
    expect(monacoThemes[monacoThemes.length - 1]).toBe('vs-dark');

    view.unmount();
    shell.remove();
  });

  it('never mounts Monaco for a host that stays detached', async () => {
    monacoThemes.length = 0;
    const shell = document.createElement('div');
    shell.dataset.theme = 'dark';
    const host = document.createElement('div');
    shell.appendChild(host);
    // shell is never appended to the document — the teardown-zombie shape.

    const view = render(<CodeSnippetWidget editor={editorStub()} blockId="b1" host={host} />);
    expect(view.queryByTestId('monaco-editor')).toBeNull();

    await flushAnimationFrame();
    expect(view.queryByTestId('monaco-editor')).toBeNull();
    expect(monacoThemes).toHaveLength(0);

    view.unmount();
  });

  it('recovers when the host attaches a frame after the first render', async () => {
    monacoThemes.length = 0;
    const shell = document.createElement('div');
    shell.dataset.theme = 'dark';
    const host = document.createElement('div');
    shell.appendChild(host);

    const view = render(<CodeSnippetWidget editor={editorStub()} blockId="b1" host={host} />);
    expect(view.queryByTestId('monaco-editor')).toBeNull();

    document.body.appendChild(shell);
    await flushAnimationFrame();
    expect(view.queryByTestId('monaco-editor')).not.toBeNull();
    expect(monacoThemes[monacoThemes.length - 1]).toBe('vs-dark');

    view.unmount();
    shell.remove();
  });

  it('keeps the historical light default for host-less mounts', () => {
    monacoThemes.length = 0;
    const view = render(<CodeSnippetWidget editor={editorStub()} blockId="b1" />);
    expect(view.queryByTestId('monaco-editor')).not.toBeNull();
    expect(monacoThemes[monacoThemes.length - 1]).toBe('vs');
    view.unmount();
  });
});
