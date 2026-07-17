/** Languages offered by the Insert Code Snippet menu and understood by Monaco. */

export interface CodeSnippetLanguage {
  /** Language written after the opening Markdown fence. */
  readonly fenceLanguage: string;
  /** Human-readable picker/header label. */
  readonly label: string;
  /** Monaco language id used for syntax highlighting and language services. */
  readonly monacoLanguage: string;
  /** Small, immediately editable body inserted for a new snippet. */
  readonly starter: string;
}

export const CODE_SNIPPET_LANGUAGES: readonly CodeSnippetLanguage[] = [
  {
    fenceLanguage: 'typescript',
    label: 'TypeScript',
    monacoLanguage: 'typescript',
    starter: "const message: string = 'Hello, world!';",
  },
  {
    fenceLanguage: 'javascript',
    label: 'JavaScript',
    monacoLanguage: 'javascript',
    starter: "const message = 'Hello, world!';",
  },
  {
    fenceLanguage: 'tsx',
    label: 'TSX',
    monacoLanguage: 'typescript',
    starter: 'export function Component() {\n  return <div>Hello, world!</div>;\n}',
  },
  {
    fenceLanguage: 'jsx',
    label: 'JSX',
    monacoLanguage: 'javascript',
    starter: 'export function Component() {\n  return <div>Hello, world!</div>;\n}',
  },
  {
    fenceLanguage: 'json',
    label: 'JSON',
    monacoLanguage: 'json',
    starter: '{\n  "key": "value"\n}',
  },
  {
    fenceLanguage: 'jsonc',
    label: 'JSONC',
    // Monaco exposes JSON-with-comments through its `json` language service;
    // it does not register a separate rich-service `jsonc` language id.
    monacoLanguage: 'json',
    starter: '{\n  // Comments are allowed.\n  "key": "value"\n}',
  },
  {
    fenceLanguage: 'html',
    label: 'HTML',
    monacoLanguage: 'html',
    starter: '<div>Hello, world!</div>',
  },
  {
    fenceLanguage: 'css',
    label: 'CSS',
    monacoLanguage: 'css',
    starter: '.example {\n  color: #2563eb;\n}',
  },
  {
    fenceLanguage: 'python',
    label: 'Python',
    monacoLanguage: 'python',
    starter: 'print("Hello, world!")',
  },
  {
    fenceLanguage: 'bash',
    label: 'Shell',
    monacoLanguage: 'shell',
    starter: 'echo "Hello, world!"',
  },
  {
    fenceLanguage: 'sql',
    label: 'SQL',
    monacoLanguage: 'sql',
    starter: 'SELECT *\nFROM table_name;',
  },
  {
    fenceLanguage: 'yaml',
    label: 'YAML',
    monacoLanguage: 'yaml',
    starter: 'key: value',
  },
  {
    fenceLanguage: 'markdown',
    label: 'Markdown',
    monacoLanguage: 'markdown',
    starter: '# Heading',
  },
  {
    fenceLanguage: 'java',
    label: 'Java',
    monacoLanguage: 'java',
    starter: 'class Main {\n  public static void main(String[] args) {\n  }\n}',
  },
  {
    fenceLanguage: 'csharp',
    label: 'C#',
    monacoLanguage: 'csharp',
    starter: 'Console.WriteLine("Hello, world!");',
  },
  {
    fenceLanguage: 'cpp',
    label: 'C++',
    monacoLanguage: 'cpp',
    starter: '#include <iostream>\n\nint main() {\n  return 0;\n}',
  },
  {
    fenceLanguage: 'go',
    label: 'Go',
    monacoLanguage: 'go',
    starter: 'package main\n\nfunc main() {\n}',
  },
  {
    fenceLanguage: 'rust',
    label: 'Rust',
    monacoLanguage: 'rust',
    starter: 'fn main() {\n  println!("Hello, world!");\n}',
  },
  {
    fenceLanguage: 'ruby',
    label: 'Ruby',
    monacoLanguage: 'ruby',
    starter: 'puts "Hello, world!"',
  },
  {
    fenceLanguage: 'php',
    label: 'PHP',
    monacoLanguage: 'php',
    starter: '<?php\necho "Hello, world!";',
  },
  {
    fenceLanguage: 'swift',
    label: 'Swift',
    monacoLanguage: 'swift',
    starter: 'print("Hello, world!")',
  },
  {
    fenceLanguage: 'kotlin',
    label: 'Kotlin',
    monacoLanguage: 'kotlin',
    starter: 'fun main() {\n  println("Hello, world!")\n}',
  },
  {
    fenceLanguage: 'dockerfile',
    label: 'Dockerfile',
    monacoLanguage: 'dockerfile',
    starter: 'FROM node:22-alpine',
  },
] as const;

const BY_FENCE_LANGUAGE: ReadonlyMap<string, CodeSnippetLanguage> = new Map(
  CODE_SNIPPET_LANGUAGES.map((language) => [language.fenceLanguage, language]),
);

/** Languages owned by the diagram/tree/timeline editors or their auto-detection gates. */
const SPECIAL_FENCE_LANGUAGES = new Set([
  'text',
  'txt',
  'plaintext',
  'plain',
  'ascii',
  'diagram',
  'tree',
  'timeline',
  'mermaid',
]);

const MONACO_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  c: 'c',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  cxx: 'cpp',
  docker: 'dockerfile',
  htm: 'html',
  js: 'javascript',
  jsx: 'javascript',
  jsonc: 'json',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  sh: 'shell',
  shell: 'shell',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
};

/** The first token is the syntax id; any remaining fence metadata stays untouched. */
export function codeSnippetFenceLanguageToken(language: string | null | undefined): string {
  if (typeof language !== 'string') return '';
  return language.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

/** True for explicit language-tagged fences not owned by a richer Squisq block editor. */
export function isCodeSnippetFenceLanguage(language: string | null | undefined): boolean {
  const token = codeSnippetFenceLanguageToken(language);
  return token.length > 0 && !SPECIAL_FENCE_LANGUAGES.has(token);
}

export function monacoLanguageForFence(language: string | null | undefined): string {
  const token = codeSnippetFenceLanguageToken(language);
  const catalogEntry = BY_FENCE_LANGUAGE.get(token);
  return (catalogEntry?.monacoLanguage ?? MONACO_LANGUAGE_ALIASES[token] ?? token) || 'plaintext';
}

export function codeSnippetLanguageLabel(language: string | null | undefined): string {
  const token = codeSnippetFenceLanguageToken(language);
  const catalogEntry = BY_FENCE_LANGUAGE.get(token);
  if (catalogEntry) return catalogEntry.label;
  return token
    ? token.replace(/(^|[-_])([a-z])/g, (_match, _prefix, letter) => letter.toUpperCase())
    : 'Code';
}

/** Markdown insertion form. The caller decides whether to wrap selected text or use a starter. */
export function codeSnippetMarkdown(language: string, source: string): string {
  return `\n\`\`\`${language}\n${source}\n\`\`\`\n`;
}
