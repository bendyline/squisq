import { describe, it } from 'mocha';
import { expect } from 'chai';

import { framesToMp4Native, framesToMp4NativeBytes } from '../api.js';
import type { CliConvertOptions } from '../api.js';

describe('@bendyline/squisq-cli/api native encoding surface', () => {
  it('exposes both file and in-memory frame encoders', () => {
    expect(framesToMp4Native).to.be.a('function');
    expect(framesToMp4NativeBytes).to.be.a('function');
  });

  it('types the CLI-only MP4 format options', () => {
    const options = {
      formatOptions: { mp4: { fps: 24, quality: 'high', orientation: 'portrait' } },
    } satisfies CliConvertOptions;
    expect(options.formatOptions.mp4.fps).to.equal(24);
  });
});
