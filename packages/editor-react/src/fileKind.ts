/**
 * fileKind
 *
 * Maps a file name (or bare extension) to a Monaco language ID and decides
 * whether the editor shell should operate in markdown mode (full WYSIWYG +
 * Preview experience) or code mode (Monaco-only view with formatting
 * buttons hidden).
 *
 * The mapping favors common web / systems languages that Monaco ships with
 * out of the box. Unknown extensions fall back to markdown mode so the
 * existing UX remains the default for anything we don't recognize.
 */

export interface FileKind {
  /** 'markdown' keeps the full editor (WYSIWYG + Preview tabs); 'code' is Monaco-only. */
  mode: 'markdown' | 'code';
  /** Monaco language ID — passed to `<Editor defaultLanguage={...} />`. */
  language: string;
}

/**
 * Extension → Monaco language ID. Keys are lowercase, no leading dot.
 * Extend as needed; unknown extensions fall back to markdown mode.
 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  txt: 'plaintext',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  lua: 'lua',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  dockerfile: 'dockerfile',
};

/**
 * Languages that keep the full markdown shell (WYSIWYG + Preview). Anything
 * outside this set is treated as code.
 */
const MARKDOWN_MODE_LANGUAGES = new Set(['markdown', 'plaintext']);

/**
 * Pull the lowercase extension (no leading dot) from a file name or bare
 * extension string. Returns null when none is discernible.
 *
 * Examples:
 *   "foo.ts"       → "ts"
 *   "foo.tar.gz"   → "gz"
 *   ".ts"          → "ts"
 *   "ts"           → "ts"
 *   "Dockerfile"   → "dockerfile"   (full name match for extensionless files)
 *   ""             → null
 */
function extractExtension(fileName: string): string | null {
  const trimmed = fileName.trim();
  if (!trimmed) return null;

  // Strip any leading path — take only the basename.
  const base = trimmed.replace(/^.*[/\\]/, '');
  if (!base) return null;

  const dotIdx = base.lastIndexOf('.');
  if (dotIdx === -1) {
    // No dot — could still be a recognized bare name (Dockerfile) or a bare
    // extension passed by a caller like "ts". Lower-case and return.
    return base.toLowerCase();
  }
  if (dotIdx === base.length - 1) return null; // Trailing dot, no extension.
  return base.slice(dotIdx + 1).toLowerCase();
}

/**
 * Detect a Monaco language ID from a file name. Returns null when the
 * extension (or bare name) is not in the mapping.
 */
export function detectLanguageFromFileName(fileName: string): string | null {
  const ext = extractExtension(fileName);
  if (!ext) return null;
  return EXT_TO_LANGUAGE[ext] ?? null;
}

/**
 * Resolve the editor mode + Monaco language for a given file. The explicit
 * `language` argument, if provided, wins over any detection from
 * `fileName`. When nothing matches, falls back to markdown mode.
 */
export function resolveFileKind(fileName?: string, language?: string): FileKind {
  const resolvedLanguage = language ?? (fileName ? detectLanguageFromFileName(fileName) : null);

  if (!resolvedLanguage) {
    return { mode: 'markdown', language: 'markdown' };
  }

  const mode: FileKind['mode'] = MARKDOWN_MODE_LANGUAGES.has(resolvedLanguage)
    ? 'markdown'
    : 'code';
  return { mode, language: resolvedLanguage };
}
