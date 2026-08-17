import { describe, it, expect } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
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
    expect(html).toContain('var root = document.getElementById("squisq-root")');
    expect(html).toContain('SquisqPlayer.mount');
    expect(html).toContain('renderMode: true');
    expect(html).not.toContain('window.seekTo');
    expect(html).not.toContain('window.getDuration');
  });

  it('mounts the slideshow rendition by default (no dashboard option line)', () => {
    const html = generateRenderHtml(minimalDoc(), { playerScript: PLAYER_STUB });
    expect(html).toContain('mode: "slideshow"');
    expect(html).not.toContain('dashboard:');
  });

  it('mounts the dashboard rendition with its option object when requested', () => {
    const html = generateRenderHtml(minimalDoc(), {
      playerScript: PLAYER_STUB,
      displayMode: 'dashboard',
      dashboard: { layout: 'grid-2x2', title: false, documentTitle: 'Fleet Report' },
    });
    expect(html).toContain('mode: "dashboard"');
    expect(html).toContain('"layout":"grid-2x2"');
    expect(html).toContain('"title":false');
    expect(html).toContain('"documentTitle":"Fleet Report"');
  });

  it('emits an empty dashboard option object when none is supplied', () => {
    const html = generateRenderHtml(minimalDoc(), {
      playerScript: PLAYER_STUB,
      displayMode: 'dashboard',
    });
    expect(html).toContain('mode: "dashboard"');
    expect(html).toContain('dashboard: {}');
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

  // The encoder builds the binary string in 32 KiB chunks rather than one byte
  // at a time (per-byte rope allocation was ~6-9x slower at 8-32 MB). Chunking
  // must not corrupt bytes at a chunk boundary or drop a partial final chunk.
  it('base64-encodes payloads spanning chunk boundaries byte-exactly', () => {
    // Deliberately not a multiple of the 32 KiB chunk size, so the last chunk
    // is partial. All 256 byte values appear, including NUL and high bytes.
    const size = 0x8000 * 2 + 1234;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;

    const images = new Map<string, ArrayBuffer>([['big.png', bytes.buffer]]);
    const html = generateRenderHtml(minimalDoc(), { playerScript: PLAYER_STUB, images });

    const match = html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
    expect(match).not.toBeNull();

    const decoded = Uint8Array.from(atob(match![1]), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(size);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
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

  it('threads the animation policy to the standalone player', () => {
    const disabled = generateRenderHtml(minimalDoc(), {
      playerScript: PLAYER_STUB,
      animationsEnabled: false,
    });
    expect(disabled).toContain('animationsEnabled: false');

    const defaults = generateRenderHtml(minimalDoc(), { playerScript: PLAYER_STUB });
    expect(defaults).toContain('animationsEnabled: true');
  });

  it('threads explicit theme and PIP settings to the standalone capture player', () => {
    const html = generateRenderHtml(minimalDoc(), {
      playerScript: PLAYER_STUB,
      theme: resolveTheme('tech-dark'),
      videoPresentation: 'picture-in-picture',
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'bottom-right',
    });

    expect(html).toContain('theme: {"schemaVersion":"1","id":"tech-dark"');
    expect(html).toContain('videoPresentation: "picture-in-picture"');
    expect(html).toContain('pipSize: "large"');
    expect(html).toContain('pipShape: "wide"');
    expect(html).toContain('pipPosition: "bottom-right"');
  });
});
