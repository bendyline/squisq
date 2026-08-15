/**
 * CLI format registry + pre-bound convert() tests
 *
 * Verifies the CLI registry registers the mp4 format on top of every built-in,
 * and that the api's `convert()` is pre-bound (injects the registry + a default
 * player-script resolver) so a non-mp4 conversion runs end-to-end. mp4 export
 * itself (Playwright + FFmpeg) is exercised by the flagship pptx → mp4 test in
 * `flagship.e2e.test.ts`, which self-skips when that tooling is unavailable.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createCliRegistry, convert, prepareConversion } from '../api.js';

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

  it('registers animated GIF as a CLI-only rendered format', () => {
    const registry = createCliRegistry();
    const gif = registry.get('gif');
    expect(gif).to.not.equal(undefined);
    expect(gif!.label).to.equal('Animated GIF');
    expect(gif!.mimeType).to.equal('image/gif');
    expect(gif!.extensions).to.include('.gif');
    expect(gif!.exportDoc).to.be.a('function');
    expect(registry.byExtension('.GIF')!.id).to.equal('gif');
  });

  it('registers the dashboard PNG image as a CLI-only rendered format', () => {
    const registry = createCliRegistry();
    const png = registry.get('png');
    expect(png).to.not.equal(undefined);
    expect(png!.label).to.equal('Dashboard Image');
    expect(png!.mimeType).to.equal('image/png');
    expect(png!.extensions).to.include('.png');
    expect(png!.exportDoc).to.be.a('function');
    expect(registry.byExtension('.PNG')!.id).to.equal('png');
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

  it('prepares once and exports the same source to multiple targets', async () => {
    const prepared = await prepareConversion({
      kind: 'markdown',
      markdown: '# Prepared\n\nOne normalized document.',
      baseName: 'prepared',
    });

    const [markdown, html] = await Promise.all([
      prepared.convert('md'),
      prepared.convert('html', { title: 'Prepared HTML' }),
    ]);

    expect(markdown.suggestedFilename).to.equal('prepared.md');
    expect(new TextDecoder().decode(markdown.bytes)).to.include('# Prepared');
    expect(html.suggestedFilename).to.equal('prepared.html');
    const htmlText = new TextDecoder().decode(html.bytes);
    expect(htmlText).to.include('<title>Prepared HTML</title>');
    expect(htmlText).to.include('SquisqPlayer');
  });

  for (const format of ['mp4', 'gif', 'png'] as const) {
    it(`stops a pre-aborted ${format} conversion before browser or FFmpeg work`, async () => {
      const controller = new AbortController();
      const reason = new Error(`cancel ${format}`);
      controller.abort(reason);

      try {
        await convert({ kind: 'markdown', markdown: '# Cancel' }, format, {
          signal: controller.signal,
        });
        expect.fail(`Expected ${format} cancellation`);
      } catch (err: unknown) {
        expect(err).to.equal(reason);
      }
    });
  }
});
