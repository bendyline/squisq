import { describe, it, expect } from 'vitest';
import { detectLanguageFromFileName, resolveFileKind } from '../fileKind';

describe('detectLanguageFromFileName', () => {
  it('detects common extensions', () => {
    expect(detectLanguageFromFileName('foo.ts')).toBe('typescript');
    expect(detectLanguageFromFileName('app.py')).toBe('python');
    expect(detectLanguageFromFileName('data.json')).toBe('json');
    expect(detectLanguageFromFileName('index.html')).toBe('html');
    expect(detectLanguageFromFileName('styles.css')).toBe('css');
    expect(detectLanguageFromFileName('README.md')).toBe('markdown');
  });

  it('uses the final extension for multi-dot names', () => {
    expect(detectLanguageFromFileName('archive.tar.gz')).toBe(null);
    expect(detectLanguageFromFileName('component.test.ts')).toBe('typescript');
  });

  it('accepts bare extensions with or without a leading dot', () => {
    expect(detectLanguageFromFileName('.ts')).toBe('typescript');
    expect(detectLanguageFromFileName('ts')).toBe('typescript');
  });

  it('matches extensionless names like Dockerfile', () => {
    expect(detectLanguageFromFileName('Dockerfile')).toBe('dockerfile');
    expect(detectLanguageFromFileName('dockerfile')).toBe('dockerfile');
  });

  it('is case-insensitive for extensions', () => {
    expect(detectLanguageFromFileName('foo.TS')).toBe('typescript');
    expect(detectLanguageFromFileName('App.JSX')).toBe('javascript');
  });

  it('strips leading paths', () => {
    expect(detectLanguageFromFileName('src/lib/foo.ts')).toBe('typescript');
    expect(detectLanguageFromFileName('C:\\Users\\me\\app.py')).toBe('python');
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguageFromFileName('foo.xyz')).toBe(null);
    expect(detectLanguageFromFileName('mystery.blob')).toBe(null);
  });

  it('returns null for empty or trailing-dot inputs', () => {
    expect(detectLanguageFromFileName('')).toBe(null);
    expect(detectLanguageFromFileName('   ')).toBe(null);
    expect(detectLanguageFromFileName('foo.')).toBe(null);
  });
});

describe('resolveFileKind', () => {
  it('defaults to markdown mode when nothing is supplied', () => {
    expect(resolveFileKind()).toEqual({ mode: 'markdown', language: 'markdown' });
  });

  it('returns code mode for recognized code extensions', () => {
    expect(resolveFileKind('foo.ts')).toEqual({ mode: 'code', language: 'typescript' });
    expect(resolveFileKind('app.py')).toEqual({ mode: 'code', language: 'python' });
    expect(resolveFileKind('data.json')).toEqual({ mode: 'code', language: 'json' });
  });

  it('keeps markdown extensions in markdown mode', () => {
    expect(resolveFileKind('README.md')).toEqual({ mode: 'markdown', language: 'markdown' });
    expect(resolveFileKind('doc.markdown')).toEqual({ mode: 'markdown', language: 'markdown' });
  });

  it('keeps .txt in markdown mode with plaintext language', () => {
    expect(resolveFileKind('notes.txt')).toEqual({ mode: 'markdown', language: 'plaintext' });
  });

  it('falls back to markdown mode for unknown extensions', () => {
    expect(resolveFileKind('foo.xyz')).toEqual({ mode: 'markdown', language: 'markdown' });
  });

  it('lets the explicit language override fileName detection', () => {
    expect(resolveFileKind('foo.md', 'typescript')).toEqual({
      mode: 'code',
      language: 'typescript',
    });
  });

  it('stays in markdown mode when language override is markdown or plaintext', () => {
    expect(resolveFileKind('foo.ts', 'markdown')).toEqual({
      mode: 'markdown',
      language: 'markdown',
    });
    expect(resolveFileKind(undefined, 'plaintext')).toEqual({
      mode: 'markdown',
      language: 'plaintext',
    });
  });

  it('accepts a language with no fileName', () => {
    expect(resolveFileKind(undefined, 'rust')).toEqual({ mode: 'code', language: 'rust' });
  });
});
