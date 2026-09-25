import { describe, it } from 'mocha';
import { expect } from 'chai';

import { clipFilterChain } from '../util/audioMix.js';

describe('clipFilterChain', () => {
  it('trims, resets timestamps and delays a plain clip', () => {
    expect(
      clipFilterChain({ src: 'a.mp3', startSec: 1.5, sourceInSec: 2, durationSec: 3 }),
    ).to.equal('atrim=start=2:end=5,asetpts=PTS-STARTPTS,adelay=1500|1500');
  });

  it('applies recipe gain and fades before the delay', () => {
    expect(
      clipFilterChain({
        src: 'a.mp3',
        startSec: 0,
        sourceInSec: 0,
        durationSec: 10,
        gainDb: -6,
        fadeInSec: 0.5,
        fadeOutSec: 1,
      }),
    ).to.equal(
      'atrim=start=0:end=10,asetpts=PTS-STARTPTS,volume=-6dB,' +
        'afade=t=in:st=0:d=0.5,afade=t=out:st=9:d=1,adelay=0|0',
    );
  });

  it('scales fades that are longer than the clip', () => {
    expect(
      clipFilterChain({
        src: 'a.mp3',
        startSec: 0,
        sourceInSec: 0,
        durationSec: 2,
        fadeInSec: 3,
        fadeOutSec: 3,
      }),
    ).to.contain('afade=t=in:st=0:d=1,afade=t=out:st=1:d=1');
  });
});
