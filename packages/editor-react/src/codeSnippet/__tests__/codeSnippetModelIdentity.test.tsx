/** @vitest-environment jsdom */

import { render } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';

const monacoPaths = vi.hoisted(() => [] as string[]);

vi.mock('@monaco-editor/react', () => ({
  default: ({ path }: { path?: string }) => {
    if (path) monacoPaths.push(path);
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

describe('CodeSnippetWidget Monaco model identity', () => {
  it('does not reuse a model path when the same block id remounts', () => {
    monacoPaths.length = 0;
    const editor = editorStub();
    const first = render(<CodeSnippetWidget editor={editor} blockId="code-snippet-1" />);
    const firstPath = monacoPaths[monacoPaths.length - 1];

    first.rerender(<CodeSnippetWidget editor={editor} blockId="code-snippet-1" />);
    expect(monacoPaths[monacoPaths.length - 1]).toBe(firstPath);
    first.unmount();

    const second = render(<CodeSnippetWidget editor={editor} blockId="code-snippet-1" />);
    const secondPath = monacoPaths[monacoPaths.length - 1];
    second.unmount();

    expect(firstPath).toMatch(/\/code-snippet-1\.sh$/u);
    expect(secondPath).toMatch(/\/code-snippet-1\.sh$/u);
    expect(secondPath).not.toBe(firstPath);
  });
});
