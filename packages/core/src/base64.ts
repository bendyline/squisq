/** Browser- and Node-compatible base64 helpers with no runtime dependencies. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1]! : 0;
    const third = hasThird ? bytes[index + 2]! : 0;
    const value = (first << 16) | (second << 8) | third;
    output += ALPHABET[(value >>> 18) & 63];
    output += ALPHABET[(value >>> 12) & 63];
    output += hasSecond ? ALPHABET[(value >>> 6) & 63] : '=';
    output += hasThird ? ALPHABET[value & 63] : '=';
  }
  return output;
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/[\t\n\r ]/g, '');
  if (
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new TypeError('Invalid base64 data');
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((normalized.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < normalized.length; index += 4) {
    const a = ALPHABET.indexOf(normalized[index]!);
    const b = ALPHABET.indexOf(normalized[index + 1]!);
    const c = normalized[index + 2] === '=' ? 0 : ALPHABET.indexOf(normalized[index + 2]!);
    const d = normalized[index + 3] === '=' ? 0 : ALPHABET.indexOf(normalized[index + 3]!);
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < output.length) output[outputIndex++] = (packed >>> 16) & 255;
    if (outputIndex < output.length) output[outputIndex++] = (packed >>> 8) & 255;
    if (outputIndex < output.length) output[outputIndex++] = packed & 255;
  }
  return output;
}

export function base64ToUtf8(value: string): string {
  return new TextDecoder().decode(base64ToBytes(value));
}
