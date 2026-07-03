import { describe, it, expect } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';
import { generateRenderHtml } from '../renderHtml.js';

function minimalDoc(): Doc {
  return {
    articleId: 'test-doc',
    duration: 0,
    blocks: [],
    audio: { segments: [] },
  };
}

const PLAYER_STUB = 'window.SquisqPlayer = { mount: function(){} };';

describe('generateRenderHtml', () => {
  it('produces a self-contained HTML document mounting the player', () => {
    const html = generateRenderHtml(minimalDoc(), { playerScript: PLAYER_STUB });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('id="squisq-root"');
    expect(html).toContain(PLAYER_STUB);
    expect(html).toContain('SquisqPlayer.mount');
    expect(html).toContain('renderMode: true');
  });

  it('applies the requested viewport dimensions', () => {
    const html = generateRenderHtml(minimalDoc(), {
      playerScript: PLAYER_STUB,
      width: 800,
      height: 600,
    });
    expect(html).toContain('width:800px');
    expect(html).toContain('height:600px');
  });

  it('defaults to 1920x1080 when no dimensions are given', () => {
    const html = generateRenderHtml(minimalDoc(), { playerScript: PLAYER_STUB });
    expect(html).toContain('width:1920px');
    expect(html).toContain('height:1080px');
  });

  it('embeds images as base64 data URIs keyed by path', () => {
    const images = new Map<string, ArrayBuffer>([['hero.png', new Uint8Array([1, 2, 3]).buffer]]);
    const html = generateRenderHtml(minimalDoc(), { playerScript: PLAYER_STUB, images });
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('hero.png');
  });

  it('passes a null audio map when no audio is supplied', () => {
    const html = generateRenderHtml(minimalDoc(), { playerScript: PLAYER_STUB });
    expect(html).toContain('var audio = null;');
  });

  it('neutralizes embedded </script> sequences in the player bundle', () => {
    const malicious = 'console.log("</script><script>alert(1)</script>");';
    const html = generateRenderHtml(minimalDoc(), { playerScript: malicious });
    // The raw closing tag must not appear verbatim inside the inlined script.
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('<\\/script>');
  });

  it('includes the caption style only when requested', () => {
    const withCaptions = generateRenderHtml(minimalDoc(), {
      playerScript: PLAYER_STUB,
      captionStyle: 'social',
    });
    expect(withCaptions).toContain('captionStyle');
    expect(withCaptions).toContain('social');

    const withoutCaptions = generateRenderHtml(minimalDoc(), { playerScript: PLAYER_STUB });
    expect(withoutCaptions).not.toContain('captionStyle');
  });
});
