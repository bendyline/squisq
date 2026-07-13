import { expect } from 'chai';
import { describe, it } from 'mocha';
import { CapturedFrameBudgetError, CapturedFrameCollector } from '../util/capturedFrameBudget.js';

describe('captured-frame memory budget', () => {
  it('rejects before retaining an over-budget frame and releases earlier frames', () => {
    const collector = new CapturedFrameCollector(8);
    collector.append(new Uint8Array(5));

    let caught: unknown;
    try {
      collector.append(new Uint8Array(4));
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(CapturedFrameBudgetError);
    expect(caught).to.include({
      code: 'captured-frame-budget-exceeded',
      capturedBytes: 5,
      attemptedFrameBytes: 4,
      maximumBytes: 8,
    });
    expect(collector.frameCount).to.equal(0);
    expect(collector.retainedBytes).to.equal(0);
  });

  it('releases captured frames before preserving the caller cancellation reason', () => {
    const collector = new CapturedFrameCollector(8);
    collector.append(new Uint8Array(5));
    const controller = new AbortController();
    const reason = new Error('cancel frame capture');
    controller.abort(reason);

    let caught: unknown;
    try {
      collector.throwIfAborted(controller.signal);
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).to.equal(reason);
    expect(collector.frameCount).to.equal(0);
    expect(collector.retainedBytes).to.equal(0);
  });

  it('counts one retained cover image even when pre-roll repeats its frame reference', () => {
    const collector = new CapturedFrameCollector(8);
    const cover = new Uint8Array(5);
    collector.append(cover, 3);

    expect(collector.frameCount).to.equal(3);
    expect(collector.retainedBytes).to.equal(5);
    const released = collector.release();
    expect(released).to.deep.equal([cover, cover, cover]);
    expect(collector.frameCount).to.equal(0);
    expect(collector.retainedBytes).to.equal(0);
  });
});
