import { describe, expect, it, vi } from 'vitest';
import { registerJsonLanguage, registerJsoncLanguage } from '../monacoJsonc';

function monacoStub(existingLanguages: readonly { id: string }[] = []) {
  return {
    languages: {
      getLanguages: vi.fn(() => existingLanguages),
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
    },
  } as unknown as typeof import('monaco-editor');
}

describe('registerJsoncLanguage', () => {
  it('registers JSONC with JSON token scopes and comment editing support', () => {
    const monaco = monacoStub();

    registerJsoncLanguage(monaco);

    expect(monaco.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'jsonc', extensions: ['.jsonc'] }),
    );
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith(
      'jsonc',
      expect.objectContaining({ comments: { lineComment: '//', blockComment: ['/*', '*/'] } }),
    );
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
      'jsonc',
      expect.objectContaining({ tokenPostfix: '.json' }),
    );
  });

  it('leaves an existing host registration untouched', () => {
    const monaco = monacoStub([{ id: 'jsonc' }]);

    registerJsoncLanguage(monaco);

    expect(monaco.languages.register).not.toHaveBeenCalled();
    expect(monaco.languages.setLanguageConfiguration).not.toHaveBeenCalled();
    expect(monaco.languages.setMonarchTokensProvider).not.toHaveBeenCalled();
  });
});

describe('registerJsonLanguage', () => {
  it('registers lightweight JSON without starting the rich language service', () => {
    const monaco = monacoStub();

    registerJsonLanguage(monaco);

    expect(monaco.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'json', extensions: ['.json'] }),
    );
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
      'json',
      expect.objectContaining({ tokenPostfix: '.json' }),
    );
  });
});
