/** Pure language normalization and Markdown-fence detection (no Monaco imports). */

export type MonacoLanguageRequest = string | readonly string[] | null | undefined;

export interface MonacoLanguageLoadOptions {
  /**
   * Enable worker-backed IDE services for CSS/HTML/JSON/JavaScript/TypeScript.
   * Syntax highlighting remains available when false. Defaults to false.
   */
  languageServices?: boolean;
}

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  bash: 'shell',
  c: 'cpp',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  cxx: 'cpp',
  docker: 'dockerfile',
  htm: 'html',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  mdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  sh: 'shell',
  text: 'plaintext',
  txt: 'plaintext',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
  zsh: 'shell',
};

export function normalizeMonacoLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function normalizedMonacoLanguageRequests(requested: MonacoLanguageRequest): string[] {
  const values = typeof requested === 'string' ? [requested] : (requested ?? []);
  return [...new Set(values.map(normalizeMonacoLanguage).filter(Boolean))].sort();
}

export function monacoLanguageRequestKey(
  requested: MonacoLanguageRequest,
  options: MonacoLanguageLoadOptions = {},
): string {
  return `${options.languageServices ? 'services' : 'syntax'}:${normalizedMonacoLanguageRequests(requested).join(',')}`;
}

/**
 * Return the primary language plus explicit languages used by Markdown fences.
 * Closing fences and untagged fences do not add language work.
 */
export function monacoLanguagesForDocument(primaryLanguage: string, source: string): string[] {
  const primary = normalizeMonacoLanguage(primaryLanguage);
  const requested = new Set<string>(primary ? [primary] : []);
  if (primary !== 'markdown') return [...requested];

  let openFence: { marker: '`' | '~'; length: number } | null = null;
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`~]+)?/);
    if (!match) continue;
    const fence = match[1];
    const marker = fence[0] as '`' | '~';
    if (openFence) {
      if (marker === openFence.marker && fence.length >= openFence.length) openFence = null;
      continue;
    }
    openFence = { marker, length: fence.length };
    const language = match[2];
    if (language) requested.add(normalizeMonacoLanguage(language));
  }
  return [...requested];
}
