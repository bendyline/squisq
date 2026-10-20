import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { TELEPROMPTER_FAKE_MIC_PATH } from './fakeMicFixture';
import type {
  MediaEditWorkerRequest,
  MediaEditWorkerResponse,
} from '../packages/video-react/src/mediaEdit/mediaEditWorkerProtocol';

test('the built media worker denoises audio using the emitted WASM asset', async ({ page }) => {
  const assets = await readdir('packages/site/dist/assets');
  const workerFile = assets.find((file) => /^mediaEdit\.worker-.*\.js$/.test(file));
  expect(workerFile).toBeDefined();
  const audio = (await readFile(TELEPROMPTER_FAKE_MIC_PATH)).toString('base64');
  const wasmRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/rnnoise-.*\.wasm$/.test(request.url())) wasmRequests.push(request.url());
  });
  await page.goto('/');

  const result = await page.evaluate(
    async ({ workerUrl, audio }) => {
      const worker = new Worker(workerUrl, { type: 'module' });
      try {
        return await new Promise<{ samples: number; finite: boolean }>((resolve, reject) => {
          worker.onerror = (event) => reject(new Error(event.message));
          worker.onmessage = (event: MessageEvent<MediaEditWorkerResponse>) => {
            const message = event.data;
            if (message.type === 'error') reject(new Error(message.message));
            if (message.type === 'previewed') {
              resolve({
                samples: message.result.processed[0].length,
                finite: message.result.processed.every((channel) => channel.every(Number.isFinite)),
              });
            }
          };
          worker.postMessage({
            type: 'preview',
            id: 1,
            source: new Blob([Uint8Array.from(atob(audio), (char) => char.charCodeAt(0))], {
              type: 'audio/wav',
            }),
            fx: 'denoise:0.8',
            startSec: 0,
            endSec: 1,
          } satisfies MediaEditWorkerRequest);
        });
      } finally {
        worker.terminate();
      }
    },
    { workerUrl: `/assets/${workerFile}`, audio },
  );
  expect(result.samples).toBe(48_000);
  expect(result.finite).toBe(true);
  expect(wasmRequests).toHaveLength(1);
});
