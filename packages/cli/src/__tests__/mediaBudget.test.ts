import { describe, it } from 'mocha';
import { expect } from 'chai';

import {
  createMediaBudget,
  MAX_RENDER_MEDIA_FILES,
  MAX_RENDER_MEDIA_FILE_BYTES,
  MAX_RENDER_MEDIA_TOTAL_BYTES,
} from '../util/mediaBudget.js';

/**
 * The CLI render path base64-embeds media into a single `page.setContent`
 * payload. Without a cap an oversized document failed opaquely inside the CDP
 * transport; the browser export path has always enforced these limits.
 */
describe('createMediaBudget', () => {
  /** A zero-filled buffer of `n` bytes — allocation only, never inspected. */
  const buf = (n: number): ArrayBuffer => new ArrayBuffer(n);

  it('admits assets within the caps and tracks totals', () => {
    const budget = createMediaBudget();
    budget.admit('a.png', buf(1024));
    budget.admit('b.png', buf(2048));
    expect(budget.totalBytes).to.equal(3072);
    expect(budget.fileCount).to.equal(2);
  });

  it('rejects a single file over the per-file cap, naming the asset', () => {
    const budget = createMediaBudget();
    const admit = () => budget.admit('huge.mp4', buf(MAX_RENDER_MEDIA_FILE_BYTES + 1));
    expect(admit).to.throw(/huge\.mp4/);
    expect(admit).to.throw(/per-file limit/);
  });

  it('admits a file exactly at the per-file cap', () => {
    const budget = createMediaBudget();
    expect(() => budget.admit('edge.mp4', buf(MAX_RENDER_MEDIA_FILE_BYTES))).to.not.throw();
  });

  it('rejects once the cumulative total would exceed the cap', () => {
    const budget = createMediaBudget();
    const chunk = MAX_RENDER_MEDIA_FILE_BYTES; // 64 MB
    // 4 x 64 MB = 256 MB total (at the cap), the 5th must be refused.
    for (let i = 0; i < MAX_RENDER_MEDIA_TOTAL_BYTES / chunk; i++) {
      budget.admit(`ok${i}.mp4`, buf(chunk));
    }
    const admit = () => budget.admit('one-too-many.mp4', buf(1));
    expect(admit).to.throw(/one-too-many\.mp4/);
    expect(admit).to.throw(/Total embedded media/);
  });

  it('rejects more than the file-count cap', () => {
    const budget = createMediaBudget();
    for (let i = 0; i < MAX_RENDER_MEDIA_FILES; i++) budget.admit(`f${i}.png`, buf(1));
    const admit = () => budget.admit('extra.png', buf(1));
    expect(admit).to.throw(/extra\.png/);
    expect(admit).to.throw(new RegExp(String(MAX_RENDER_MEDIA_FILES)));
  });

  it('does not count a rejected asset toward the totals', () => {
    const budget = createMediaBudget();
    budget.admit('a.png', buf(10));
    expect(() => budget.admit('huge.mp4', buf(MAX_RENDER_MEDIA_FILE_BYTES + 1))).to.throw();
    expect(budget.totalBytes).to.equal(10);
    expect(budget.fileCount).to.equal(1);
  });

  it('matches the browser export caps', () => {
    // These must stay in lockstep with video-react's useVideoExport so both
    // paths refuse the same documents.
    expect(MAX_RENDER_MEDIA_FILE_BYTES).to.equal(64 * 1024 * 1024);
    expect(MAX_RENDER_MEDIA_TOTAL_BYTES).to.equal(256 * 1024 * 1024);
    expect(MAX_RENDER_MEDIA_FILES).to.equal(256);
  });
});
