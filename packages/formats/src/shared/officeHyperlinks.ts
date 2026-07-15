import { sanitizeUrl } from '@bendyline/squisq/markdown';

export interface OfficeHyperlinkPolicy {
  /** Allow non-root relative document links. Default: false. */
  allowRelative?: boolean;
}

/**
 * Office external relationships can launch local files, UNC shares, or custom
 * protocol handlers. Keep the default narrower than HTML navigation: web,
 * mail, telephone, and in-document fragments only. Relative document links are
 * available as an explicit export option for callers that need them.
 */
export function sanitizeOfficeHyperlink(
  input: string | null | undefined,
  policy: OfficeHyperlinkPolicy = {},
): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || hasControls(value)) return null;
  if (value.startsWith('#')) return /^#[^\s]*$/.test(value) ? value : null;
  if (/^(?:\\\\|\/\/|\/|[a-z]:[\\/])/i.test(value)) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme) return sanitizeUrl(value);
  if (!policy.allowRelative || value.includes('\\')) return null;

  // Reject encoded controls and encoded path separators that can change how a
  // consumer interprets the relationship target after decoding.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (hasControls(decoded) || decoded.includes('\\') || decoded.startsWith('//')) return null;
  return value;
}

function hasControls(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
