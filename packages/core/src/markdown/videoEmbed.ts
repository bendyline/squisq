/**
 * Hosted-video embeds (YouTube, Vimeo, Loom, Dailymotion, Wistia).
 *
 * The authored form is a paragraph that is ONLY a link, or a bare URL, to a
 * video page:
 *
 * ```markdown
 * [Launch keynote](https://www.youtube.com/watch?v=dQw4w9WgXcQ)
 *
 * https://vimeo.com/76979871
 * ```
 *
 * GitHub, Notion and Medium all follow this convention. It degrades to a working
 * link in every plain markdown renderer and in every document exporter
 * (DOCX/PDF/EPUB), and renderers that know the convention swap in the
 * provider's player. A link inside prose stays a link: only a paragraph made of
 * nothing else is an embed. An `<iframe>` embed snippet copied from a provider's
 * Share → Embed dialog is recognized too ({@link findBlockVideoEmbed} on an
 * `htmlBlock`, {@link parseVideoEmbedInput} for pasted text).
 *
 * The iframe `src` is ALWAYS rebuilt from validated parts — provider, an id
 * matched against the provider's id grammar, a whole-second start offset — on a
 * fixed provider origin. An author's URL never reaches an iframe, which is what
 * lets the HTML sanitizer admit these iframes while it drops every other one.
 */

import { parseHtmlToNodes } from './htmlParse.js';
import type { HtmlElement, HtmlNode, MarkdownBlockNode, MarkdownInlineNode } from './types.js';
import { extractPlainText } from './utils.js';

export type VideoEmbedProviderId = 'youtube' | 'vimeo' | 'loom' | 'dailymotion' | 'wistia';

/** Display facts about a supported provider, for pickers and help text. */
export interface VideoEmbedProviderInfo {
  id: VideoEmbedProviderId;
  /** Human-readable name, e.g. `YouTube`. */
  name: string;
  /** A representative page URL, for placeholder and help text. */
  example: string;
}

/** The supported providers, in the order UI should list them. */
export const VIDEO_EMBED_PROVIDERS: readonly VideoEmbedProviderInfo[] = [
  { id: 'youtube', name: 'YouTube', example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { id: 'vimeo', name: 'Vimeo', example: 'https://vimeo.com/76979871' },
  {
    id: 'loom',
    name: 'Loom',
    example: 'https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184',
  },
  { id: 'dailymotion', name: 'Dailymotion', example: 'https://www.dailymotion.com/video/x7tgad0' },
  { id: 'wistia', name: 'Wistia', example: 'https://home.wistia.com/medias/e4a27b971d' },
];

const PROVIDER_NAMES: Record<VideoEmbedProviderId, string> = Object.fromEntries(
  VIDEO_EMBED_PROVIDERS.map((p) => [p.id, p.name]),
) as Record<VideoEmbedProviderId, string>;

/** A recognized hosted video, normalized. */
export interface VideoEmbed {
  provider: VideoEmbedProviderId;
  /** Human-readable provider name, e.g. `YouTube`. */
  providerName: string;
  /**
   * The provider's id for what plays: a video id, or — for a YouTube
   * playlist link with no video — the playlist id.
   */
  id: string;
  /** YouTube playlist the video plays within, when the URL named one. */
  playlistId?: string;
  /** The player URL for an `<iframe src>`. Rebuilt from validated parts. */
  embedUrl: string;
  /**
   * The canonical page URL: what a markdown link should point at. Tracking
   * parameters (`si=`, `feature=`, `pp=` …) are dropped; the start offset and
   * playlist are kept. An embed-only URL (`/embed/<id>`) maps back to the
   * watch page, so a pasted iframe still degrades to a link a reader can open.
   */
  watchUrl: string;
  /** Start offset in whole seconds, when the URL carried one. */
  startSeconds?: number;
  /**
   * A still poster image, when the provider serves one at a predictable URL
   * with no API call (YouTube, Dailymotion). Remote — callers that must stay
   * offline should not fetch it.
   */
  thumbnailUrl?: string;
  /** Frame width ÷ height: 16/9, or 9/16 for YouTube Shorts. */
  aspectRatio: number;
}

/** A block that should render as a hosted-video player. */
export interface BlockVideoEmbed {
  embed: VideoEmbed;
  /**
   * The author's label for the video — the link text — or null when the
   * paragraph is a bare URL. For an `<iframe>` block it is the iframe's
   * `title`, unless that is a provider's generic "… video player" title.
   */
  title: string | null;
  /** How the block was written. */
  form: 'link' | 'url' | 'iframe';
}

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 16;

// ── URL normalization ──────────────────────────────────────────────

/**
 * Markdown backslash escapes (`\_`) can survive in a link destination that
 * came through an editor bridge. A backslash never appears in a video URL, and
 * the WHATWG parser would turn it into a `/`, so undo the escape first.
 */
function unescapeMarkdown(value: string): string {
  return value.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

function toUrl(input: string): URL | null {
  let text = unescapeMarkdown(input.trim());
  // CommonMark autolink form: `<https://…>`.
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1).trim();
  if (!text || /\s/.test(text)) return null;
  if (text.startsWith('//')) text = `https:${text}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  return url;
}

/** `www.youtube.com` / `m.youtube.com` → `youtube.com`. */
function baseHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
}

function pathSegments(url: URL): string[] {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/** A `key=value` from a URL fragment (`#t=1m30s`). */
function fragmentParam(url: URL, key: string): string | null {
  const hash = url.hash.replace(/^#/, '');
  if (!hash) return null;
  return new URLSearchParams(hash).get(key);
}

const HMS_RE = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/;
const CLOCK_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;

/**
 * A start offset as providers write it — `90`, `90s`, `1m30s`, `1h2m3s`,
 * `1:30`, `1:02:03` — in whole seconds; undefined when absent, zero or
 * unreadable.
 */
export function parseVideoStartTime(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  let total: number | null = null;
  const hms = HMS_RE.exec(value);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    total = Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0);
  } else {
    const clock = CLOCK_RE.exec(value);
    const minutes = Number(clock?.[2]);
    const seconds = Number(clock?.[3]);
    if (clock && seconds < 60 && (clock[1] === undefined || minutes < 60)) {
      total = Number(clock[1] ?? 0) * 3600 + minutes * 60 + seconds;
    }
  }
  if (total === null || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.floor(total);
}

function withQuery(base: string, params: Array<[string, string | undefined]>): string {
  const query = params
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}

function build(
  provider: VideoEmbedProviderId,
  fields: Omit<VideoEmbed, 'provider' | 'providerName' | 'aspectRatio'> & {
    aspectRatio?: number;
  },
): VideoEmbed {
  const embed: VideoEmbed = {
    provider,
    providerName: PROVIDER_NAMES[provider],
    id: fields.id,
    embedUrl: fields.embedUrl,
    watchUrl: fields.watchUrl,
    aspectRatio: fields.aspectRatio ?? LANDSCAPE,
  };
  if (fields.playlistId) embed.playlistId = fields.playlistId;
  if (fields.startSeconds) embed.startSeconds = fields.startSeconds;
  if (fields.thumbnailUrl) embed.thumbnailUrl = fields.thumbnailUrl;
  return embed;
}

// ── Providers ──────────────────────────────────────────────────────

const YOUTUBE_HOSTS = new Set(['youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_LIST_RE = /^[A-Za-z0-9_-]{2,80}$/;
/** Path heads under youtube.com whose second segment is the video id. */
const YOUTUBE_ID_PATHS = new Set(['embed', 'v', 'e', 'live', 'shorts']);
/**
 * Privacy-enhanced mode: no cookies until the viewer presses play. Plays
 * identically; the watch page link still points at youtube.com.
 */
const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

function parseYouTube(url: URL): VideoEmbed | null {
  const host = baseHost(url);
  const segments = pathSegments(url);
  const params = url.searchParams;
  let id: string | null = null;
  let shorts = false;

  if (host === 'youtu.be') {
    id = segments[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [head, second] = segments;
    if (head === 'watch') id = params.get('v');
    else if (head && YOUTUBE_ID_PATHS.has(head) && second !== 'videoseries') {
      id = second ?? null;
      shorts = head === 'shorts';
    } else if (head !== 'playlist' && !(head === 'embed' && second === 'videoseries')) {
      return null;
    }
  } else {
    return null;
  }

  if (id !== null && !YOUTUBE_ID_RE.test(id)) return null;
  const list = params.get('list');
  const playlistId = list && YOUTUBE_LIST_RE.test(list) ? list : undefined;
  if (!id && !playlistId) return null;

  const startSeconds = parseVideoStartTime(
    params.get('t') ?? params.get('start') ?? fragmentParam(url, 't'),
  );
  const start = startSeconds ? String(startSeconds) : undefined;

  if (!id) {
    return build('youtube', {
      id: playlistId!,
      playlistId,
      embedUrl: withQuery(`${YOUTUBE_EMBED_ORIGIN}/embed/videoseries`, [['list', playlistId]]),
      watchUrl: withQuery('https://www.youtube.com/playlist', [['list', playlistId]]),
    });
  }

  return build('youtube', {
    id,
    playlistId,
    startSeconds,
    embedUrl: withQuery(`${YOUTUBE_EMBED_ORIGIN}/embed/${id}`, [
      ['list', playlistId],
      ['start', start],
    ]),
    watchUrl: shorts
      ? `https://www.youtube.com/shorts/${id}`
      : withQuery('https://www.youtube.com/watch', [
          ['v', id],
          ['list', playlistId],
          ['t', start && `${start}s`],
        ]),
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    aspectRatio: shorts ? PORTRAIT : LANDSCAPE,
  });
}

const VIMEO_ID_RE = /^\d{1,12}$/;
const VIMEO_HASH_RE = /^[0-9a-f]{6,24}$/i;

function vimeoIdFromSegments(segments: string[]): { id: string; hash?: string } | null {
  const [a, b, c, d] = segments;
  if (a && VIMEO_ID_RE.test(a)) {
    return { id: a, ...(b && VIMEO_HASH_RE.test(b) ? { hash: b } : {}) };
  }
  if (a === 'video' && b && VIMEO_ID_RE.test(b)) return { id: b };
  if (a === 'channels' && c && VIMEO_ID_RE.test(c)) return { id: c };
  if (a === 'groups' && c === 'videos' && d && VIMEO_ID_RE.test(d)) return { id: d };
  if ((a === 'album' || a === 'showcase') && c === 'video' && d && VIMEO_ID_RE.test(d)) {
    return { id: d };
  }
  return null;
}

function parseVimeo(url: URL): VideoEmbed | null {
  const host = baseHost(url);
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const found = vimeoIdFromSegments(pathSegments(url));
  if (!found) return null;
  const queryHash = url.searchParams.get('h');
  const hash = found.hash ?? (queryHash && VIMEO_HASH_RE.test(queryHash) ? queryHash : undefined);
  const startSeconds = parseVideoStartTime(
    fragmentParam(url, 't') ?? url.searchParams.get('t') ?? url.searchParams.get('start'),
  );
  const timeFragment = startSeconds ? `#t=${startSeconds}s` : '';
  return build('vimeo', {
    id: found.id,
    startSeconds,
    embedUrl: withQuery(`https://player.vimeo.com/video/${found.id}`, [['h', hash]]) + timeFragment,
    watchUrl: `https://vimeo.com/${found.id}${hash ? `/${hash}` : ''}${timeFragment}`,
  });
}

/** A Loom share segment ends in the 32-hex id, sometimes after a title slug. */
const LOOM_ID_RE = /(?:^|-)([0-9a-f]{32})$/i;

function parseLoom(url: URL): VideoEmbed | null {
  if (baseHost(url) !== 'loom.com') return null;
  const [head, second] = pathSegments(url);
  if ((head !== 'share' && head !== 'embed') || !second) return null;
  const match = LOOM_ID_RE.exec(second);
  if (!match) return null;
  const id = match[1]!.toLowerCase();
  return build('loom', {
    id,
    embedUrl: `https://www.loom.com/embed/${id}`,
    watchUrl: `https://www.loom.com/share/${id}`,
  });
}

const DAILYMOTION_ID_RE = /^[A-Za-z0-9]{5,20}$/;

function parseDailymotion(url: URL): VideoEmbed | null {
  const host = baseHost(url);
  const segments = pathSegments(url);
  let raw: string | null = null;
  if (host === 'dai.ly') raw = segments[0] ?? null;
  else if (host === 'dailymotion.com') {
    if (segments[0] === 'video') raw = segments[1] ?? null;
    else if (segments[0] === 'embed' && segments[1] === 'video') raw = segments[2] ?? null;
    else return null;
  } else if (host === 'geo.dailymotion.com') {
    raw = url.searchParams.get('video');
  } else {
    return null;
  }
  // Older page URLs append a title slug: `/video/x7tgad0_some-title`.
  const id = raw?.split('_')[0];
  if (!id || !DAILYMOTION_ID_RE.test(id)) return null;
  const startSeconds = parseVideoStartTime(url.searchParams.get('start'));
  const start = startSeconds ? String(startSeconds) : undefined;
  return build('dailymotion', {
    id,
    startSeconds,
    embedUrl: withQuery(`https://www.dailymotion.com/embed/video/${id}`, [['start', start]]),
    watchUrl: withQuery(`https://www.dailymotion.com/video/${id}`, [['start', start]]),
    thumbnailUrl: `https://www.dailymotion.com/thumbnail/video/${id}`,
  });
}

const WISTIA_ID_RE = /^[a-z0-9]{10}$/;
const WISTIA_ACCOUNT_HOST_RE = /^[a-z0-9-]{1,63}\.wistia\.com$/;

function parseWistia(url: URL): VideoEmbed | null {
  const host = url.hostname.toLowerCase();
  const fastHost = host === 'fast.wistia.net' || host === 'fast.wistia.com';
  if (!fastHost && !WISTIA_ACCOUNT_HOST_RE.test(host)) return null;
  const segments = pathSegments(url);
  let raw: string | undefined;
  if (segments[0] === 'medias') raw = segments[1];
  else if (segments[0] === 'embed' && (segments[1] === 'iframe' || segments[1] === 'medias')) {
    raw = segments[2];
  }
  const id = raw?.replace(/\.jsonp$/, '');
  if (!id || !WISTIA_ID_RE.test(id)) return null;
  const embedUrl = `https://fast.wistia.net/embed/iframe/${id}`;
  return build('wistia', {
    id,
    embedUrl,
    // A media page lives on the account's own subdomain; the fast host only
    // serves the player, which doubles as a viewable page.
    watchUrl: fastHost ? embedUrl : `https://${host}/medias/${id}`,
  });
}

const PARSERS: ReadonlyArray<(url: URL) => VideoEmbed | null> = [
  parseYouTube,
  parseVimeo,
  parseLoom,
  parseDailymotion,
  parseWistia,
];

// ── Public API ─────────────────────────────────────────────────────

/**
 * Recognize a hosted-video page or player URL. Accepts the forms people paste:
 * scheme-less (`youtu.be/…`), protocol-relative (`//player.vimeo.com/…`), the
 * `<…>` autolink form, and markdown-escaped destinations. Returns null for
 * anything that is not a playable video on a supported provider — a channel,
 * a search page, a malformed id.
 */
export function parseVideoEmbedUrl(input: string | null | undefined): VideoEmbed | null {
  if (typeof input !== 'string') return null;
  const url = toUrl(input);
  if (!url) return null;
  for (const parse of PARSERS) {
    const embed = parse(url);
    if (embed) return embed;
  }
  return null;
}

/** Whether `input` is a hosted-video URL {@link parseVideoEmbedUrl} recognizes. */
export function isVideoEmbedUrl(input: string | null | undefined): boolean {
  return parseVideoEmbedUrl(input) !== null;
}

/** The value a player iframe's `allow` attribute carries. */
export const VIDEO_EMBED_IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';

/**
 * The complete attribute set for a player `<iframe>` — the ONE definition
 * every renderer and exporter emits, so a sanitized iframe and a rendered link
 * paragraph produce the same element. Attribute names are HTML (lowercase).
 *
 * `referrerpolicy` matters: YouTube refuses to play ("Error 153") when an
 * embed request carries no referrer.
 */
export function videoEmbedIframeAttributes(
  embed: VideoEmbed,
  title?: string | null,
): Record<string, string> {
  return {
    src: embed.embedUrl,
    title: title?.trim() || `${embed.providerName} video`,
    allow: VIDEO_EMBED_IFRAME_ALLOW,
    allowfullscreen: '',
    referrerpolicy: 'strict-origin-when-cross-origin',
    loading: 'lazy',
  };
}

/** A provider's stock iframe title (`YouTube video player`), not an author's label. */
const GENERIC_PLAYER_TITLE_RE = /^(?:[\w .-]+[ -])?(?:video[ -])?player$/i;

function attributeOf(element: HtmlElement, name: string): string | undefined {
  for (const [key, value] of Object.entries(element.attributes)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/**
 * The single iframe in a parsed HTML fragment, ignoring the wrapper `<div>`s
 * and `<script>` tags providers put around it. Null when there is no iframe,
 * more than one, or any visible text beside it.
 */
function soleIframe(nodes: readonly HtmlNode[]): HtmlElement | null {
  let found: HtmlElement | null = null;
  let disqualified = false;
  const visit = (list: readonly HtmlNode[]): void => {
    for (const node of list) {
      if (disqualified) return;
      if (node.type === 'htmlText') {
        if (node.value.trim()) disqualified = true;
        continue;
      }
      if (node.type !== 'htmlElement') continue;
      const tag = node.tagName.toLowerCase();
      if (tag === 'iframe') {
        if (found) disqualified = true;
        found = node;
        continue;
      }
      // Provider embed codes ship loader scripts and styles beside the
      // iframe; they are never rendered, so they never disqualify it.
      if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
      visit(node.children);
    }
  };
  visit(nodes);
  return disqualified ? null : found;
}

function iframeEmbed(element: HtmlElement): { embed: VideoEmbed; title: string | null } | null {
  const embed = parseVideoEmbedUrl(attributeOf(element, 'src'));
  if (!embed) return null;
  const title = attributeOf(element, 'title')?.trim() ?? '';
  // The fallback `videoEmbedIframeAttributes` writes (`YouTube video`) is not
  // an author's label either — a sanitized iframe carries it.
  const generic =
    GENERIC_PLAYER_TITLE_RE.test(title) ||
    title.toLowerCase() === `${embed.providerName} video`.toLowerCase();
  return { embed, title: title && !generic ? title : null };
}

/**
 * Recognize a provider iframe element (the sanitizer's entry point). Null when
 * its `src` is not a supported video.
 */
export function videoEmbedFromIframe(
  element: HtmlElement,
): { embed: VideoEmbed; title: string | null } | null {
  return element.tagName.toLowerCase() === 'iframe' ? iframeEmbed(element) : null;
}

/**
 * What a person pasted or typed where a video is expected: a page URL, or a
 * provider's `<iframe>` embed code. Null when it is neither.
 */
export function parseVideoEmbedInput(
  input: string | null | undefined,
): { embed: VideoEmbed; title: string | null } | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;
  if (/^<(?!https?:)/i.test(text)) {
    if (!/<iframe\b/i.test(text)) return null;
    const iframe = soleIframe(parseHtmlToNodes(text));
    return iframe ? iframeEmbed(iframe) : null;
  }
  const embed = parseVideoEmbedUrl(text);
  return embed ? { embed, title: null } : null;
}

function isBlankInline(node: MarkdownInlineNode): boolean {
  return (
    (node.type === 'text' && !node.value.trim()) ||
    (node.type === 'htmlInline' && node.htmlChildren.length === 0)
  );
}

/**
 * The hosted video a block stands for, or null:
 *
 *  - a paragraph whose only content is one link to a video page
 *    (`[title](url)`; `title` is the link text unless that is itself a URL);
 *  - a paragraph whose whole text is one video URL (a bare URL, which GFM
 *    autolinks — read from the text so an autolink that stopped short of a
 *    trailing `_` in the id is still recognized);
 *  - an HTML block holding a single provider `<iframe>` (pasted embed code).
 *
 * A link with surrounding prose is not an embed. Renderers ask this of
 * TOP-LEVEL blocks only: a video link in a list item or blockquote is a list
 * of links, not a stack of players. (Explicit `<iframe>` code is honored
 * wherever it appears.)
 */
export function findBlockVideoEmbed(node: MarkdownBlockNode): BlockVideoEmbed | null {
  if (node.type === 'htmlBlock') {
    const iframe = soleIframe(node.htmlChildren);
    const found = iframe ? iframeEmbed(iframe) : null;
    return found ? { ...found, form: 'iframe' } : null;
  }
  if (node.type !== 'paragraph') return null;

  const text = extractPlainText(node).trim();
  if (text && !/\s/.test(text)) {
    const bare = parseVideoEmbedUrl(text);
    if (bare) return { embed: bare, title: null, form: 'url' };
  }

  const significant = node.children.filter((child) => !isBlankInline(child));
  if (significant.length !== 1 || significant[0]!.type !== 'link') return null;
  const link = significant[0]!;
  const embed = parseVideoEmbedUrl(link.url);
  if (!embed) return null;
  const label = extractPlainText(link).trim();
  const title = label && !isVideoEmbedUrl(label) && label !== link.url ? label : null;
  return { embed, title, form: title ? 'link' : 'url' };
}
