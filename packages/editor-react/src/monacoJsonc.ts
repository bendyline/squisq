/** Register JSONC as a lightweight Monaco language for embedded Markdown fences. */

import type { languages } from 'monaco-editor';

const JSON_LANGUAGE: languages.IMonarchLanguage = {
  defaultToken: '',
  // Reuse Monaco's JSON token scopes so built-in and host themes color JSONC
  // exactly like JSON instead of requiring JSONC-specific theme rules.
  tokenPostfix: '.json',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.bracket' },
    { open: '[', close: ']', token: 'delimiter.array' },
  ],
  tokenizer: {
    root: [
      { include: '@whitespace' },
      [/[{}[\]]/, '@brackets'],
      [/[,:]/, 'delimiter'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
      [/"(?:[^"\\]|\\.)*"/, 'string.value'],
      [/\b(?:true|false|null)\b/, 'keyword'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],
    comment: [
      [/[^*/]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[*/]/, 'comment'],
    ],
  },
};

const JSONC_CONFIGURATION: languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
};

export function registerJsoncLanguage(monaco: typeof import('monaco-editor')): void {
  if (monaco.languages.getLanguages().some(({ id }) => id === 'jsonc')) return;

  monaco.languages.register({
    id: 'jsonc',
    aliases: ['JSONC', 'JSON with Comments', 'jsonc'],
    extensions: ['.jsonc'],
    mimetypes: ['application/jsonc'],
  });
  monaco.languages.setLanguageConfiguration('jsonc', JSONC_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider('jsonc', JSON_LANGUAGE);
}

/** Lightweight JSON highlighting for syntax-only editors (no worker/service). */
export function registerJsonLanguage(monaco: typeof import('monaco-editor')): void {
  if (monaco.languages.getLanguages().some(({ id }) => id === 'json')) return;

  monaco.languages.register({
    id: 'json',
    aliases: ['JSON', 'json'],
    extensions: ['.json'],
    mimetypes: ['application/json'],
  });
  monaco.languages.setLanguageConfiguration('json', JSONC_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider('json', JSON_LANGUAGE);
}
