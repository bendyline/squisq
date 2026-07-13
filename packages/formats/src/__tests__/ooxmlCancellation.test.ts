import { describe, expect, it } from 'vitest';
import { inferThemeFromFile } from '../infer/index';
import { getPartXml, openPackage } from '../ooxml/reader';
import { inspectPptxLayouts } from '../pptx/layouts';
import { prepareZipInput } from '../shared/zipEntryCount';
import { buildThemedPptx } from './pptxInferFixtures';

function blockingBlob(onRead: () => void): Blob {
  const blob = {
    size: 128,
    slice: () => blob,
    arrayBuffer: () => {
      onRead();
      return new Promise<ArrayBuffer>(() => undefined);
    },
  };
  return blob as unknown as Blob;
}

describe('OOXML cancellation', () => {
  it('preserves the exact reason while theme inference reads Blob input', async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const controller = new AbortController();
    const reason = new Error('stop inference');
    const pending = inferThemeFromFile(
      blockingBlob(() => markStarted?.()),
      {
        signal: controller.signal,
      },
    );

    await started;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it('preserves the exact reason while layout inspection opens Blob input', async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const controller = new AbortController();
    const reason = new Error('stop layout inspection');
    const pending = inspectPptxLayouts(
      blockingBlob(() => markStarted?.()),
      {
        signal: controller.signal,
      },
    );

    await started;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it('propagates package cancellation through later OOXML part traversal', async () => {
    const controller = new AbortController();
    const pkg = await openPackage(await buildThemedPptx(), { signal: controller.signal });
    const reason = new Error('stop OOXML traversal');
    controller.abort(reason);

    await expect(getPartXml(pkg, 'ppt/presentation.xml')).rejects.toBe(reason);
  });

  it('handles a synchronously re-entrant FileReader abort exactly once', async () => {
    const previous = globalThis.FileReader;
    let abortCalls = 0;
    class ReentrantFileReader {
      result: ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsArrayBuffer(): void {
        // Remain pending until the caller aborts.
      }

      abort(): void {
        abortCalls += 1;
        this.onabort?.({} as ProgressEvent<FileReader>);
      }
    }
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      writable: true,
      value: ReentrantFileReader,
    });

    const blobLike = { size: 1, slice: () => blobLike } as unknown as Blob;
    const controller = new AbortController();
    const reason = new Error('stop FileReader');
    try {
      const pending = prepareZipInput(blobLike, controller.signal);
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(abortCalls).toBe(1);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'FileReader');
      else {
        Object.defineProperty(globalThis, 'FileReader', {
          configurable: true,
          writable: true,
          value: previous,
        });
      }
    }
  });
});
