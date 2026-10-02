import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  createEmptyImageEditDoc,
  readImageEditDoc,
  writeImageEditDoc,
} from '@bendyline/squisq/imageEdit';
import { useImageEditor } from '../imageEditor/useImageEditor';
it('does not write the previous image document into a new container while it loads', async () => {
  const a = new MemoryContentContainer();
  const b = new MemoryContentContainer();
  await writeImageEditDoc(a, createEmptyImageEditDoc(100, 100));
  await writeImageEditDoc(b, createEmptyImageEditDoc(900, 900));
  const bOriginal = (await b.readFile('state.json'))!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readB = b.readFile.bind(b);
  const blocked = vi.spyOn(b, 'readFile').mockImplementation(async (path) => {
    await gate;
    return path === 'state.json' ? bOriginal : readB(path);
  });
  const writeB = vi.spyOn(b, 'writeFile');
  const hook = renderHook(({ container }) => useImageEditor({ container, persistDebounceMs: 25 }), {
    initialProps: { container: a },
  });
  try {
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    act(() =>
      hook.result.current.dispatch({ type: 'set-canvas', canvas: { width: 125, height: 125 } }),
    );
    hook.rerender({ container: b });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
    });
    expect(writeB).not.toHaveBeenCalled();
  } finally {
    await act(async () => release());
    hook.unmount();
    blocked.mockRestore();
    writeB.mockRestore();
    await readImageEditDoc(b);
  }
});
