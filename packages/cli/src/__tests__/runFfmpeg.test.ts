import { describe, it } from 'mocha';
import { expect } from 'chai';
import { runFfmpeg } from '../util/runFfmpeg.js';

describe('runFfmpeg cancellation', () => {
  it('terminates an in-flight child and preserves the caller abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel child process');
    const pending = runFfmpeg(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], {
      timeoutMs: 60_000,
      failureMessage: 'child failed',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(reason), 25);

    try {
      await pending;
      expect.fail('Expected child process cancellation');
    } catch (err: unknown) {
      expect(err).to.equal(reason);
    }
  });
});
