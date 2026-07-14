import { describe, expect, it } from 'vitest';
import {
  CODE_SNIPPET_LANGUAGES,
  codeSnippetFenceLanguageToken,
  codeSnippetLanguageLabel,
  codeSnippetMarkdown,
  isCodeSnippetFenceLanguage,
  monacoLanguageForFence,
} from '../codeSnippetLanguages';

describe('code snippet languages', () => {
  it('offers unique explicit fence languages', () => {
    const languages = CODE_SNIPPET_LANGUAGES.map((entry) => entry.fenceLanguage);
    expect(new Set(languages).size).toBe(languages.length);
    expect(languages).toContain('typescript');
    expect(languages).toContain('json');
    expect(languages).toContain('python');
  });

  it('keeps specialized authored-view languages out of the Monaco inset', () => {
    for (const language of [
      '',
      'text',
      'txt',
      'plaintext',
      'ascii',
      'diagram',
      'tree',
      'timeline',
      'mermaid',
    ]) {
      expect(isCodeSnippetFenceLanguage(language), language).toBe(false);
    }
    expect(isCodeSnippetFenceLanguage('typescript')).toBe(true);
    expect(isCodeSnippetFenceLanguage('kusto')).toBe(true);
  });

  it('uses the first fence token for Monaco while preserving metadata for round trips', () => {
    expect(codeSnippetFenceLanguageToken('  json data  ')).toBe('json');
    expect(monacoLanguageForFence('ts highlight-lines')).toBe('typescript');
    expect(monacoLanguageForFence('yml')).toBe('yaml');
    expect(codeSnippetLanguageLabel('csharp')).toBe('C#');
  });

  it('creates an explicit language-tagged Markdown fence', () => {
    expect(codeSnippetMarkdown('typescript', 'const n: number = 1;')).toBe(
      '\n```typescript\nconst n: number = 1;\n```\n',
    );
  });
});
