/**
 * The host-facing narration + audio-export surface, as consumers install it:
 *
 *  - `@bendyline/squisq-video-react/encoder` (and the root) ship the streaming
 *    audio-file encoder, the whole-document audio render and the timeline
 *    mixer, with their declaration types;
 *  - the encoder entry stays light: mediabunny's writers load only through the
 *    lossy encoder's dynamic import, never on the entry's static graph;
 *  - the teleprompter entry publishes the narration-save types hosts code
 *    against, and core's sidecar types know the `'tts'` method.
 *
 * Run after `npm run build`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './_packages';

const videoReactDist = resolve(REPO_ROOT, 'packages/video-react/dist');

const RUNTIME_EXPORTS = [
  'createAudioFileEncoder',
  'supportedAudioFileFormats',
  'renderDocumentAudio',
  'renderAudioTimeline',
  'supportsWebCodecsAac',
] as const;

const TYPE_EXPORTS = [
  'AudioFileEncoder',
  'AudioFileEncoderOptions',
  'AudioFileFormat',
  'RenderDocumentAudioOptions',
  'AudioTimelineClip',
] as const;

/** Relative files a module imports STATICALLY (dynamic `import()` excluded). */
function staticImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers = [
    ...source.matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gm),
  ].map((match) => match[1]);
  return specifiers.map((specifier) => resolve(dirname(file), specifier));
}

function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    pending.push(...staticImports(file));
  }
  return seen;
}

describe('audio export API (published)', () => {
  for (const entry of ['encoder/index', 'index']) {
    it(`video-react ${entry} exports the audio export runtime and types`, async () => {
      const runtime = resolve(videoReactDist, `${entry}.js`);
      const types = resolve(videoReactDist, `${entry}.d.ts`);
      expect(existsSync(runtime), `${runtime} — run \`npm run build\` first`).toBe(true);
      const module = (await import(pathToFileURL(runtime).href)) as Record<string, unknown>;
      for (const name of RUNTIME_EXPORTS) expect(typeof module[name], name).toBe('function');
      const declarations = readFileSync(types, 'utf8');
      for (const name of TYPE_EXPORTS)
        expect(declarations, name).toMatch(new RegExp(`\\b${name}\\b`));
    });
  }

  it('keeps mediabunny writers off the encoder entry static import graph', () => {
    const graph = staticGraph(resolve(videoReactDist, 'encoder/index.js'));
    const eager = [...graph].filter((file) =>
      /\bMp4OutputFormat\b/.test(readFileSync(file, 'utf8').replace(/import\([^)]*\)/g, '')),
    );
    expect(eager).toEqual([]);
  });

  it('reports WAV as always available where WebCodecs is absent', async () => {
    const module = (await import(
      pathToFileURL(resolve(videoReactDist, 'encoder/index.js')).href
    )) as { supportedAudioFileFormats: () => Promise<readonly string[]> };
    await expect(module.supportedAudioFileFormats()).resolves.toContain('wav');
  });

  it('editor-react teleprompter publishes the narration-save types', () => {
    const declarations = readFileSync(
      resolve(REPO_ROOT, 'packages/editor-react/dist/teleprompter/index.d.ts'),
      'utf8',
    );
    for (const name of ['NarrationSavePlanArgs', 'ExecuteNarrationSaveDeps']) {
      expect(declarations, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("core's narration sidecar types include the 'tts' method", () => {
    const dist = resolve(REPO_ROOT, 'packages/core/dist');
    const narrationTypes = readFileSync(resolve(dist, 'narration/index.d.ts'), 'utf8');
    const referenced = [narrationTypes];
    // Declarations may live in a shared chunk the entry re-exports from.
    for (const match of narrationTypes.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dist, 'narration', match[1]);
      for (const candidate of [target, `${target}.d.ts`, target.replace(/\.js$/, '.d.ts')]) {
        if (existsSync(candidate) && candidate.endsWith('.d.ts')) {
          referenced.push(readFileSync(candidate, 'utf8'));
        }
      }
    }
    expect(referenced.join('\n')).toMatch(/NarrationTimingMethod\s*=\s*[^;]*'tts'/);
  });
});
