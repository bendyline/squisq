import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { blockHeadingTitle, useBlockNavigator } from '../useBlockNavigator';

/** Drive the hook against a piece of React-managed source state. */
function useHarness(initial: string, enabled: boolean) {
  const [source, setSource] = useState(initial);
  const nav = useBlockNavigator(source, setSource, { enabled });
  return { source, nav };
}

const DOC = '# One\n\nalpha\n\n# Two\n\nbeta\n';

describe('useBlockNavigator', () => {
  it('passes through to the full source when disabled', () => {
    const { result } = renderHook(() => useHarness(DOC, false));
    expect(result.current.nav.editorSource).toBe(DOC);
    act(() => result.current.nav.setEditorSource('changed\n'));
    expect(result.current.source).toBe('changed\n');
  });

  it('scopes editorSource to the active block when enabled', () => {
    const { result } = renderHook(() => useHarness(DOC, true));
    expect(result.current.nav.blockCount).toBe(2);
    expect(result.current.nav.activeBlockKey).toBe(0);
    expect(result.current.nav.editorSource).toBe('# One\n\nalpha\n\n');

    act(() => result.current.nav.nextBlock());
    expect(result.current.nav.activeBlockKey).toBe(1);
    expect(result.current.nav.editorSource).toBe('# Two\n\nbeta\n');
  });

  it('splices an edit to the active block back into the full source', () => {
    const { result } = renderHook(() => useHarness(DOC, true));
    act(() => result.current.nav.setEditorSource('# One\n\nalpha edited'));
    // A blank line is guaranteed before the following heading.
    expect(result.current.source).toBe('# One\n\nalpha edited\n\n# Two\n\nbeta\n');
  });

  it('clamps navigation at the document ends', () => {
    const { result } = renderHook(() => useHarness(DOC, true));
    act(() => result.current.nav.prevBlock());
    expect(result.current.nav.activeBlockKey).toBe(0);
    act(() => result.current.nav.nextBlock());
    act(() => result.current.nav.nextBlock());
    expect(result.current.nav.activeBlockKey).toBe(1);
  });

  it('adds a new block after the active one and moves to it', () => {
    const { result } = renderHook(() => useHarness(DOC, true));
    act(() => result.current.nav.addBlock());
    expect(result.current.nav.blockCount).toBe(3);
    expect(result.current.nav.activeBlockKey).toBe(1);
    expect(result.current.nav.editorSource).toContain('## New section');
    // The original second block is preserved and now sits last.
    expect(result.current.source).toContain('# Two\n\nbeta\n');
  });

  it('selects a block by source line for the outline', () => {
    const { result } = renderHook(() => useHarness(DOC, true));
    // Line 5 is the "# Two" heading.
    act(() => result.current.nav.goToBlockByLine(5));
    expect(result.current.nav.activeBlockKey).toBe(1);
    expect(result.current.nav.activeBlockStartLine).toBe(5);
  });

  it('remembers a block chosen by line while disabled and shows it once enabled', () => {
    // Source runs with the navigator off; Write turns it back on.
    const { result, rerender } = renderHook(({ enabled }) => useHarness(DOC, enabled), {
      initialProps: { enabled: false },
    });
    act(() => result.current.nav.goToBlockByLine(7));
    expect(result.current.nav.editorSource).toBe(DOC);
    rerender({ enabled: true });
    expect(result.current.nav.activeBlockKey).toBe(1);
    expect(result.current.nav.editorSource).toBe('# Two\n\nbeta\n');
  });

  it('names the active block by its heading', () => {
    const { result } = renderHook(() => useHarness(DOC, true));
    expect(result.current.nav.activeBlockTitle).toBe('One');
    act(() => result.current.nav.nextBlock());
    expect(result.current.nav.activeBlockTitle).toBe('Two');
  });

  it('names no block while disabled', () => {
    const { result } = renderHook(() => useHarness(DOC, false));
    expect(result.current.nav.activeBlockTitle).toBeNull();
  });
});

describe('blockHeadingTitle', () => {
  it('reads the heading a reader sees', () => {
    expect(blockHeadingTitle('## The Philosophy {[sectionHeader]}\n\nBody')).toBe('The Philosophy');
    expect(blockHeadingTitle('\n### **Bold** and `code` ###\n')).toBe('Bold and code');
    expect(blockHeadingTitle('# See [the guide](guide.md)\n')).toBe('See the guide');
    expect(blockHeadingTitle('# 2024 Plan {[stats]} {[fa-solid:chart-line]}')).toBe('2024 Plan');
  });

  it('names no heading-less block', () => {
    expect(blockHeadingTitle('---\ntitle: Doc\n---\n\nIntro')).toBeNull();
    expect(blockHeadingTitle('Just prose\n')).toBeNull();
    expect(blockHeadingTitle('## {[quote]}\n')).toBeNull();
    expect(blockHeadingTitle('#hashtag\n')).toBeNull();
  });
});
