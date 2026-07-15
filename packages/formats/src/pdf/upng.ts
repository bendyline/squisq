import UPNG from '@pdf-lib/upng';

interface UpngEncoder {
  encode(images: ArrayBuffer[], width: number, height: number, colorCount: number): ArrayBuffer;
}

function isUpngEncoder(value: unknown): value is UpngEncoder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'encode' in value &&
    typeof value.encode === 'function'
  );
}

/**
 * Normalize @pdf-lib/upng across bundler and native Node ESM interop.
 *
 * Vite exposes the CommonJS export directly, while Node wraps it in a
 * second `default` property when consuming the built package.
 */
export function resolveUpngEncoder(value: unknown): UpngEncoder | null {
  if (isUpngEncoder(value)) return value;
  if (typeof value !== 'object' || value === null || !('default' in value)) return null;
  return isUpngEncoder(value.default) ? value.default : null;
}

export const upngEncoder = resolveUpngEncoder(UPNG);
