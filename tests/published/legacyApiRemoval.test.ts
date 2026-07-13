import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const coreRootEntry = pathToFileURL(resolve('packages/core/dist/index.js')).href;
const coreDocEntry = pathToFileURL(resolve('packages/core/dist/doc/index.js')).href;
const reactEntry = pathToFileURL(resolve('packages/react/dist/index.js')).href;
const editorEntry = pathToFileURL(resolve('packages/editor-react/dist/index.js')).href;

describe('published major-version surface cleanup', () => {
  it('removes the story subpath and persistent-layer preset helper', async () => {
    const manifest = JSON.parse(await readFile(resolve('packages/core/package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const [root, doc] = await Promise.all([import(coreRootEntry), import(coreDocEntry)]);

    expect(manifest.exports).not.toHaveProperty('./story');
    expect(root).not.toHaveProperty('getDocStyleConfig');
    expect(doc).not.toHaveProperty('getDocStyleConfig');
  });

  it('replaces emoji-only and single-channel transition compatibility exports', async () => {
    const editor = await import(editorEntry);

    for (const name of [
      'EMOJI_CATEGORIES',
      'ALL_EMOJIS',
      'searchEmojis',
      'setBlockAttrsTransition',
    ]) {
      expect(editor).not.toHaveProperty(name);
    }
    expect(editor.PICKER_CATEGORIES).toBeInstanceOf(Array);
    expect(editor.ALL_PICKER_ENTRIES).toBeInstanceOf(Array);
    expect(editor.searchPickerEntries).toBeTypeOf('function');
    expect(editor.setHeadingAttrsTransition).toBeTypeOf('function');
  });

  it('uses the core viewport presets instead of a duplicate React constant', async () => {
    const [react, doc] = await Promise.all([import(reactEntry), import(coreDocEntry)]);
    expect(react).not.toHaveProperty('VIEWPORT');
    expect(doc.VIEWPORT_PRESETS.landscape).toMatchObject({ width: 1920, height: 1080 });
  });
});
