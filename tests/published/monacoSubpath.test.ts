import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './_packages';

describe('@bendyline/squisq-editor-react/monaco published output', () => {
  const dist = resolve(REPO_ROOT, 'packages/editor-react/dist');

  it.each(['monaco.js', 'monaco.d.ts'])("%s uses Monaco's resolvable .js API path", (file) => {
    const source = readFileSync(resolve(dist, file), 'utf8');

    expect(source).toContain('monaco-editor/esm/vs/editor/editor.api.js');
    expect(source).not.toMatch(/monaco-editor\/esm\/vs\/editor\/editor\.api["']/);
  });
});
