import { describe, expect, it, vi } from 'vitest';
import { focusCodeSnippetAtEnd } from '../codeSnippetFocus';

describe('focusCodeSnippetAtEnd', () => {
  it('places the caret after the Monaco model content and focuses the editor', () => {
    const endPosition = { lineNumber: 3, column: 2 };
    const model = {
      getValueLength: vi.fn(() => 20),
      getPositionAt: vi.fn(() => endPosition),
    };
    const editor = {
      getModel: vi.fn(() => model),
      setPosition: vi.fn(),
      revealPositionInCenterIfOutsideViewport: vi.fn(),
      focus: vi.fn(),
    };

    focusCodeSnippetAtEnd(editor as never);

    expect(model.getPositionAt).toHaveBeenCalledWith(20);
    expect(editor.setPosition).toHaveBeenCalledWith(endPosition);
    expect(editor.revealPositionInCenterIfOutsideViewport).toHaveBeenCalledWith(endPosition);
    expect(editor.focus).toHaveBeenCalledOnce();
  });
});
