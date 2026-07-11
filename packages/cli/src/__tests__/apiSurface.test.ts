import { describe, it } from 'mocha';
import { expect } from 'chai';

import {
  GIF_EXPORT_DEFAULTS,
  framesToGifNative,
  framesToGifNativeBytes,
  framesToMp4Native,
  framesToMp4NativeBytes,
} from '../api.js';
import type { CliConvertOptions } from '../api.js';

describe('@bendyline/squisq-cli/api native encoding surface', () => {
  it('exposes both file and in-memory frame encoders', () => {
    expect(framesToMp4Native).to.be.a('function');
    expect(framesToMp4NativeBytes).to.be.a('function');
    expect(framesToGifNative).to.be.a('function');
    expect(framesToGifNativeBytes).to.be.a('function');
    expect(GIF_EXPORT_DEFAULTS).to.include({
      fps: 10,
      width: 960,
      height: 540,
      loop: 0,
      maxColors: 256,
    });
  });

  it('types the CLI-only MP4 format options', () => {
    const options = {
      formatOptions: { mp4: { fps: 24, quality: 'high', orientation: 'portrait' } },
    } satisfies CliConvertOptions;
    expect(options.formatOptions.mp4.fps).to.equal(24);
  });

  it('types the CLI-only GIF format options', () => {
    const options = {
      formatOptions: {
        gif: {
          fps: 10,
          animationsEnabled: false,
          loop: 0,
          maxColors: 256,
          dither: 'sierra2_4a',
        },
      },
    } satisfies CliConvertOptions;
    expect(options.formatOptions.gif.animationsEnabled).to.equal(false);
  });
});
