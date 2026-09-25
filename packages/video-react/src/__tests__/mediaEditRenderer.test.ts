import { describe, expect, it, vi } from 'vitest';
import type {
  MediaEditWorkerRequest,
  MediaEditWorkerResponse,
} from '../mediaEdit/mediaEditWorkerProtocol.js';

vi.mock('../mediaEdit/mediaEditEngine.js', () => ({
  renderMediaEditAudio: vi.fn(async () => ({ inline: true })),
  analyzeMediaEditAudio: vi.fn(async () => null),
  previewMediaEditAudio: vi.fn(async () => ({ inline: true })),
}));

const { createMediaEditRenderer } = await import('../mediaEdit/mediaEditRenderer.js');

class FakeWorker {
  onmessage: ((event: MessageEvent<MediaEditWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: MediaEditWorkerRequest[] = [];
  terminated = false;

  postMessage(message: MediaEditWorkerRequest): void {
    this.posted.push(message);
  }

  reply(message: MediaEditWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<MediaEditWorkerResponse>);
  }

  fail(): void {
    this.onerror?.({ message: 'blocked by CSP', preventDefault() {} } as ErrorEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const request = { source: new Blob(['x']), fx: 'loudness:-16' };

describe('createMediaEditRenderer', () => {
  it('runs jobs in the worker and relays progress', async () => {
    const worker = new FakeWorker();
    const renderer = createMediaEditRenderer({
      createWorker: () => worker as unknown as Worker,
    });
    const progress: number[] = [];
    const job = renderer.render(request, { onProgress: (f) => progress.push(f) });
    const sent = worker.posted[0];
    expect(sent).toMatchObject({ type: 'render', fx: 'loudness:-16' });
    worker.reply({ type: 'progress', id: sent.id, fraction: 0.5 });
    worker.reply({
      type: 'rendered',
      id: sent.id,
      result: { mimeType: 'audio/webm' } as never,
    });
    await expect(job).resolves.toEqual({ mimeType: 'audio/webm' });
    expect(progress).toEqual([0.5]);
  });

  it('forwards cancellation and rejects with AbortError', async () => {
    const worker = new FakeWorker();
    const renderer = createMediaEditRenderer({
      createWorker: () => worker as unknown as Worker,
    });
    const controller = new AbortController();
    const job = renderer.analyze(request, { signal: controller.signal });
    controller.abort();
    const [sent, cancel] = worker.posted;
    expect(cancel).toEqual({ type: 'cancel', id: sent.id });
    worker.reply({ type: 'error', id: sent.id, message: 'aborted', aborted: true });
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('surfaces worker errors as Errors', async () => {
    const worker = new FakeWorker();
    const renderer = createMediaEditRenderer({
      createWorker: () => worker as unknown as Worker,
    });
    const job = renderer.render(request);
    worker.reply({ type: 'error', id: worker.posted[0].id, message: 'no audio', aborted: false });
    await expect(job).rejects.toThrow('no audio');
  });

  it('finishes in-flight jobs inline when the worker dies, and stays inline', async () => {
    const worker = new FakeWorker();
    const renderer = createMediaEditRenderer({
      createWorker: () => worker as unknown as Worker,
    });
    const job = renderer.render(request);
    worker.fail();
    await expect(job).resolves.toEqual({ inline: true });
    expect(worker.terminated).toBe(true);
    await expect(renderer.preview({ ...request, startSec: 0, endSec: 1 })).resolves.toEqual({
      inline: true,
    });
    expect(worker.posted).toHaveLength(1);
  });

  it('runs inline when no worker can be created', async () => {
    const renderer = createMediaEditRenderer({ createWorker: () => null });
    await expect(renderer.render(request)).resolves.toEqual({ inline: true });
  });
});
