const RELATIVE_DOCUMENT_EXTENSIONS = new Set([
  'csv',
  'doc',
  'docx',
  'epub',
  'gif',
  'htm',
  'html',
  'jpeg',
  'jpg',
  'json',
  'markdown',
  'md',
  'mp3',
  'mp4',
  'ods',
  'odt',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'svg',
  'tsv',
  'txt',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
  'zip',
]);

function looksLikeBareWebHost(value: string): boolean {
  if (/\s|@|\\/.test(value)) return false;

  const authority = value.split(/[/?#]/, 1)[0] ?? '';
  const hostname = authority.replace(/:\d+$/, '').toLowerCase();
  if (!hostname) return false;
  if (hostname === 'localhost') return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return true;

  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some((label) => !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))) {
    return false;
  }

  const suffix = labels[labels.length - 1] ?? '';
  return /^[a-z]{2,63}$/i.test(suffix) && !RELATIVE_DOCUMENT_EXTENSIONS.has(suffix);
}

/**
 * Resolve links that the demo host should open as websites. Markdown anchors,
 * relative document paths, and non-web schemes are deliberately left alone so
 * the browser or an embedding document host can handle them normally.
 */
export function resolveExternalLinkHref(href: string): string | null {
  const value = href.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      new URL(value);
      return value;
    } catch {
      return null;
    }
  }
  if (value.startsWith('//')) {
    try {
      return new URL(`https:${value}`).href;
    } catch {
      return null;
    }
  }
  if (/^[#/?]|^\.{1,2}(?:\/|$)/.test(value)) return null;

  if (looksLikeBareWebHost(value)) {
    try {
      return new URL(`https://${value}`).href;
    } catch {
      return null;
    }
  }

  return null;
}

type OpenWindow = (url: string, target: string, features: string) => unknown;

/** Open a web link in an isolated tab. Returns false when the href is not a website. */
export function openExternalLink(href: string, openWindow?: OpenWindow): boolean {
  const resolvedHref = resolveExternalLinkHref(href);
  if (!resolvedHref) return false;

  const open = openWindow ?? ((url, target, features) => window.open(url, target, features));
  open(resolvedHref, '_blank', 'noopener,noreferrer');
  return true;
}
