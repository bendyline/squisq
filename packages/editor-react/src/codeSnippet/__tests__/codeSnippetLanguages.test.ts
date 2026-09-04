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
    expect(languages).toContain('jsonc');
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
    expect(monacoLanguageForFence('jsonc')).toBe('json');
    expect(codeSnippetLanguageLabel('jsonc')).toBe('JSONC');
    expect(codeSnippetLanguageLabel('csharp')).toBe('C#');
  });

  it('labels short monikers with the language friendly name', () => {
    expect(codeSnippetLanguageLabel('ts')).toBe('TypeScript');
    expect(codeSnippetLanguageLabel('TS')).toBe('TypeScript');
    expect(codeSnippetLanguageLabel('sh')).toBe('Shell');
    expect(codeSnippetLanguageLabel('py')).toBe('Python');
    expect(codeSnippetLanguageLabel('yml')).toBe('YAML');
    expect(codeSnippetLanguageLabel('cs')).toBe('C#');
    expect(codeSnippetLanguageLabel('ps1')).toBe('PowerShell');
    expect(codeSnippetLanguageLabel('toml')).toBe('TOML');
    expect(codeSnippetLanguageLabel('objective-c')).toBe('Objective-C');
    // Metadata after the syntax id never reaches the label.
    expect(codeSnippetLanguageLabel('ts highlight-lines')).toBe('TypeScript');
    // An unknown moniker still gets a presentable title-cased fallback.
    expect(codeSnippetLanguageLabel('kusto-lite')).toBe('Kusto Lite');
    expect(codeSnippetLanguageLabel('')).toBe('Code');
  });

  it('routes aliased monikers to the catalog Monaco language', () => {
    expect(monacoLanguageForFence('sh')).toBe('shell');
    expect(monacoLanguageForFence('rs')).toBe('rust');
    expect(monacoLanguageForFence('pwsh')).toBe('powershell');
    expect(monacoLanguageForFence('tf')).toBe('hcl');
  });

  it('creates an explicit language-tagged Markdown fence', () => {
    expect(codeSnippetMarkdown('typescript', 'const n: number = 1;')).toBe(
      '\n```typescript\nconst n: number = 1;\n```\n',
    );
  });
});
