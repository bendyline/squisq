import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { mediaRenderKey, parseMediaFx } from '../mediaEdit/recipe.js';
import {
  MEDIA_RENDER_MANIFEST_VERSION,
  buildMediaRenderIndex,
  mediaRenderFilePath,
  mediaRenderManifestPath,
  mediaRenderStaleness,
  parseMediaRenderManifest,
  parseMediaRenderPath,
  referencedMediaRenderKeys,
  selectMediaRendersForGc,
  serializeMediaRenderManifest,
  type MediaRenderManifest,
} from '../mediaEdit/renderStore.js';

const KEY = 'a1b2c3d4e5f6';

function manifest(overrides: Partial<MediaRenderManifest> = {}): MediaRenderManifest {
  return {
    version: MEDIA_RENDER_MANIFEST_VERSION,
    src: 'video/take.webm',
    key: KEY,
    fx: 'denoise:0.8',
    ignoredOps: [],
    file: `.mediaEdits/take.${KEY}.webm`,
    mimeType: 'audio/webm',
    sourceSize: 1000,
    sourceDuration: 12.5,
    engine: 'squisq-media-edit/1',
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('render paths', () => {
  it('derives render and manifest paths from the source stem and key', () => {
    expect(mediaRenderFilePath('video/My Take.webm', KEY, 'webm')).toBe(
      `.mediaEdits/My_Take.${KEY}.webm`,
    );
    expect(mediaRenderManifestPath('video/take.webm', KEY)).toBe(`.mediaEdits/take.${KEY}.json`);
  });

  it('recognizes render paths with or without a media folder prefix', () => {
    expect(parseMediaRenderPath(`notes_files/.mediaEdits/take.${KEY}.webm`)).toEqual({
      stem: 'take',
      key: KEY,
      extension: 'webm',
      isManifest: false,
    });
    expect(parseMediaRenderPath(`.mediaEdits/take.${KEY}.json`)?.isManifest).toBe(true);
    expect(parseMediaRenderPath(`video/take.${KEY}.webm`)).toBeNull();
    expect(parseMediaRenderPath(`.mediaEdits/take.${KEY}.exe`)).toBeNull();
  });
});

describe('buildMediaRenderIndex', () => {
  it('indexes renders by key and pairs manifests', () => {
    const index = buildMediaRenderIndex([
      { name: 'notes_files/video/take.webm', size: 5000 },
      { name: `notes_files/.mediaEdits/take.${KEY}.webm`, size: 70 },
      { name: `notes_files/.mediaEdits/take.${KEY}.json`, size: 4 },
      { name: 'notes_files/.mediaEdits/other.0123456789ab.wav', size: 9 },
    ]);
    expect([...index.keys()].sort()).toEqual(['0123456789ab', KEY]);
    expect(index.get(KEY)).toEqual({
      key: KEY,
      path: `notes_files/.mediaEdits/take.${KEY}.webm`,
      manifestPath: `notes_files/.mediaEdits/take.${KEY}.json`,
      size: 70,
    });
    expect(index.get('0123456789ab')?.manifestPath).toBeNull();
  });
});

describe('manifests', () => {
  it('round-trips and rejects malformed JSON', () => {
    const m = manifest({ analysis: { integratedLufs: -23.4, appliedGainDb: 7.4 } });
    expect(parseMediaRenderManifest(serializeMediaRenderManifest(m))).toEqual(m);
    expect(parseMediaRenderManifest('{')).toBeNull();
    expect(parseMediaRenderManifest(JSON.stringify({ ...m, version: 99 }))).toBeNull();
  });

  it('flags a changed source and an engine that now knows a skipped op', () => {
    expect(mediaRenderStaleness(manifest(), { sourceSize: 1000 })).toBeNull();
    expect(mediaRenderStaleness(manifest(), { sourceSize: 1001 })).toBe('source-changed');
    expect(mediaRenderStaleness(manifest({ ignoredOps: ['loudness:-16'] }), {})).toBe(
      'engine-upgraded',
    );
    expect(mediaRenderStaleness(manifest({ ignoredOps: ['deess:4'] }), {})).toBeNull();
  });
});

describe('document references and GC', () => {
  const md = `{[audio src=audio/take.webm anchor=document fx="denoise loudness"]}

# One

<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-fx="loudness:-14"></video>

{[audio src=audio/music.mp3 gain=-6]}
`;

  it('collects the render keys current recipes need', () => {
    const doc = markdownToDoc(parseMarkdown(md));
    const keys = referencedMediaRenderKeys(doc);
    expect(keys).toEqual(
      new Set([
        mediaRenderKey('audio/take.webm', parseMediaFx('denoise loudness')!),
        mediaRenderKey('video/screen.webm', parseMediaFx('loudness:-14')!),
      ]),
    );
  });

  it('collects only unreferenced renders past the age threshold', () => {
    const fresh = '0123456789ab';
    const old = 'ba9876543210';
    const orphan = 'cccccccccccc';
    const index = buildMediaRenderIndex([
      { name: `.mediaEdits/take.${KEY}.webm`, size: 1 },
      { name: `.mediaEdits/take.${KEY}.json`, size: 1 },
      { name: `.mediaEdits/take.${fresh}.webm`, size: 1 },
      { name: `.mediaEdits/take.${fresh}.json`, size: 1 },
      { name: `.mediaEdits/take.${old}.webm`, size: 1 },
      { name: `.mediaEdits/take.${old}.json`, size: 1 },
      { name: `.mediaEdits/take.${orphan}.webm`, size: 1 },
    ]);
    const manifests = new Map([
      [KEY, manifest()],
      [fresh, manifest({ key: fresh, createdAt: '2026-09-23T00:00:00.000Z' })],
      [old, manifest({ key: old, createdAt: '2026-09-01T00:00:00.000Z' })],
    ]);
    const paths = selectMediaRendersForGc(
      index,
      new Set([KEY]),
      manifests,
      new Date('2026-09-24T00:00:00.000Z'),
    );
    expect(paths.sort()).toEqual(
      [
        `.mediaEdits/take.${old}.webm`,
        `.mediaEdits/take.${old}.json`,
        `.mediaEdits/take.${orphan}.webm`,
      ].sort(),
    );
  });
});
