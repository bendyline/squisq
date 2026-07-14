import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

function lineCount(relativePath: string): number {
  return readFileSync(resolve(ROOT, relativePath), 'utf8').split(/\r?\n/).length;
}

describe('large-module architecture budgets', () => {
  it('keeps orchestration modules from absorbing extracted responsibilities again', () => {
    expect(lineCount('packages/editor-react/src/Toolbar.tsx'), 'Toolbar.tsx').toBeLessThanOrEqual(
      2_500,
    );
    expect(lineCount('packages/react/src/DocPlayer.tsx'), 'DocPlayer.tsx').toBeLessThanOrEqual(
      1_400,
    );
    expect(
      lineCount('packages/editor-react/src/EditorShell.tsx'),
      'EditorShell.tsx',
    ).toBeLessThanOrEqual(1_350);
    expect(
      lineCount('packages/editor-react/src/styles/editor.css'),
      'editor.css',
    ).toBeLessThanOrEqual(5_500);
  });

  it('keeps extracted component concerns in focused modules', () => {
    expect(lineCount('packages/editor-react/src/toolbar/toolbarButtons.tsx')).toBeGreaterThan(100);
    expect(lineCount('packages/editor-react/src/toolbar/sceneBlockInserts.ts')).toBeGreaterThan(
      100,
    );
    expect(lineCount('packages/react/src/DocPlayerProps.ts')).toBeGreaterThan(40);
    expect(lineCount('packages/editor-react/src/styles/toolbar.css')).toBeGreaterThan(500);
  });
});
