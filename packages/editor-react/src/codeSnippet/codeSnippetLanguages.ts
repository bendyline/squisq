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

/**
 * Fence tokens that name a catalog language under a shorter spelling. Resolving
 * these before the fallback is what labels a ```ts fence "TypeScript" rather
 * than title-casing the moniker into "Ts".
 */
const FENCE_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  cc: 'cpp',
  cjs: 'javascript',
  console: 'bash',
  containerfile: 'dockerfile',
  cs: 'csharp',
  cts: 'typescript',
  'c#': 'csharp',
  'c++': 'cpp',
  cxx: 'cpp',
  docker: 'dockerfile',
  golang: 'go',
  hh: 'cpp',
  hpp: 'cpp',
  htm: 'html',
  js: 'javascript',
  ksh: 'bash',
  kt: 'kotlin',
  kts: 'kotlin',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
};

/**
 * Display names for languages the insert menu does not offer but a document may
 * still fence. Without an entry the moniker is title-cased, which reads wrong
 * for initialisms ("Toml", "Sql") and for names with their own casing ("MATLAB").
 */
const EXTRA_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  apache: 'Apache',
  asm: 'Assembly',
  assembly: 'Assembly',
  astro: 'Astro',
  bat: 'Batch',
  batch: 'Batch',
  c: 'C',
  clj: 'Clojure',
  cljs: 'ClojureScript',
  clojure: 'Clojure',
  cmake: 'CMake',
  cmd: 'Batch',
  cobol: 'COBOL',
  crystal: 'Crystal',
  csv: 'CSV',
  dart: 'Dart',
  diff: 'Diff',
  dot: 'Graphviz',
  elisp: 'Emacs Lisp',
  elixir: 'Elixir',
  erl: 'Erlang',
  erlang: 'Erlang',
  ex: 'Elixir',
  exs: 'Elixir',
  fish: 'Fish',
  fortran: 'Fortran',
  fs: 'F#',
  fsharp: 'F#',
  'f#': 'F#',
  gql: 'GraphQL',
  gradle: 'Gradle',
  graphql: 'GraphQL',
  graphviz: 'Graphviz',
  groovy: 'Groovy',
  h: 'C',
  handlebars: 'Handlebars',
  haskell: 'Haskell',
  hbs: 'Handlebars',
  hcl: 'HCL',
  hs: 'Haskell',
  http: 'HTTP',
  ini: 'INI',
  jade: 'Pug',
  jl: 'Julia',
  jsonl: 'JSON Lines',
  julia: 'Julia',
  kql: 'Kusto',
  kusto: 'Kusto',
  latex: 'LaTeX',
  less: 'Less',
  lisp: 'Lisp',
  lua: 'Lua',
  make: 'Makefile',
  makefile: 'Makefile',
  matlab: 'MATLAB',
  mysql: 'MySQL',
  ndjson: 'JSON Lines',
  nginx: 'nginx',
  nim: 'Nim',
  objc: 'Objective-C',
  'objective-c': 'Objective-C',
  objectivec: 'Objective-C',
  ocaml: 'OCaml',
  pascal: 'Pascal',
  patch: 'Diff',
  perl: 'Perl',
  pgsql: 'PostgreSQL',
  pl: 'Perl',
  plsql: 'PL/SQL',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  powershell: 'PowerShell',
  prisma: 'Prisma',
  prolog: 'Prolog',
  proto: 'Protocol Buffers',
  protobuf: 'Protocol Buffers',
  ps1: 'PowerShell',
  psql: 'PostgreSQL',
  pug: 'Pug',
  pwsh: 'PowerShell',
  r: 'R',
  racket: 'Racket',
  razor: 'Razor',
  regex: 'Regex',
  sass: 'Sass',
  scala: 'Scala',
  scheme: 'Scheme',
  scss: 'SCSS',
  sol: 'Solidity',
  solidity: 'Solidity',
  sqlite: 'SQLite',
  stylus: 'Stylus',
  svelte: 'Svelte',
  svg: 'SVG',
  tex: 'LaTeX',
  terraform: 'Terraform',
  tf: 'Terraform',
  toml: 'TOML',
  tsql: 'T-SQL',
  tsv: 'TSV',
  vb: 'Visual Basic',
  vbnet: 'Visual Basic',
  verilog: 'Verilog',
  vhdl: 'VHDL',
  'visual-basic': 'Visual Basic',
  vue: 'Vue',
  wasm: 'WebAssembly',
  wat: 'WebAssembly',
  xml: 'XML',
  zig: 'Zig',
};

/** Monaco ids for tokens whose highlighting language is spelled differently. */
const MONACO_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  batch: 'bat',
  c: 'c',
  clj: 'clojure',
  cljs: 'clojure',
  cmd: 'bat',
  ex: 'elixir',
  exs: 'elixir',
  fs: 'fsharp',
  'f#': 'fsharp',
  gql: 'graphql',
  hbs: 'handlebars',
  jade: 'pug',
  jl: 'julia',
  jsonl: 'json',
  jsx: 'javascript',
  ndjson: 'json',
  objc: 'objective-c',
  objectivec: 'objective-c',
  pl: 'perl',
  postgres: 'pgsql',
  postgresql: 'pgsql',
  proto: 'protobuf',
  ps1: 'powershell',
  psql: 'pgsql',
  pwsh: 'powershell',
  sol: 'solidity',
  svg: 'xml',
  terraform: 'hcl',
  tf: 'hcl',
  vbnet: 'vb',
  'visual-basic': 'vb',
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

/** The catalog entry a fence token names, directly or through an alias. */
function catalogEntryForToken(token: string): CodeSnippetLanguage | undefined {
  const direct = BY_FENCE_LANGUAGE.get(token);
  if (direct) return direct;
  const canonical = FENCE_LANGUAGE_ALIASES[token];
  return canonical ? BY_FENCE_LANGUAGE.get(canonical) : undefined;
}

export function monacoLanguageForFence(language: string | null | undefined): string {
  const token = codeSnippetFenceLanguageToken(language);
  const catalogEntry = catalogEntryForToken(token);
  return (catalogEntry?.monacoLanguage ?? MONACO_LANGUAGE_ALIASES[token] ?? token) || 'plaintext';
}

export function codeSnippetLanguageLabel(language: string | null | undefined): string {
  const token = codeSnippetFenceLanguageToken(language);
  const catalogEntry = catalogEntryForToken(token);
  if (catalogEntry) return catalogEntry.label;
  const friendlyName = EXTRA_LANGUAGE_LABELS[token];
  if (friendlyName) return friendlyName;
  if (!token) return 'Code';
  // Last resort: title-case the moniker's words so an unlisted fence still reads
  // as a name ("shell-session" -> "Shell Session") rather than a raw token.
  return token
    .split(/[-_.]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Markdown insertion form. The caller decides whether to wrap selected text or use a starter. */
export function codeSnippetMarkdown(language: string, source: string): string {
  return `\n\`\`\`${language}\n${source}\n\`\`\`\n`;
}
