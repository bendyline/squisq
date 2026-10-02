import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';

const mocks = vi.hoisted(() => ({
  init: vi.fn(async () => 0.1),
  destroy: vi.fn(),
  captureFrame: vi.fn(async () => ({ close() {} }) as ImageBitmap),
  captureCanvasFrame: vi.fn(async () => ({}) as HTMLCanvasElement),
  setCoverVisible: vi.fn(async () => {}),
  encodeFrame: vi.fn(async () => {}),
  finalize: vi.fn(async () => new Uint8Array([1, 2]).buffer),
  close: vi.fn(),
}));
vi.mock('../hooks/useFrameCapture.js', () => {
  const handle = {
    init: mocks.init,
    destroy: mocks.destroy,
    captureFrame: mocks.captureFrame,
    captureCanvasFrame: mocks.captureCanvasFrame,
    setCoverVisible: mocks.setCoverVisible,
  };
  return { useFrameCapture: () => handle };
});
vi.mock('../mainThreadEncoder.js', () => ({
  supportsWebCodecs: () => true,
  supportsWebCodecsH264: async () => true,
  createEncoder: () => ({
    encodeFrame: mocks.encodeFrame,
    finalize: mocks.finalize,
    close: mocks.close,
  }),
}));
import { useVideoExport } from '../hooks/useVideoExport';

it('does not resume a cancelled export when a replacement export starts', async () => {
  let finishFirst!: (duration: number) => void;
  let finishSecond!: (duration: number) => void;
  mocks.init.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finishFirst = resolve;
      }),
  );
  mocks.init.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finishSecond = resolve;
      }),
  );
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const hook = renderHook(() => useVideoExport());
  const doc: Doc = {
    articleId: 'cancel-probe',
    duration: 0.1,
    blocks: [{ id: 'b1', startTime: 0, duration: 0.1, audioSegment: 0, layers: [] }],
    audio: { segments: [] },
  };
  let first!: Promise<void>;
  let second!: Promise<void>;
  try {
    await act(async () => {
      first = hook.result.current.startExport(doc, { audioPolicy: 'omit', fps: 10 });
    });
    act(() => hook.result.current.cancel());
    await act(async () => {
      second = hook.result.current.startExport(doc, { audioPolicy: 'omit', fps: 10 });
    });
    await act(async () => {
      finishFirst(0.1);
      await first;
    });
    expect(mocks.finalize).not.toHaveBeenCalled();
  } finally {
    act(() => hook.result.current.cancel());
    await act(async () => {
      finishSecond(0.1);
      await second;
    });
    hook.unmount();
    create.mockRestore();
    revoke.mockRestore();
  }
});
