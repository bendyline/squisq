/**
 * CLI format registry + pre-bound convert() tests
 *
 * Verifies the CLI registry registers the mp4 format on top of every built-in,
 * and that the api's `convert()` is pre-bound (injects the registry + a default
 * player-script resolver) so a non-mp4 conversion runs end-to-end. mp4 export
 * itself (Playwright + FFmpeg) is exercised in the e2e wave, not here.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createCliRegistry, convert } from '../api.js';

describe('CLI format registry', () => {
  it('registers the mp4 format on top of the built-ins', () => {
    const registry = createCliRegistry();

    const mp4 = registry.get('mp4');
    expect(mp4).to.not.equal(undefined);
    expect(mp4!.label).to.equal('MP4 Video');
    expect(mp4!.mimeType).to.equal('video/mp4');
    expect(mp4!.extensions).to.include('.mp4');
    expect(mp4!.exportDoc).to.be.a('function');

    // Built-ins remain available, and mp4 resolves by extension.
    expect(registry.get('docx')).to.not.equal(undefined);
    expect(registry.get('html')).to.not.equal(undefined);
    expect(registry.byExtension('.mp4')!.id).to.equal('mp4');
  });

  it('pre-binds convert() end-to-end for a non-mp4 conversion', async () => {
    const result = await convert(
      { kind: 'markdown', markdown: '# Hello\n\nWorld', baseName: 'greeting' },
      'html',
    );

    expect(result.bytes).to.be.instanceOf(Uint8Array);
    expect(result.bytes.length).to.be.greaterThan(0);
    expect(result.mimeType).to.equal('text/html');
    expect(result.suggestedFilename).to.equal('greeting.html');

    // The default resolvePlayerScript injected the standalone player bundle,
    // proving convert() is pre-bound (HTML export throws without it).
    const html = new TextDecoder().decode(result.bytes);
    expect(html).to.include('SquisqPlayer');
  });
});
