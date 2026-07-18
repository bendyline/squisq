/** Demand-driven Monaco language registration for Squisq editor surfaces. */

import { registerJsonLanguage, registerJsoncLanguage } from './monacoJsonc.js';
import {
  normalizedMonacoLanguageRequests,
  type MonacoLanguageLoadOptions,
  type MonacoLanguageRequest,
} from './monacoLanguageDetection.js';

type LanguageLoader = () => Promise<unknown>;

const SYNTAX_LOADERS: Readonly<Record<string, LanguageLoader>> = {
  cpp: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
  csharp: () => import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js'),
  css: () => import('monaco-editor/esm/vs/basic-languages/css/css.contribution.js'),
  dockerfile: () =>
    import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js'),
  go: () => import('monaco-editor/esm/vs/basic-languages/go/go.contribution.js'),
  handlebars: () =>
    import('monaco-editor/esm/vs/basic-languages/handlebars/handlebars.contribution.js'),
  html: () => import('monaco-editor/esm/vs/basic-languages/html/html.contribution.js'),
  ini: () => import('monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js'),
  java: () => import('monaco-editor/esm/vs/basic-languages/java/java.contribution.js'),
  javascript: () =>
    import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js'),
  kotlin: () => import('monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js'),
  less: () => import('monaco-editor/esm/vs/basic-languages/less/less.contribution.js'),
  lua: () => import('monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js'),
  markdown: () => import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'),
  php: () => import('monaco-editor/esm/vs/basic-languages/php/php.contribution.js'),
  python: () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js'),
  ruby: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js'),
  rust: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'),
  scss: () => import('monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js'),
  shell: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js'),
  sql: () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'),
  swift: () => import('monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js'),
  typescript: () =>
    import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'),
  xml: () => import('monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js'),
  yaml: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js'),
};

const SERVICE_LOADERS: Readonly<Record<string, LanguageLoader>> = {
  css: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
  html: () => import('monaco-editor/esm/vs/language/html/monaco.contribution.js'),
  javascript: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
  json: () => import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
  jsonc: () => import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
  less: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
  scss: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
  typescript: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
};

const languagePromises = new Map<string, Promise<void>>();

async function registerLightweightJson(language: 'json' | 'jsonc'): Promise<void> {
  const monaco = await import('monaco-editor/esm/vs/editor/editor.api.js');
  if (language === 'json') registerJsonLanguage(monaco);
  else registerJsoncLanguage(monaco);
}

function loadLanguage(language: string, languageServices: boolean): Promise<void> {
  if (!language || language === 'plaintext') return Promise.resolve();
  const serviceLoader = languageServices ? SERVICE_LOADERS[language] : undefined;
  const cacheKey = `${serviceLoader ? 'services' : 'syntax'}:${language}`;
  const existing = languagePromises.get(cacheKey);
  if (existing) return existing;

  const loader = serviceLoader ?? SYNTAX_LOADERS[language];
  const promise = (async () => {
    if (serviceLoader) {
      await Promise.all([import('./monacoSuggestions.js'), serviceLoader()]);
      if (language === 'jsonc') await registerLightweightJson('jsonc');
      return;
    }
    if (language === 'json' || language === 'jsonc') {
      await registerLightweightJson(language);
      return;
    }
    await loader?.();
  })().catch((error: unknown) => {
    languagePromises.delete(cacheKey);
    throw error;
  });
  languagePromises.set(cacheKey, promise);
  return promise;
}

/** Load only the requested grammar registrations and, when opted in, services. */
export async function loadMonacoLanguages(
  requested: MonacoLanguageRequest,
  options: MonacoLanguageLoadOptions = {},
): Promise<void> {
  await Promise.all(
    normalizedMonacoLanguageRequests(requested).map((language) =>
      loadLanguage(language, options.languageServices === true),
    ),
  );
}
