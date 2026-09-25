/**
 * Animated-image inspection.
 *
 * Reads the container structure of a GIF, PNG (APNG) or WebP byte stream and
 * reports whether it animates, how many frames it has, how long one pass
 * takes, and how many passes the file asks for. It lets a renderer decide
 * whether an image deserves playback controls, and lets the image editor
 * refuse to flatten an animation into a still.
 *
 * Structure only: no pixel data is decoded. GIF image data is skipped by
 * sub-block length and PNG/WebP chunks by their size fields, so a scan is
 * linear in the number of blocks. Truncated or malformed input never throws;
 * the scan stops and reports what it read.
 */

export type AnimatedImageFormat = 'gif' | 'png' | 'webp';

export interface AnimatedImageInfo {
  format: AnimatedImageFormat;
  /** True when the image has more than one frame to play. */
  animated: boolean;
  /** Frames in one pass. 1 for a still image. */
  frameCount: number;
  /**
   * Length of one pass in milliseconds, timed the way browsers play it: a
   * frame delay of 10 ms or less plays at 100 ms. 0 for a still image.
   */
  durationMs: number;
  /** Passes the file asks for; 0 means it loops forever. 1 for a still image. */
  playCount: number;
}

/** Browsers stretch frame delays at or below this to {@link CLAMPED_DELAY_MS}. */
const MIN_FRAME_DELAY_MS = 10;
const CLAMPED_DELAY_MS = 100;

/**
 * Inspect an image's bytes. Returns `null` when the bytes are not a GIF, PNG
 * or WebP (a JPEG, for instance, can never animate).
 */
export function inspectAnimatedImage(input: Uint8Array | ArrayBuffer): AnimatedImageInfo | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return inspectGif(bytes) ?? inspectPng(bytes) ?? inspectWebp(bytes);
}

const ANIMATABLE_EXTENSIONS = new Set(['gif', 'webp', 'apng']);
const ANIMATABLE_MIME = /^image\/(?:gif|webp|apng)(?=$|[;,\s])/i;

/**
 * Whether a path, URL or MIME type names a format that can animate, i.e.
 * whether reading its bytes is worthwhile. PNG is deliberately excluded: APNG
 * is rare and nearly every screenshot is a PNG, so sniffing them all would
 * cost far more than it finds. A caller already holding a PNG's bytes can
 * still pass them to {@link inspectAnimatedImage}.
 */
export function mayBeAnimatedImage(srcOrMime: string): boolean {
  const value = srcOrMime.trim();
  if (!value) return false;
  if (/^data:/i.test(value)) return ANIMATABLE_MIME.test(value.slice(5));
  if (ANIMATABLE_MIME.test(value)) return true;
  const path = value.split(/[?#]/, 1)[0] ?? '';
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/')) return false;
  return ANIMATABLE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

// ── GIF ────────────────────────────────────────────────────────────

function inspectGif(b: Uint8Array): AnimatedImageInfo | null {
  // "GIF87a" / "GIF89a" + the 7-byte logical screen descriptor.
  if (b.length < 13) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38) return null;
  if ((b[4] !== 0x37 && b[4] !== 0x39) || b[5] !== 0x61) return null;

  let pos = 13 + colorTableSize(b[10]);
  let frames = 0;
  let duration = 0;
  let pendingDelayMs = 0;
  // A GIF without a looping extension plays once.
  let playCount = 1;

  while (pos < b.length) {
    const marker = b[pos++];
    if (marker === 0x3b) break; // trailer

    if (marker === 0x21) {
      // Extension: a label byte, then data sub-blocks.
      if (pos >= b.length) break;
      const label = b[pos++];
      if (label === 0xf9 && pos + 3 < b.length && b[pos] >= 4) {
        // Graphic control: [size=4][packed][delay lo][delay hi][transparent][0].
        // The delay is in hundredths of a second and applies to the next image.
        pendingDelayMs = (b[pos + 2] | (b[pos + 3] << 8)) * 10;
      } else if (label === 0xff && b[pos] === 11 && pos + 12 <= b.length) {
        // Application: an 11-byte identifier block, then its data sub-blocks.
        const id = ascii(b, pos + 1, 11);
        const sub = pos + 12;
        if (
          (id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') &&
          sub + 3 < b.length &&
          b[sub] >= 3 &&
          b[sub + 1] === 0x01
        ) {
          // The loop count is REPEATS after the first pass; 0 loops forever.
          const loops = b[sub + 2] | (b[sub + 3] << 8);
          playCount = loops === 0 ? 0 : loops + 1;
        }
      }
      pos = skipSubBlocks(b, pos);
      if (pos < 0) break;
      continue;
    }

    if (marker === 0x2c) {
      // Image descriptor: left, top, width, height (u16 each), packed.
      if (pos + 9 > b.length) break;
      const packed = b[pos + 8];
      pos += 9 + colorTableSize(packed);
      pos += 1; // LZW minimum code size
      frames++;
      duration += playedDelay(pendingDelayMs);
      pendingDelayMs = 0;
      pos = skipSubBlocks(b, pos);
      if (pos < 0) break;
      continue;
    }

    break; // not a GIF block — keep what was read
  }

  return result('gif', frames, duration, playCount);
}

/** Bytes in the color table a GIF packed field declares (0 when absent). */
function colorTableSize(packed: number): number {
  return packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
}

/** Skip a run of GIF data sub-blocks. Returns the position after the
 *  terminator, or -1 when the input ends first. */
function skipSubBlocks(b: Uint8Array, start: number): number {
  let pos = start;
  while (pos < b.length) {
    const size = b[pos];
    pos += 1;
    if (size === 0) return pos;
    pos += size;
  }
  return -1;
}

// ── PNG / APNG ─────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function inspectPng(b: Uint8Array): AnimatedImageInfo | null {
  if (b.length < PNG_SIGNATURE.length) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (b[i] !== PNG_SIGNATURE[i]) return null;
  }

  let pos = PNG_SIGNATURE.length;
  let hasAnimationControl = false;
  let frames = 1;
  let playCount = 1;
  let duration = 0;

  // Chunk: [length u32][type 4][data][crc u32].
  while (pos + 8 <= b.length) {
    const length = readU32BE(b, pos);
    const type = ascii(b, pos + 4, 4);
    const data = pos + 8;
    if (type === 'acTL' && length >= 8 && data + 8 <= b.length) {
      hasAnimationControl = true;
      frames = readU32BE(b, data);
      playCount = readU32BE(b, data + 4);
    } else if (type === 'fcTL' && length >= 26 && data + 26 <= b.length) {
      // Frame control: delay_num / delay_den seconds (a 0 denominator means 100).
      const num = readU16BE(b, data + 20);
      const den = readU16BE(b, data + 22) || 100;
      duration += playedDelay((num * 1000) / den);
    } else if (type === 'IDAT' && !hasAnimationControl) {
      break; // acTL must precede the image data, so this is a still PNG
    } else if (type === 'IEND') {
      break;
    }
    pos = data + length + 4;
  }

  return result('png', hasAnimationControl ? frames : 1, duration, playCount);
}

// ── WebP ───────────────────────────────────────────────────────────

function inspectWebp(b: Uint8Array): AnimatedImageInfo | null {
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;

  let pos = 12;
  let animationFlag = false;
  let frames = 0;
  let duration = 0;
  let loopCount: number | null = null;

  // Chunk: [fourcc 4][size u32 LE][data, padded to an even length].
  while (pos + 8 <= b.length) {
    const type = ascii(b, pos, 4);
    const size = readU32LE(b, pos + 4);
    const data = pos + 8;
    if (type === 'VP8X' && size >= 10 && data < b.length) {
      animationFlag = (b[data] & 0x02) !== 0;
      if (!animationFlag) break;
    } else if (type === 'ANIM' && size >= 6 && data + 6 <= b.length) {
      loopCount = b[data + 4] | (b[data + 5] << 8); // 0 loops forever
    } else if (type === 'ANMF' && size >= 16 && data + 15 <= b.length) {
      // Frame: x, y, width-1, height-1 (u24 each), then duration (u24 ms).
      frames++;
      duration += playedDelay(b[data + 12] | (b[data + 13] << 8) | (b[data + 14] << 16));
    } else if ((type === 'VP8 ' || type === 'VP8L') && !animationFlag) {
      break; // simple (still) WebP
    }
    pos = data + size + (size & 1);
  }

  const frameCount = animationFlag ? frames : 1;
  return result('webp', frameCount, duration, loopCount ?? 0);
}

// ── Shared ─────────────────────────────────────────────────────────

function result(
  format: AnimatedImageFormat,
  frameCount: number,
  durationMs: number,
  playCount: number,
): AnimatedImageInfo {
  const animated = frameCount > 1;
  return {
    format,
    animated,
    frameCount: Math.max(frameCount, 1),
    durationMs: animated ? Math.round(durationMs) : 0,
    playCount: animated ? playCount : 1,
  };
}

function playedDelay(ms: number): number {
  return ms <= MIN_FRAME_DELAY_MS ? CLAMPED_DELAY_MS : ms;
}

function ascii(b: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
}

function readU16BE(b: Uint8Array, pos: number): number {
  return (b[pos] << 8) | b[pos + 1];
}

function readU32BE(b: Uint8Array, pos: number): number {
  return ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) >>> 0;
}

function readU32LE(b: Uint8Array, pos: number): number {
  return (b[pos] | (b[pos + 1] << 8) | (b[pos + 2] << 16) | (b[pos + 3] << 24)) >>> 0;
}
