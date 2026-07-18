import { describe, expect, it } from 'vitest';
import {
  monacoLanguageRequestKey,
  monacoLanguagesForDocument,
  normalizeMonacoLanguage,
} from '../monacoLanguageDetection';

describe('Monaco language demand detection', () => {
  it('normalizes common filename and fence aliases', () => {
    expect(normalizeMonacoLanguage(' TSX ')).toBe('typescript');
    expect(normalizeMonacoLanguage('yml')).toBe('yaml');
    expect(normalizeMonacoLanguage('sh')).toBe('shell');
    expect(normalizeMonacoLanguage('kusto')).toBe('kusto');
  });

  it('requests only languages present in a Markdown document', () => {
    const source = [
      '# Example',
      '',
      '```ts highlight-lines',
      'const value = 1;',
      '```',
      '',
      '~~~jsonc',
      '{ // comment',
      '}',
      '~~~',
    ].join('\n');

    expect(monacoLanguagesForDocument('markdown', source)).toEqual([
      'markdown',
      'typescript',
      'jsonc',
    ]);
  });

  it('does not treat shorter nested markers or closing fences as languages', () => {
    const source = ['````python', '```not-a-new-fence', '````', '```', 'plain', '```'].join('\n');

    expect(monacoLanguagesForDocument('markdown', source)).toEqual(['markdown', 'python']);
  });

  it('does not scan ordinary code files for Markdown fences', () => {
    expect(monacoLanguagesForDocument('tsx', '```python\npass\n```')).toEqual(['typescript']);
  });

  it('uses a stable, deduplicated cache key for equivalent requests', () => {
    expect(monacoLanguageRequestKey(['python', 'md', 'python'])).toBe('syntax:markdown,python');
    expect(monacoLanguageRequestKey(['md', 'python'], { languageServices: true })).toBe(
      'services:markdown,python',
    );
  });
});
