import { describe, it } from 'mocha';
import { expect } from 'chai';

import { resolveAppliedCoverPreRoll } from '../util/coverPreRoll.js';

describe('resolveAppliedCoverPreRoll', () => {
  it('keeps the requested duration when a cover exists', () => {
    expect(resolveAppliedCoverPreRoll(2.5, true)).to.equal(2.5);
  });

  it('removes phantom pre-roll when a document has no cover', () => {
    expect(resolveAppliedCoverPreRoll(2.5, false)).to.equal(0);
  });

  it('rejects invalid values for the programmatic API', () => {
    expect(() => resolveAppliedCoverPreRoll(-1, true)).to.throw('Cover pre-roll');
    expect(() => resolveAppliedCoverPreRoll(Number.NaN, true)).to.throw('Cover pre-roll');
  });
});
