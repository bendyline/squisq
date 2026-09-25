import { describe, it, expect } from 'vitest';
import { inspectAnimatedImage, mayBeAnimatedImage } from '../imageEdit/animatedImage';
import { SeededRandom } from '../random/SeededRandom';

// ── Byte builders ──────────────────────────────────────────────────

const bytes = (...parts: Array<number | number[] | string>): Uint8Array => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') out.push(part);
    else if (typeof part === 'string') for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array(out);
};

const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

interface GifFrame {
  /** Hundredths of a second; omit to write no graphic control extension. */
  delayCs?: number;
  /** Local color table of 2^(n+1) entries. */
  localTableBits?: number;
}

function gif(
  frames: GifFrame[],
  opts: { loops?: number; globalTableBits?: number; extras?: number[] } = {},
): Uint8Array {
  const parts: number[] = [];
  parts.push(...bytes('GIF89a'));
  const globalBits = opts.globalTableBits;
  const screenPacked = globalBits === undefined ? 0 : 0x80 | globalBits;
  parts.push(...u16le(1), ...u16le(1), screenPacked, 0, 0);
  if (globalBits !== undefined) parts.push(...new Array(3 * (1 << (globalBits + 1))).fill(0));
  if (opts.loops !== undefined) {
    parts.push(0x21, 0xff, 11, ...bytes('NETSCAPE2.0'), 3, 1, ...u16le(opts.loops), 0);
  }
  if (opts.extras) parts.push(...opts.extras);
  for (const frame of frames) {
    if (frame.delayCs !== undefined) {
      parts.push(0x21, 0xf9, 4, 0, ...u16le(frame.delayCs), 0, 0);
    }
    const localBits = frame.localTableBits;
    const imagePacked = localBits === undefined ? 0 : 0x80 | localBits;
    parts.push(0x2c, ...u16le(0), ...u16le(0), ...u16le(1), ...u16le(1), imagePacked);
    if (localBits !== undefined) parts.push(...new Array(3 * (1 << (localBits + 1))).fill(0));
    // LZW min code size, one data sub-block, terminator.
    parts.push(2, 2, 0x4c, 0x01, 0);
  }
  parts.push(0x3b);
  return new Uint8Array(parts);
}

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...bytes(type), ...data, 0, 0, 0, 0];
}

function apng(delays: Array<[number, number]>, plays: number): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  parts.push(...pngChunk('IHDR', new Array(13).fill(0)));
  parts.push(...pngChunk('acTL', [...u32be(delays.length), ...u32be(plays)]));
  delays.forEach(([num, den], i) => {
    const fctl = [...u32be(i), ...new Array(16).fill(0), ...u16be(num), ...u16be(den), 0, 0];
    parts.push(...pngChunk('fcTL', fctl));
    parts.push(...pngChunk(i === 0 ? 'IDAT' : 'fdAT', [1, 2, 3]));
  });
  parts.push(...pngChunk('IEND', []));
  return new Uint8Array(parts);
}

function stillPng(): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  parts.push(...pngChunk('IHDR', new Array(13).fill(0)));
  parts.push(...pngChunk('IDAT', [1, 2, 3]));
  // An acTL after the image data is not an animation control.
  parts.push(...pngChunk('acTL', [...u32be(4), ...u32be(0)]));
  parts.push(...pngChunk('IEND', []));
  return new Uint8Array(parts);
}

function webpChunk(type: string, data: number[]): number[] {
  const padded = data.length % 2 === 1 ? [...data, 0] : data;
  return [...bytes(type), ...u32le(data.length), ...padded];
}

function animatedWebp(durations: number[], loops: number): Uint8Array {
  const body: number[] = [...bytes('WEBP')];
  body.push(...webpChunk('VP8X', [0x02, 0, 0, 0, ...u24le(0), ...u24le(0)]));
  body.push(...webpChunk('ANIM', [0, 0, 0, 0, ...u16le(loops)]));
  for (const ms of durations) {
    // Odd payload length exercises the RIFF even-padding rule.
    body.push(...webpChunk('ANMF', [...new Array(12).fill(0), ...u24le(ms), 0, 9, 9, 9]));
  }
  return new Uint8Array([...bytes('RIFF'), ...u32le(body.length), ...body]);
}

function stillWebp(): Uint8Array {
  const body = [...bytes('WEBP'), ...webpChunk('VP8L', [0x2f, 0, 0, 0, 0])];
  return new Uint8Array([...bytes('RIFF'), ...u32le(body.length), ...body]);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('inspectAnimatedImage — GIF', () => {
  it('reports a single-frame GIF as a still', () => {
    expect(inspectAnimatedImage(gif([{ delayCs: 0 }]))).toEqual({
      format: 'gif',
      animated: false,
      frameCount: 1,
      durationMs: 0,
      playCount: 1,
    });
  });

  it('counts frames and sums their delays for a looping GIF', () => {
    const info = inspectAnimatedImage(
      gif([{ delayCs: 5 }, { delayCs: 10 }, { delayCs: 20 }], { loops: 0 }),
    );
    expect(info).toEqual({
      format: 'gif',
      animated: true,
      frameCount: 3,
      durationMs: 350,
      playCount: 0,
    });
  });

  it('plays delays of 10 ms or less at 100 ms, as browsers do', () => {
    // 0 cs, 1 cs, and a frame with no graphic control extension at all.
    const info = inspectAnimatedImage(gif([{ delayCs: 0 }, { delayCs: 1 }, {}, { delayCs: 2 }]));
    expect(info?.durationMs).toBe(100 + 100 + 100 + 20);
  });

  it('reads the looping extension as repeats after the first pass', () => {
    expect(inspectAnimatedImage(gif([{}, {}], { loops: 2 }))?.playCount).toBe(3);
    // No looping extension: the animation plays once.
    expect(inspectAnimatedImage(gif([{}, {}]))?.playCount).toBe(1);
  });

  it('skips global and local color tables', () => {
    const info = inspectAnimatedImage(
      gif([{ localTableBits: 2 }, { localTableBits: 7 }, {}], { globalTableBits: 7 }),
    );
    expect(info?.frameCount).toBe(3);
  });

  it('skips comment and plain-text extensions', () => {
    const comment = [0x21, 0xfe, 3, ...bytes('hey'), 0];
    const plainText = [0x21, 0x01, 12, ...new Array(12).fill(0), 2, 0x41, 0x42, 0];
    const info = inspectAnimatedImage(gif([{}, {}], { extras: [...comment, ...plainText] }));
    expect(info?.frameCount).toBe(2);
  });

  it('keeps the frames it read from a truncated GIF', () => {
    const full = gif([{ delayCs: 5 }, { delayCs: 5 }, { delayCs: 5 }], { loops: 0 });
    const info = inspectAnimatedImage(full.slice(0, full.length - 8));
    expect(info?.animated).toBe(true);
    expect(info?.frameCount).toBeGreaterThanOrEqual(2);
  });

  it('never throws on garbage after a GIF header', () => {
    const rng = new SeededRandom(7);
    for (let run = 0; run < 200; run++) {
      const noise = Array.from({ length: 64 }, () => Math.floor(rng.next() * 256));
      const input = bytes('GIF89a', ...noise);
      expect(() => inspectAnimatedImage(input)).not.toThrow();
    }
  });
});

describe('inspectAnimatedImage — APNG', () => {
  it('reads frame count, delays and plays from an animated PNG', () => {
    const info = inspectAnimatedImage(
      apng(
        [
          [1, 10],
          [1, 4],
          [0, 0],
        ],
        0,
      ),
    );
    expect(info).toEqual({
      format: 'png',
      animated: true,
      frameCount: 3,
      // 1/10 s + 1/4 s + a 0-length frame played at 100 ms.
      durationMs: 100 + 250 + 100,
      playCount: 0,
    });
  });

  it('honors a finite play count', () => {
    expect(
      inspectAnimatedImage(
        apng(
          [
            [1, 10],
            [1, 10],
          ],
          3,
        ),
      )?.playCount,
    ).toBe(3);
  });

  it('reports an ordinary PNG as a still', () => {
    const info = inspectAnimatedImage(stillPng());
    expect(info).toMatchObject({ format: 'png', animated: false, frameCount: 1, playCount: 1 });
  });
});

describe('inspectAnimatedImage — WebP', () => {
  it('reads frames, durations and loops from an animated WebP', () => {
    expect(inspectAnimatedImage(animatedWebp([80, 120], 0))).toEqual({
      format: 'webp',
      animated: true,
      frameCount: 2,
      durationMs: 200,
      playCount: 0,
    });
    expect(inspectAnimatedImage(animatedWebp([80, 80], 2))?.playCount).toBe(2);
  });

  it('reports a simple WebP as a still', () => {
    expect(inspectAnimatedImage(stillWebp())).toMatchObject({
      format: 'webp',
      animated: false,
      frameCount: 1,
    });
  });
});

describe('inspectAnimatedImage — other input', () => {
  it('returns null for formats that cannot animate and for empty input', () => {
    expect(inspectAnimatedImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBeNull();
    expect(inspectAnimatedImage(new Uint8Array())).toBeNull();
  });

  it('accepts an ArrayBuffer', () => {
    const source = gif([{}, {}], { loops: 0 });
    const buffer = new ArrayBuffer(source.byteLength);
    new Uint8Array(buffer).set(source);
    expect(inspectAnimatedImage(buffer)?.animated).toBe(true);
  });
});

describe('mayBeAnimatedImage', () => {
  it('accepts paths and URLs with an animatable extension', () => {
    expect(mayBeAnimatedImage('images/party.gif')).toBe(true);
    expect(mayBeAnimatedImage('IMAGES/PARTY.GIF')).toBe(true);
    expect(mayBeAnimatedImage('https://example.com/a/loop.webp?w=400#x')).toBe(true);
    expect(mayBeAnimatedImage('spinner.apng')).toBe(true);
  });

  it('accepts animatable MIME types and data URLs', () => {
    expect(mayBeAnimatedImage('image/gif')).toBe(true);
    expect(mayBeAnimatedImage('data:image/gif;base64,R0lGODlh')).toBe(true);
    expect(mayBeAnimatedImage('data:image/webp,xyz')).toBe(true);
  });

  it('rejects stills, PNG, and look-alikes', () => {
    expect(mayBeAnimatedImage('photo.jpg')).toBe(false);
    expect(mayBeAnimatedImage('screenshot.png')).toBe(false);
    expect(mayBeAnimatedImage('data:image/png;base64,iVBOR')).toBe(false);
    expect(mayBeAnimatedImage('image/gif.png')).toBe(false);
    expect(mayBeAnimatedImage('folder.gif/readme')).toBe(false);
    expect(mayBeAnimatedImage('')).toBe(false);
  });
});
