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
      3_000,
    );
    expect(lineCount('packages/react/src/DocPlayer.tsx'), 'DocPlayer.tsx').toBeLessThanOrEqual(
      2_000,
    );
    expect(
      lineCount('packages/editor-react/src/EditorShell.tsx'),
      'EditorShell.tsx',
    ).toBeLessThanOrEqual(2_050);
    expect(
      lineCount('packages/editor-react/src/styles/editor.css'),
      'editor.css',
    ).toBeLessThanOrEqual(7_000);
    for (const [path, ceiling] of [
      ['packages/editor-react/src/PreviewControls.tsx', 2_550],
      ['packages/editor-react/src/recorder/RecorderModal.tsx', 2_350],
      ['packages/formats/src/pptx/export.ts', 2_300],
      ['packages/video-react/src/hooks/useFrameCapture.ts', 2_350],
      ['packages/editor-react/src/tiptapBridge.ts', 2_200],
    ] as const) {
      expect(lineCount(path), path).toBeLessThanOrEqual(ceiling);
    }
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
