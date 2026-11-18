/**
 * What a reader should know about a web address before it opens: which site
 * it really reaches, and the usual ways an address hides that. Pure, so the
 * confirmation dialog and its tests read the same facts.
 */

/** The address as a web URL, when it is one (`http:`, `https:`, or `//host`). */
export function externalLinkUrl(href: string): URL | null {
  const trimmed = href.trim();
  if (!/^(?:https?:)?\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export interface LinkInspection {
  url: URL;
  /** The site the browser contacts: lowercase, international names in their `xn--` form. */
  host: string;
  /** Text before an `@` in the address, which reads like a site but is only a user name. */
  userName?: string;
  /** The site the link's own text names, when that is not where it goes. */
  textHost?: string;
  /** The address a redirect parameter passes the reader on to, when it is another site. */
  leadsTo?: URL;
  /** The site's name holds letters from other alphabets (an `xn--` label). */
  internationalHost: boolean;
  /** Plain `http:`: the page is not encrypted. */
  insecure: boolean;
}

/** Query parameters redirectors and sign-in pages pass the next address in. */
const REDIRECT_PARAMS = [
  'url',
  'u',
  'q',
  'target',
  'dest',
  'destination',
  'redirect',
  'redirect_url',
  'redirect_uri',
  'continue',
  'next',
  'to',
  'link',
];

/**
 * The name a site registered (`google.com` for `accounts.google.com`), close
 * enough without the public suffix list: the last two labels, or three under a
 * country's second-level suffix (`bbc.co.uk`). An IP address is its own site.
 */
function siteOf(host: string): string {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(name) || name.includes(':')) return name;
  const labels = name.split('.');
  const take =
    labels.length > 2 &&
    labels[labels.length - 1]!.length === 2 &&
    labels[labels.length - 2]!.length <= 3
      ? 3
      : 2;
  return labels.slice(-take).join('.');
}

/** Both names belong to one registered site (`mail.x.test` and `x.test`). */
function sameSite(a: string, b: string): boolean {
  return siteOf(a) === siteOf(b);
}

/** The host link text names, when it reads as an address or a domain. */
function hostNamedBy(text: string): string | undefined {
  const value = text.trim();
  if (!value || /\s/.test(value)) return undefined;
  if (value.includes('@') && !value.includes('/')) return undefined; // an email address
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  if (!/^https?:\/\//i.test(candidate)) return undefined;
  try {
    const host = new URL(candidate).hostname;
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) || host.startsWith('xn--') ? host : undefined;
  } catch {
    return undefined;
  }
}

function redirectTarget(url: URL): URL | undefined {
  for (const name of REDIRECT_PARAMS) {
    const value = url.searchParams.get(name);
    if (!value) continue;
    const next = externalLinkUrl(value);
    if (next && !sameSite(next.hostname, url.hostname)) return next;
  }
  return undefined;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function inspectLink(url: URL, linkText?: string): LinkInspection {
  const host = url.hostname.toLowerCase();
  const userName = url.username ? decoded(url.username) : undefined;
  const leadsTo = redirectTarget(url);
  const named = linkText ? hostNamedBy(linkText) : undefined;
  const textHost =
    named && !sameSite(named, host) && !(leadsTo && sameSite(named, leadsTo.hostname.toLowerCase()))
      ? named
      : undefined;
  return {
    url,
    host,
    ...(userName ? { userName } : {}),
    ...(textHost ? { textHost } : {}),
    ...(leadsTo ? { leadsTo } : {}),
    internationalHost: host.split('.').some((label) => label.startsWith('xn--')),
    insecure: url.protocol === 'http:',
  };
}
