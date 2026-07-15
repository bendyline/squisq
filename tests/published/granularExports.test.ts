import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

const expectedSubpaths = {
  react: {
    './player': 'DocPlayer',
    './page': 'LinearDocView',
    './layers': 'ImageLayer',
    './hooks': 'useDocPlayback',
    './markdown': 'MarkdownRenderer',
    './json-view': 'JsonView',
  },
  'editor-react': {
    './shell': 'EditorShell',
    './json-editor': 'JsonEditor',
    './image-editor': 'ImageEditor',
    './recorder': 'RecorderModal',
    './teleprompter': 'TeleprompterView',
  },
  'video-react': {
    './components': 'VideoExportModal',
    './hooks': 'useVideoExport',
    './encoder': 'createEncoder',
  },
} as const;

describe('granular UI exports', () => {
  for (const [packageDir, subpaths] of Object.entries(expectedSubpaths)) {
    it(`${packageDir} ships loadable runtime and declaration files for each subpath`, async () => {
      const manifest = JSON.parse(
        readFileSync(resolve(root, 'packages', packageDir, 'package.json'), 'utf8'),
      ) as {
        exports: Record<string, { import?: string; types?: string }>;
      };

      for (const [subpath, expectedExport] of Object.entries(subpaths)) {
        const definition = manifest.exports[subpath];
        expect(definition, subpath).toBeDefined();
        const runtime = resolve(root, 'packages', packageDir, definition.import!);
        expect(existsSync(runtime)).toBe(true);
        expect(existsSync(resolve(root, 'packages', packageDir, definition.types!))).toBe(true);
        const module = (await import(pathToFileURL(runtime).href)) as Record<string, unknown>;
        expect(module, subpath).toHaveProperty(expectedExport);
      }
    });
  }
});
