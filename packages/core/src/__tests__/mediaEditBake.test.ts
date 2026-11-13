import { describe, expect, it } from 'vitest';
import {
  MEDIA_BAKE_ENGINE,
  MEDIA_BAKE_MANIFEST_VERSION,
  MEDIA_CUT_EDGE_FADE_SEC,
  buildMediaBakeIndex,
  buildMediaRenderIndex,
  canBakeMedia,
  createMediaBakeAudioStage,
  isMediaBakePath,
  isMediaBakeStale,
  isMediaRenderPath,
  mediaBakeCopyName,
  mediaBakeCopyPath,
  mediaBakeFilePath,
  mediaBakeFrameRanges,
  mediaBakeKey,
  mediaBakeManifestPath,
  mediaBakeSpec,
  needsMediaBake,
  parseMediaBakeManifest,
  parseMediaBakePath,
  parseMediaEdits,
  selectSupersededMediaBakes,
  serializeMediaBakeManifest,
  type MediaBakeClip,
  type MediaBakeManifest,
} from '../mediaEdit/index.js';

const clip = (overrides: Partial<MediaBakeClip> = {}): MediaBakeClip => ({
  src: 'audio/take.webm',
  kind: 'audio',
  ...overrides,
});
const edits = (values: Parameters<typeof parseMediaEdits>[0]) => parseMediaEdits(values);

describe('what needs baking', () => {
  it('is any edit a plain player cannot apply', () => {
    expect(needsMediaBake(clip())).toBe(false);
    expect(needsMediaBake(clip({ edits: edits({ cuts: '2-3' }) }))).toBe(true);
    expect(needsMediaBake(clip({ edits: edits({ fx: 'loudness:-16' }) }))).toBe(true);
    expect(needsMediaBake(clip({ edits: edits({ gain: '-3' }) }))).toBe(true);
    expect(needsMediaBake(clip({ edits: edits({ fadeOut: '0.5' }) }))).toBe(true);
    expect(needsMediaBake(clip({ kind: 'video', edits: edits({ crop: '0.1 0 0.8 1' }) }))).toBe(
      true,
    );
  });

  it('is not a trim alone, a group, an unknown fx token, or a crop on audio', () => {
    expect(needsMediaBake(clip({ clipStart: 2, clipEnd: 8 }))).toBe(false);
    expect(needsMediaBake(clip({ edits: edits({ group: 'rec-a' }) }))).toBe(false);
    expect(needsMediaBake(clip({ edits: edits({ fx: 'sparkle:3' }) }))).toBe(false);
    expect(needsMediaBake(clip({ edits: edits({ crop: '0.1 0 0.8 1' }) }))).toBe(false);
    // A cut entirely outside the trim removes nothing that plays.
    expect(needsMediaBake(clip({ clipStart: 10, edits: edits({ cuts: '2-3' }) }))).toBe(false);
  });

  it('can bake a trim, since the copy then differs from the source', () => {
    expect(canBakeMedia(clip())).toBe(false);
    expect(canBakeMedia(clip({ clipStart: 2 }))).toBe(true);
    expect(canBakeMedia(clip({ clipEnd: 8 }))).toBe(true);
    expect(canBakeMedia(clip({ edits: edits({ gain: '-3' }) }))).toBe(true);
  });
});

describe('bake key', () => {
  const base = clip({ clipStart: 1, clipEnd: 20, edits: edits({ cuts: '2-3 6-8', gain: '-3' }) });

  it('names the engine, the source and every edit that changes the result', () => {
    expect(mediaBakeSpec(base)).toBe(
      [
        MEDIA_BAKE_ENGINE,
        'audio/take.webm',
        'audio',
        'trim=1-20',
        'cuts=2-3 6-8',
        'fx=',
        'gain=-3',
        'fadeIn=',
        'fadeOut=',
        'crop=',
      ].join('\n'),
    );
    expect(mediaBakeKey(base)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes with the source, the trim and each edit', () => {
    const key = mediaBakeKey(base);
    const variants: MediaBakeClip[] = [
      { ...base, src: 'audio/other.webm' },
      { ...base, clipStart: 1.5 },
      { ...base, clipEnd: undefined },
      { ...base, edits: edits({ cuts: '2-3', gain: '-3' }) },
      { ...base, edits: edits({ cuts: '2-3 6-8', gain: '-4' }) },
      { ...base, edits: edits({ cuts: '2-3 6-8', gain: '-3', fadeIn: '0.2' }) },
      { ...base, edits: edits({ cuts: '2-3 6-8', gain: '-3', fx: 'loudness:-16' }) },
      { ...base, kind: 'video' },
    ];
    expect(new Set([key, ...variants.map(mediaBakeKey)]).size).toBe(variants.length + 1);
  });

  it('ignores what does not change the result', () => {
    const key = mediaBakeKey(base);
    const same: MediaBakeClip[] = [
      // Cuts written in another order, or reaching outside the trim.
      { ...base, edits: edits({ cuts: '6-8 2-3', gain: '-3' }) },
      { ...base, edits: edits({ cuts: '0-0.5 2-3 6-8 30-40', gain: '-3' }) },
      { ...base, edits: edits({ cuts: '2-3 6-8', gain: '-3', group: 'rec-a' }) },
      { ...base, edits: edits({ cuts: '2-3 6-8', gain: '-3', fx: 'sparkle:3' }) },
      // An audio clip has no frame to crop.
      { ...base, edits: edits({ cuts: '2-3 6-8', gain: '-3', crop: '0.1 0 0.8 1' }) },
    ];
    expect(same.map(mediaBakeKey)).toEqual(same.map(() => key));
  });
});

describe('bake store', () => {
  const key = '1a2b3c4d5e6f';

  it('lays baked clips beside fx renders without either index seeing the other', () => {
    const file = mediaBakeFilePath('audio/my take.webm', key, 'm4a');
    const manifest = mediaBakeManifestPath('audio/my take.webm', key);
    expect(file).toBe('.mediaEdits/my_take.1a2b3c4d5e6f.baked.m4a');
    expect(manifest).toBe('.mediaEdits/my_take.1a2b3c4d5e6f.baked.json');
    expect(parseMediaBakePath(`notes_files/${file}`)).toEqual({
      stem: 'my_take',
      key,
      extension: 'm4a',
      isManifest: false,
    });
    expect(parseMediaBakePath(manifest)?.isManifest).toBe(true);
    expect(isMediaBakePath('.mediaEdits/my_take.1a2b3c4d5e6f.webm')).toBe(false);
    expect(isMediaBakePath('audio/my_take.1a2b3c4d5e6f.baked.m4a')).toBe(false);
    expect(isMediaBakePath('.mediaEdits/my_take.1a2b3c4d5e6f.baked.txt')).toBe(false);
    expect(isMediaRenderPath(file)).toBe(false);

    const listing = [
      { name: `notes_files/${file}`, size: 900 },
      { name: `notes_files/${manifest}`, size: 300 },
      { name: 'notes_files/.mediaEdits/my_take.aaaaaaaaaaaa.webm', size: 500 },
      { name: 'notes_files/.mediaEdits/other.bbbbbbbbbbbb.baked.mp4', size: 700 },
      { name: 'notes_files/audio/my take.webm', size: 1000 },
    ];
    const bakes = buildMediaBakeIndex(listing);
    expect([...bakes.keys()]).toEqual([key, 'bbbbbbbbbbbb']);
    expect(bakes.get(key)).toEqual({
      key,
      path: `notes_files/${file}`,
      manifestPath: `notes_files/${manifest}`,
      size: 900,
    });
    expect(bakes.get('bbbbbbbbbbbb')?.manifestPath).toBeNull();
    expect([...buildMediaRenderIndex(listing).keys()]).toEqual(['aaaaaaaaaaaa']);
  });

  const manifest: MediaBakeManifest = {
    version: MEDIA_BAKE_MANIFEST_VERSION,
    src: 'audio/take.webm',
    key,
    spec: 'spec',
    file: '.mediaEdits/take.1a2b3c4d5e6f.baked.m4a',
    mimeType: 'audio/mp4',
    sourceSize: 1000,
    duration: 12.5,
    engine: MEDIA_BAKE_ENGINE,
    createdAt: '2026-11-12T00:00:00.000Z',
  };

  it('round-trips a manifest and rejects a malformed one', () => {
    expect(parseMediaBakeManifest(serializeMediaBakeManifest(manifest))).toEqual(manifest);
    expect(parseMediaBakeManifest('{')).toBeNull();
    expect(parseMediaBakeManifest(JSON.stringify({ ...manifest, version: 2 }))).toBeNull();
    expect(parseMediaBakeManifest(JSON.stringify({ ...manifest, spec: undefined }))).toBeNull();
    expect(
      parseMediaBakeManifest(JSON.stringify({ ...manifest, sourceSize: 'big' }))?.sourceSize,
    ).toBeNull();
  });

  it('is stale once the source file changes size', () => {
    expect(isMediaBakeStale(manifest, { sourceSize: 1000 })).toBe(false);
    expect(isMediaBakeStale(manifest, { sourceSize: 1200 })).toBe(true);
    expect(isMediaBakeStale(manifest, {})).toBe(false);
    expect(isMediaBakeStale({ ...manifest, sourceSize: null }, { sourceSize: 1200 })).toBe(false);
  });

  it('removes superseded bakes of the given sources only', () => {
    const index = buildMediaBakeIndex([
      { name: '.mediaEdits/take.111111111111.baked.m4a', size: 1 },
      { name: '.mediaEdits/take.111111111111.baked.json', size: 1 },
      { name: '.mediaEdits/take.222222222222.baked.m4a', size: 1 },
      { name: '.mediaEdits/take.222222222222.baked.json', size: 1 },
      { name: '.mediaEdits/elsewhere.333333333333.baked.m4a', size: 1 },
      { name: '.mediaEdits/elsewhere.333333333333.baked.json', size: 1 },
      { name: '.mediaEdits/orphan.444444444444.baked.m4a', size: 1 },
    ]);
    const manifests = new Map<string, MediaBakeManifest>([
      ['111111111111', { ...manifest, key: '111111111111' }],
      ['222222222222', { ...manifest, key: '222222222222' }],
      ['333333333333', { ...manifest, key: '333333333333', src: 'audio/elsewhere.webm' }],
    ]);
    expect(
      selectSupersededMediaBakes(
        index,
        manifests,
        new Set(['audio/take.webm']),
        new Set(['222222222222']),
      ),
    ).toEqual([
      '.mediaEdits/take.111111111111.baked.m4a',
      '.mediaEdits/take.111111111111.baked.json',
    ]);
  });

  it('names an edited copy after its source', () => {
    expect(mediaBakeCopyName('notes_files/video/screen take.webm', 'mp4')).toBe(
      'screen take-edited.mp4',
    );
    expect(mediaBakeCopyPath('notes_files/video/screen take.webm', 'mp4')).toBe(
      'notes_files/video/screen take-edited.mp4',
    );
    expect(mediaBakeCopyPath('take.wav#t=2', 'm4a')).toBe('take-edited.m4a');
  });
});

describe('baked audio', () => {
  const SR = 1000; // 1 ms frames: a 10 ms cut-edge fade is 10 frames
  const ones = (length: number) => new Float32Array(length).fill(1);

  /** Run a stage over `total` frames of 1.0, fed in `blockSize` blocks. */
  function bake(
    options: Omit<Parameters<typeof createMediaBakeAudioStage>[0], 'sampleRate'>,
    total: number,
    blockSize: number,
  ): Float32Array {
    const stage = createMediaBakeAudioStage({ ...options, sampleRate: SR });
    const out: number[] = [];
    for (let at = 0; at < total; at += blockSize) {
      const kept = stage.process([ones(Math.min(blockSize, total - at))]);
      if (kept) out.push(...kept[0]);
    }
    expect(out).toHaveLength(stage.totalFrames);
    return Float32Array.from(out);
  }

  it('turns kept source ranges into frame offsets from the trim start', () => {
    expect(
      mediaBakeFrameRanges(
        [
          { start: 2, end: 3 },
          { start: 4.5, end: 6 },
        ],
        2,
        SR,
      ),
    ).toEqual([
      [0, 1000],
      [2500, 4000],
    ]);
    expect(mediaBakeFrameRanges([{ start: 5, end: 5 }], 0, SR)).toEqual([]);
  });

  it('drops the cut frames and closes the gap, whatever the block size', () => {
    const ranges: Array<[number, number]> = [
      [0, 300],
      [500, 900],
    ];
    const whole = bake({ ranges }, 1000, 1000);
    expect(whole).toHaveLength(700);
    for (const blockSize of [1, 7, 128, 300, 501]) {
      expect(Array.from(bake({ ranges }, 1000, blockSize))).toEqual(Array.from(whole));
    }
  });

  it('returns null for a block that is entirely cut', () => {
    const stage = createMediaBakeAudioStage({ ranges: [[100, 200]], sampleRate: SR });
    expect(stage.process([ones(100)])).toBeNull();
    expect(stage.process([ones(100)])?.[0]).toHaveLength(100);
    expect(stage.process([ones(100)])).toBeNull();
  });

  it('fades each side of a join to silence and leaves the rest alone', () => {
    const edge = MEDIA_CUT_EDGE_FADE_SEC * SR;
    const out = bake(
      {
        ranges: [
          [0, 300],
          [500, 900],
        ],
      },
      1000,
      64,
    );
    // The join sits at played frame 300.
    expect(out[299]).toBe(0);
    expect(out[300]).toBe(0);
    expect(out[299 - edge / 2]).toBeCloseTo(0.5);
    expect(out[300 + edge / 2]).toBeCloseTo(0.5);
    expect(out[299 - edge]).toBe(1);
    expect(out[300 + edge]).toBe(1);
    // No fade at the clip's own ends: nothing was cut there.
    expect(out[0]).toBe(1);
    expect(out[699]).toBe(1);
  });

  it('applies the gain and the fades at the two ends of the baked clip', () => {
    const out = bake(
      { ranges: [[0, 1000]], gainDb: -6.0206, fadeInSec: 0.1, fadeOutSec: 0.2 },
      1000,
      100,
    );
    expect(out[0]).toBe(0);
    expect(out[50]).toBeCloseTo(0.25, 3);
    expect(out[500]).toBeCloseTo(0.5, 3);
    expect(out[900]).toBeCloseTo(0.25, 3);
    expect(out[999]).toBeCloseTo(0.0025, 4);
  });

  it('measures the fade-out from the end of the BAKED clip, after cuts', () => {
    const out = bake(
      {
        ranges: [
          [0, 200],
          [600, 1000],
        ],
        fadeOutSec: 0.1,
      },
      1000,
      1000,
    );
    expect(out).toHaveLength(600);
    expect(out[499]).toBe(1);
    expect(out[550]).toBeCloseTo(0.5);
  });

  it('keeps every channel in step', () => {
    const stage = createMediaBakeAudioStage({
      ranges: [
        [0, 2],
        [4, 6],
      ],
      sampleRate: SR,
      gainDb: 6.0206,
    });
    const left = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const right = Float32Array.from([-0.1, -0.2, -0.3, -0.4, -0.5, -0.6]);
    const out = stage.process([left, right]);
    expect(out?.[0]).toHaveLength(4);
    expect(out?.[1].map((v) => -v)).toEqual(out?.[0]);
  });
});
