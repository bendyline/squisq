/**
 * A deliberately small syntax highlighter for the documentation site's code
 * blocks. It knows just enough of each language to make examples scannable —
 * above all Squiggly Square tags in Markdown — and never changes the text:
 * every token is re-escaped, so the highlighted block reads identically.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

export function decodeHtml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (entity) => ENTITIES[entity] ?? entity);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function span(kind: string, text: string): string {
  return `<span class="hl-${kind}">${escapeHtml(text)}</span>`;
}

/** A language: an ordered list of [token kind, pattern]; earlier patterns win. */
type Grammar = ReadonlyArray<readonly [kind: string, pattern: RegExp]>;

function tokenize(code: string, grammar: Grammar): string {
  const source = grammar.map(([, pattern]) => `(${pattern.source})`).join('|');
  const master = new RegExp(source, 'gm');
  let out = '';
  let last = 0;
  for (const match of code.matchAll(master)) {
    const index = match.index ?? 0;
    if (match[0] === '') {
      master.lastIndex += 1;
      continue;
    }
    out += escapeHtml(code.slice(last, index));
    const group = match.slice(1).findIndex((value) => value !== undefined);
    const kind = grammar[group]?.[0] ?? 'plain';
    out += kind === 'tag' ? highlightTag(match[0]) : span(kind, match[0]);
    last = index + match[0].length;
  }
  return out + escapeHtml(code.slice(last));
}

/** `{[name key=value key="quoted value"]}` — the tag's own anatomy. */
function highlightTag(tag: string): string {
  const inner = tag.slice(2, -2);
  const parts: string[] = [];
  const pattern = /("[^"]*"|'[^']*')|([\w.:-]+)(=)|([^\s="']+)|(\s+)/g;
  let first = true;
  for (const match of inner.matchAll(pattern)) {
    const [, quoted, key, equals, word, space] = match;
    if (quoted) parts.push(span('string', quoted));
    else if (key) {
      parts.push(span('attr', key), span('punct', equals));
      first = false;
    } else if (word) {
      parts.push(span(first ? 'tag-name' : 'string', word));
      first = false;
    } else if (space) parts.push(escapeHtml(space));
  }
  return `<span class="hl-tag">${span('punct', '{[')}${parts.join('')}${span('punct', ']}')}</span>`;
}

const MARKDOWN: Grammar = [
  ['tag', /\{\[[^\]\n]*\]\}/],
  ['heading', /^#{1,6} [^\n{]*/],
  ['meta', /^(?:`{3,}|~{3,})[^\n]*/],
  ['punct', /^ *(?:[-*+]|\d+[.)])(?= )|^>+|^---$|^\|.*\|$/],
  ['code', /`[^`\n]+`/],
  ['link', /!?\[[^\]\n]*\]\([^)\n]*\)/],
  ['strong', /\*\*[^*\n]+\*\*/],
];

const FRONTMATTER: Grammar = [
  ['punct', /^---$/],
  ['comment', /#[^\n]*/],
  ['attr', /^[\w-]+(?=:)/],
  ['string', /"[^"\n]*"|'[^'\n]*'/],
];

/** Markdown, with fenced bodies left alone and frontmatter read as YAML. */
function highlightMarkdown(code: string): string {
  let out = '';
  let rest = code;
  const frontmatter = /^---\n[\s\S]*?\n---(?=\n|$)/.exec(rest);
  if (frontmatter) {
    out += tokenize(frontmatter[0], FRONTMATTER);
    rest = rest.slice(frontmatter[0].length);
  }
  const fence = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;
  let last = 0;
  for (const match of rest.matchAll(fence)) {
    const index = match.index ?? 0;
    out += tokenize(rest.slice(last, index), MARKDOWN);
    const [whole, marker, body] = match;
    const opener = whole.slice(0, whole.indexOf('\n'));
    out += span('meta', opener) + '\n' + escapeHtml(body) + span('meta', marker);
    last = index + whole.length;
  }
  return out + tokenize(rest.slice(last), MARKDOWN);
}

const SCRIPT_KEYWORDS =
  'abstract|as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|of|private|protected|public|readonly|return|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield';

const SCRIPT: Grammar = [
  ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
  ['string', /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/],
  ['keyword', new RegExp(`\\b(?:${SCRIPT_KEYWORDS})\\b`)],
  ['tag-name', /<\/?[A-Z][\w.]*/],
  ['number', /\b\d[\d_]*(?:\.\d+)?\b/],
];

const SHELL: Grammar = [
  ['comment', /(?:^|(?<=\s))#[^\n]*/],
  ['string', /'[^'\n]*'|"(?:\\.|[^"\\\n])*"/],
  ['keyword', /^ *(?:npm|npx|node|squisq|cd|mkdir|git|curl|cat|echo|export)\b/],
  ['attr', /(?<=\s)--?[\w-]+/],
];

const JSON_GRAMMAR: Grammar = [
  ['attr', /"(?:\\.|[^"\\\n])*"(?=\s*:)/],
  ['string', /"(?:\\.|[^"\\\n])*"/],
  ['keyword', /\b(?:true|false|null)\b/],
  ['number', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
];

const HTML_GRAMMAR: Grammar = [
  ['comment', /<!--[\s\S]*?-->/],
  ['tag-name', /<\/?[\w-]+|\/?>/],
  ['string', /"[^"]*"|'[^']*'/],
  ['attr', /\b[\w:-]+(?==)/],
];

const YAML: Grammar = [
  ['comment', /(?:^|(?<=\s))#[^\n]*/],
  ['attr', /^ *[\w-]+(?=:)/],
  ['string', /"[^"\n]*"|'[^'\n]*'/],
  ['punct', /^---$/],
];

const LANGUAGES: Record<string, (code: string) => string> = {
  markdown: highlightMarkdown,
  md: highlightMarkdown,
  ts: (code) => tokenize(code, SCRIPT),
  tsx: (code) => tokenize(code, SCRIPT),
  typescript: (code) => tokenize(code, SCRIPT),
  js: (code) => tokenize(code, SCRIPT),
  jsx: (code) => tokenize(code, SCRIPT),
  javascript: (code) => tokenize(code, SCRIPT),
  bash: (code) => tokenize(code, SHELL),
  sh: (code) => tokenize(code, SHELL),
  shell: (code) => tokenize(code, SHELL),
  json: (code) => tokenize(code, JSON_GRAMMAR),
  html: (code) => tokenize(code, HTML_GRAMMAR),
  xml: (code) => tokenize(code, HTML_GRAMMAR),
  yaml: (code) => tokenize(code, YAML),
  yml: (code) => tokenize(code, YAML),
};

/** Highlight already-escaped code text for `lang`; unknown languages pass through. */
export function highlightEscapedCode(escaped: string, lang: string | undefined): string {
  const highlight = lang ? LANGUAGES[lang.toLowerCase()] : undefined;
  if (!highlight) return escaped;
  return highlight(decodeHtml(escaped));
}
