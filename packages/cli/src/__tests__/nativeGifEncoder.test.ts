import { describe, it } from 'mocha';
import { expect } from 'chai';
import { framesToGifNative } from '../util/nativeEncoder.js';

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
  expect.fail('Expected promise to reject');
}

describe('native animated GIF encoder validation', () => {
  it('rejects a pre-aborted signal before staging frames or launching FFmpeg', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel GIF');
    controller.abort(reason);

    try {
      await framesToGifNative('not-used', [new Uint8Array([1])], 'out.gif', {
        signal: controller.signal,
      });
      expect.fail('Expected GIF cancellation');
    } catch (err: unknown) {
      expect(err).to.equal(reason);
    }
  });

  it('rejects an empty frame sequence before launching FFmpeg', async () => {
    const message = await rejectionMessage(framesToGifNative('not-used', [], 'out.gif'));
    expect(message).to.equal('No frames provided for encoding');
  });

  it('rejects frame rates GIF timestamps cannot represent', async () => {
    const message = await rejectionMessage(
      framesToGifNative('not-used', [new Uint8Array([1])], 'out.gif', { fps: 101 }),
    );
    expect(message).to.include('GIF FPS must be a finite number between 1 and 100');
  });

  it('validates dimensions before writing temporary frames', async () => {
    const message = await rejectionMessage(
      framesToGifNative('not-used', [new Uint8Array([1])], 'out.gif', { width: 0 }),
    );
    expect(message).to.include('GIF width must be a positive integer');
  });

  it('validates palette options before writing temporary frames', async () => {
    const message = await rejectionMessage(
      framesToGifNative('not-used', [new Uint8Array([1])], 'out.gif', { maxColors: 257 }),
    );
    expect(message).to.include('GIF maxColors must be an integer between 2 and 256');
  });
});
