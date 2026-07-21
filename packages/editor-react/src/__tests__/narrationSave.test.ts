/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import {
  buildNarrationScript,
  parseNarrationTimingJson,
  type NarrationAlignment,
} from '@bendyline/squisq/narration';
import {
  insertNarrationPreamble,
  narrationAnnotationLine,
} from '../teleprompter/recording/insertPreamble';
import {
  buildNarrationSavePlan,
  discardNarrationSaveProgress,
  executeNarrationSave,
  type NarrationSaveProgress,
} from '../teleprompter/recording/narrationSave';
import { buildFilename } from '../recorder/formats';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';

describe('insertNarrationPreamble', () => {
  it('inserts at the top of a plain document', () => {
    const next = insertNarrationPreamble('# Title\n\nBody.\n', 'audio/narration-1.webm', null);
    expect(next.startsWith('{[audio src=audio/narration-1.webm anchor=document]}\n\n# Title')).toBe(
      true,
    );
  });

  it('inserts after the frontmatter fence', () => {
    const source = '---\ntitle: Doc\n---\n\n# Title\n\nBody.\n';
    const next = insertNarrationPreamble(source, 'audio/narration-1.webm', null);
    const lines = next.split('\n');
    expect(lines[2]).toBe('---');
    expect(next).toContain(
      '---\n\n{[audio src=audio/narration-1.webm anchor=document]}\n\n# Title',
    );
  });

  it('replaces a previous take (and its camera line) on retake', () => {
    const withTake = insertNarrationPreamble(
      '# Title\n\nBody.\n',
      'audio/narration-old.webm',
      'video/narration-cam-old.webm',
    );
    expect(withTake).toContain('narration-old');
    expect(withTake).toContain('<video src="video/narration-cam-old.webm"');

    const retaken = insertNarrationPreamble(withTake, 'audio/narration-new.webm', null);
    expect(retaken).not.toContain('narration-old');
    expect(retaken).not.toContain('narration-cam-old');
    expect(retaken).toContain('{[audio src=audio/narration-new.webm anchor=document]}');
    // No duplicate annotations.
    expect(retaken.match(/\{\[audio /g)?.length).toBe(1);
  });

  /**
   * Regression: the camera matcher used to require a `narration-cam-`
   * prefix (trailing hyphen), but `buildFilename('video', ext,
   * 'narration-cam')` short-circuits the timestamp when a basename is
   * given and emits `video/narration-cam.webm` — no hyphen. The matcher
   * never fired, so every retake APPENDED another `<video>` line.
   *
   * This asserts against the REAL filename the plan produces rather than
   * a hand-crafted `narration-cam-old.webm`, which is what let the bug
   * hide in the previous version of this suite.
   */
  it('replaces the camera line across retakes using the REAL produced filename', () => {
    const cameraPath = `video/${buildFilename('video', '.webm', 'narration-cam')}`;
    // Guard the premise: no timestamp, no trailing hyphen.
    expect(cameraPath).toBe('video/narration-cam.webm');

    const first = insertNarrationPreamble(
      '# Title\n\nBody.\n',
      'audio/narration-1.webm',
      cameraPath,
    );
    const second = insertNarrationPreamble(first, 'audio/narration-2.webm', cameraPath);

    // Exactly one of each after two consecutive saves — not stacked.
    expect(second.match(/<video /g)?.length).toBe(1);
    expect(second.match(/\{\[audio /g)?.length).toBe(1);
    expect(second).toContain('{[audio src=audio/narration-2.webm anchor=document]}');
    expect(second).not.toContain('narration-1');

    // And a third take still holds the line.
    const third = insertNarrationPreamble(second, 'audio/narration-3.webm', cameraPath);
    expect(third.match(/<video /g)?.length).toBe(1);
    expect(third.match(/\{\[audio /g)?.length).toBe(1);
  });

  /**
   * Role matching alone is too broad: document-anchored audio the USER wrote
   * further down (background music) is not our preamble, and neither is
   * whichever `<video>` happens to follow it. Only the preamble region — the
   * blank-padded run at the insertion point — is ours to rewrite.
   */
  it("leaves the user's own document-anchored audio and video alone", () => {
    const source = [
      '# Title',
      '',
      'Body.',
      '',
      '{[audio src=music/bgm.mp3 anchor=document]}',
      '',
      '<video src="clips/my-demo.mp4" controls></video>',
      '',
    ].join('\n');

    const next = insertNarrationPreamble(source, 'audio/narration-1.webm', null);

    // The user's content survives untouched...
    expect(next).toContain('{[audio src=music/bgm.mp3 anchor=document]}');
    expect(next).toContain('<video src="clips/my-demo.mp4" controls></video>');
    // ...and the narration was inserted rather than swapped into their slot.
    expect(next).toContain('{[audio src=audio/narration-1.webm anchor=document]}');
    expect(next.indexOf('narration-1')).toBeLessThan(next.indexOf('bgm.mp3'));
  });

  it('replaces only the preamble take when the user also has doc-anchored audio below', () => {
    const withTake = insertNarrationPreamble(
      '# Title\n\nBody.\n\n{[audio src=music/bgm.mp3 anchor=document]}\n',
      'audio/narration-1.webm',
      'video/narration-cam.webm',
    );
    const retaken = insertNarrationPreamble(withTake, 'audio/narration-2.webm', null);

    expect(retaken).not.toContain('narration-1');
    expect(retaken).not.toContain('narration-cam');
    expect(retaken).toContain('music/bgm.mp3'); // user's line intact
    // Ours replaced, theirs kept → exactly two audio annotations.
    expect(retaken.match(/\{\[audio /g)?.length).toBe(2);
  });

  /**
   * Regression: `MediaProvider.addMedia`'s returned path is authoritative
   * and providers may rename/relocate. A path-prefix matcher would miss
   * its own annotation and stack a second document-anchored track.
   */
  it('replaces a take whose audio path the provider renamed', () => {
    const first = insertNarrationPreamble(
      '# Title\n\nBody.\n',
      'assets/media/take-8f3c21.webm',
      'assets/media/cam-8f3c21.webm',
    );
    expect(first).toContain('{[audio src=assets/media/take-8f3c21.webm anchor=document]}');

    const second = insertNarrationPreamble(
      first,
      'assets/media/take-b7a904.webm',
      'assets/media/cam-b7a904.webm',
    );
    expect(second.match(/\{\[audio /g)?.length).toBe(1);
    expect(second.match(/<video /g)?.length).toBe(1);
    expect(second).not.toContain('8f3c21');
    expect(second).toContain('{[audio src=assets/media/take-b7a904.webm anchor=document]}');
  });

  it('still yields exactly one documentMedia entry after a provider-renamed retake', () => {
    // Renamed paths on purpose: with the old path-prefix matcher this
    // parses to TWO document-anchored audio tracks, i.e. two narrations
    // playing over each other.
    const first = insertNarrationPreamble(
      '---\ntitle: Doc\n---\n\n# Title\n\nBody.\n',
      'assets/take-1.webm',
      'assets/cam-1.webm',
    );
    const second = insertNarrationPreamble(first, 'assets/take-2.webm', 'assets/cam-2.webm');

    const doc = markdownToDoc(parseMarkdown(second));
    expect(doc.documentMedia?.length).toBe(1);
    expect(doc.documentMedia![0].src).toBe('assets/take-2.webm');
    expect(doc.documentMedia![0].anchor).toBe('document');
  });

  it('leaves a non-document-anchored audio annotation alone', () => {
    // Block-anchored audio is a different slot — a narration retake must
    // not consume it.
    const source = '# Title\n\n{[audio src=audio/sfx.mp3]}\n\nBody.\n';
    const next = insertNarrationPreamble(source, 'audio/narration-1.webm', null);
    expect(next).toContain('{[audio src=audio/sfx.mp3]}');
    expect(next).toContain('{[audio src=audio/narration-1.webm anchor=document]}');
    expect(next.match(/\{\[audio /g)?.length).toBe(2);
  });

  it('adds the camera companion as an inline video line', () => {
    const next = insertNarrationPreamble(
      '# Title\n\nBody.\n',
      'audio/narration-1.webm',
      'video/narration-cam-1.webm',
    );
    expect(next).toContain('{[audio src=audio/narration-1.webm anchor=document]}');
    expect(next).toContain('<video src="video/narration-cam-1.webm" controls width="240"></video>');
  });

  it('quotes srcs with spaces', () => {
    expect(narrationAnnotationLine('audio/my take.webm')).toBe(
      '{[audio src="audio/my take.webm" anchor=document]}',
    );
  });

  it('round-trips through markdownToDoc as documentMedia', () => {
    const next = insertNarrationPreamble(
      '---\ntitle: Doc\n---\n\n# Title\n\nBody.\n',
      'audio/narration-1.webm',
      null,
    );
    const doc = markdownToDoc(parseMarkdown(next));
    expect(doc.documentMedia?.length).toBe(1);
    expect(doc.documentMedia![0].src).toBe('audio/narration-1.webm');
    expect(doc.documentMedia![0].anchor).toBe('document');
  });
});

describe('buildNarrationSavePlan', () => {
  const script = buildNarrationScript(
    markdownToDoc(parseMarkdown('# One\n\nAlpha beta.\n\n# Two\n\nGamma delta.\n')),
  );
  const alignment: NarrationAlignment = {
    words: script.tokens.map((_, i) => ({ tokenIndex: i, tSec: i * 0.4, interpolated: false })),
    blocks: script.blocks.map((range, i) => ({
      blockId: range.blockId,
      blockIndex: i,
      charStart: range.charStart,
      charEnd: range.charEnd,
      startSec: i * 5,
      endSec: (i + 1) * 5,
    })),
    detectedSyllables: script.totalSyllables,
    cost: 0,
  };

  it('produces recorder-convention paths and a v3 sidecar the parser accepts', () => {
    const plan = buildNarrationSavePlan({
      script,
      alignment,
      durationSec: 10,
      audioExt: '.webm',
      cameraExt: '.webm',
      baseWpm: 150,
      cameraOffsetSec: 0.02,
    });
    expect(plan.audioRelativeName).toMatch(/^audio\/narration-.*\.webm$/);
    // Exact, not `/^video\/narration-cam.*\.webm$/` — the loose matcher
    // passed either way and hid the fact that `buildFilename` emits no
    // timestamp (and so no trailing hyphen) when given a basename.
    expect(plan.cameraRelativeName).toBe('video/narration-cam.webm');
    expect(plan.sidecarPathFor('audio/renamed.webm')).toBe('audio/renamed.webm.timing.json');

    const parsed = parseNarrationTimingJson(JSON.stringify(plan.sidecarPayload));
    expect(parsed).not.toBeNull();
    expect(parsed!.blocks.length).toBe(script.blocks.length);
    expect(parsed!.bookmarks.length).toBe(script.tokens.length);
    expect(parsed!.cameraOffsetSec).toBeCloseTo(0.02, 6);
  });

  it('degrades to an empty-timing sidecar when alignment failed', () => {
    const plan = buildNarrationSavePlan({
      script,
      alignment: null,
      durationSec: 10,
      audioExt: '.webm',
      cameraExt: null,
      baseWpm: 150,
    });
    expect(plan.cameraRelativeName).toBeNull();
    expect(plan.sidecarPayload.blocks).toEqual([]);
    expect(plan.sidecarPayload.bookmarks).toEqual([]);
    expect(plan.sidecarPayload.sourceText).toBe(script.sourceText);
  });

  it('nextMarkdown composes the preamble from one snapshot', () => {
    const plan = buildNarrationSavePlan({
      script,
      alignment,
      durationSec: 10,
      audioExt: '.webm',
      cameraExt: null,
      baseWpm: 150,
    });
    const next = plan.nextMarkdown('# One\n\nAlpha beta.\n', 'audio/narration-x.webm', null);
    expect(next).toContain('{[audio src=audio/narration-x.webm anchor=document]}');
  });

  it('honors a user-chosen audioBasename (sanitized, no timestamp)', () => {
    const plan = buildNarrationSavePlan({
      script,
      alignment,
      durationSec: 10,
      audioExt: '.webm',
      cameraExt: '.webm',
      baseWpm: 150,
      audioBasename: 'intro take',
    });
    // `buildFilename` slugs whitespace and emits no timestamp for a basename.
    expect(plan.audioRelativeName).toBe('audio/intro-take.webm');
    // The camera keeps its fixed narration-cam base regardless.
    expect(plan.cameraRelativeName).toBe('video/narration-cam.webm');
  });

  it('falls back to the timestamped narration- default without audioBasename', () => {
    const plan = buildNarrationSavePlan({
      script,
      alignment,
      durationSec: 10,
      audioExt: '.webm',
      cameraExt: null,
      baseWpm: 150,
    });
    expect(plan.audioRelativeName).toMatch(/^audio\/narration-\d{8}-\d{6}\.webm$/);
  });
});

/**
 * `executeNarrationSave` writes audio, then the sidecar, then the camera,
 * then the markdown. A throw in any later step used to leave the earlier
 * writes committed with nothing referencing them, and — because
 * `TeleprompterView.handleSave` rebuilds the plan per attempt and
 * `buildFilename` stamps to the SECOND — a retry a moment later wrote a
 * SECOND audio file under a fresh name. The first was then unreachable
 * forever: no markdown ever pointed at it.
 *
 * The fix is a progress record the caller keeps for the life of the take:
 * completed steps are recorded as they land (surviving the throw that
 * aborted the attempt), so a retry resumes instead of restarting.
 */
describe('executeNarrationSave — partial failure and retry', () => {
  const saveScript = buildNarrationScript(markdownToDoc(parseMarkdown('# One\n\nAlpha beta.\n')));
  const BASE_TIME = new Date('2026-07-15T13:00:00Z');

  beforeEach(() => {
    // Pin the clock: `buildFilename` stamps to the SECOND, so without this a
    // retry lands on the same path as the first attempt and an overwrite hides
    // the duplicate the test is hunting for.
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makePlan(cameraExt: string | null = null) {
    return buildNarrationSavePlan({
      script: saveScript,
      alignment: null,
      durationSec: 1,
      audioExt: '.webm',
      cameraExt,
      baseWpm: 150,
    });
  }

  function makeTake(withCamera = false) {
    return {
      audioBlob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
      audioMime: 'audio/webm',
      cameraBlob: withCamera ? new Blob(['cam-bytes'], { type: 'video/webm' }) : null,
      cameraMime: withCamera ? 'video/webm' : null,
    };
  }

  /**
   * Records every write as an APPEND, not a keyed set. A Map keyed by path
   * would silently absorb a duplicate audio write whenever both attempts
   * landed in the same clock second (`buildFilename` stamps to the second) —
   * which is exactly the case a fast test hits, and it hides the bug.
   */
  function makeHarness() {
    const writes: string[] = [];
    const media = new Set<string>();
    const files = new Map<string, number>();
    let source = '# One\n\nAlpha beta.\n';
    let sidecarFails = false;
    let sidecarWrites = 0;

    const mediaProvider = {
      addMedia: async (name: string) => {
        writes.push(name);
        media.add(name);
        return name;
      },
      removeMedia: async (path: string) => {
        media.delete(path);
      },
      resolveUrl: async (p: string) => p,
      listMedia: async () => [],
      dispose: () => {},
    } as unknown as MediaProvider;

    const container = {
      writeFile: async (path: string, data: Uint8Array) => {
        sidecarWrites++;
        if (sidecarFails) throw new Error('sidecar write failed');
        files.set(path, data.byteLength);
      },
      removeFile: async (path: string) => {
        files.delete(path);
      },
    } as unknown as ContentContainer;

    return {
      deps: {
        mediaProvider,
        container,
        getMarkdownSource: () => source,
        setMarkdownSource: (next: string) => {
          source = next;
        },
        bumpMediaRevision: () => {},
      },
      media,
      files,
      get source() {
        return source;
      },
      get sidecarWrites() {
        return sidecarWrites;
      },
      setSource: (s: string) => {
        source = s;
      },
      failSidecar: (on: boolean) => {
        sidecarFails = on;
      },
      /** Distinct audio files still present in the container. */
      audioFiles: () => [...media].filter((k) => k.startsWith('audio/narration-')),
      /** Every audio write ATTEMPT — catches a rewrite to an identical path. */
      audioWrites: () => writes.filter((k) => k.startsWith('audio/narration-')),
    };
  }

  it('a retry after a sidecar failure reuses the audio instead of writing a second file', async () => {
    const h = makeHarness();
    const take = makeTake();
    const progress: NarrationSaveProgress = {};

    h.failSidecar(true);
    await expect(executeNarrationSave(makePlan(), take, h.deps, progress)).rejects.toThrow(
      'sidecar write failed',
    );
    // The audio landed before the sidecar threw — that is the orphan window.
    expect(h.audioWrites()).toHaveLength(1);
    const firstAudio = h.audioFiles()[0]!;
    expect(progress.audioPath).toBe(firstAudio);
    expect(progress.sidecarPath).toBeUndefined();

    // The user retries a few seconds later. The clock matters: `buildFilename`
    // stamps to the SECOND, so a same-second retry would collide onto the same
    // path and hide a duplicate write behind an overwrite. Move time on so the
    // rebuilt plan genuinely proposes a NEW filename — the real duplicate.
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 5000));
    expect(makePlan().audioRelativeName).not.toBe(firstAudio);

    h.failSidecar(false);
    const result = await executeNarrationSave(makePlan(), take, h.deps, progress);

    // One audio write TOTAL across both attempts — the retry reused it.
    expect(h.audioWrites()).toHaveLength(1);
    expect(h.audioFiles()).toEqual([firstAudio]);
    expect(result.audioPath).toBe(firstAudio);
    expect(h.files.has(result.sidecarPath)).toBe(true);
    expect(h.source).toContain(`{[audio src=${firstAudio} anchor=document]}`);
    // Exactly one narration reference — not one per attempt.
    expect(h.source.match(/\{\[audio /g)?.length).toBe(1);
  });

  it('a retry after a camera failure re-writes neither the audio nor the sidecar', async () => {
    const h = makeHarness();
    const take = makeTake(true);
    const plan = makePlan('.webm');
    const progress: NarrationSaveProgress = {};

    let cameraFails = true;
    const realAdd = h.deps.mediaProvider.addMedia.bind(h.deps.mediaProvider);
    h.deps.mediaProvider.addMedia = async (name, data, mime) => {
      if (cameraFails && name.startsWith('video/')) throw new Error('camera write failed');
      return realAdd(name, data, mime);
    };

    await expect(executeNarrationSave(plan, take, h.deps, progress)).rejects.toThrow(
      'camera write failed',
    );
    expect(h.sidecarWrites).toBe(1);
    expect(h.audioWrites()).toHaveLength(1);
    const firstAudio = h.audioFiles()[0]!;

    cameraFails = false;
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 5000));
    const result = await executeNarrationSave(plan, take, h.deps, progress);

    expect(h.audioWrites()).toHaveLength(1);
    expect(h.audioFiles()).toEqual([firstAudio]);
    // The sidecar is not rewritten either — it already landed.
    expect(h.sidecarWrites).toBe(1);
    expect(result.cameraPath).toBe('video/narration-cam.webm');
    expect(h.source.match(/<video /g)?.length).toBe(1);
  });

  /**
   * `deps.markdownSource` used to be a STRING, snapshotted by
   * TeleprompterView's render before the media writes were even started. Any
   * source change that landed during those awaits was clobbered by the single
   * markdown write at the end. It is now a getter, read at write time.
   *
   * The read must happen AFTER the awaits — a getter called at the top of the
   * executor would be just as stale — so the edit here is injected from inside
   * the first media write.
   */
  it('composes the preamble from the LIVE source, not one snapshotted before the writes', async () => {
    const h = makeHarness();
    let reads = 0;
    const deps = {
      ...h.deps,
      getMarkdownSource: () => {
        reads++;
        return h.source;
      },
    };

    const realAdd = deps.mediaProvider.addMedia.bind(deps.mediaProvider);
    deps.mediaProvider.addMedia = async (name, data, mime) => {
      // An edit landing mid-flight, after any pre-await snapshot was taken.
      h.setSource('# One\n\nAlpha beta.\n\n## Added mid-save\n');
      return realAdd(name, data, mime);
    };

    await executeNarrationSave(makePlan(), makeTake(), deps, {});

    // Read once, and only once the writes were done.
    expect(reads).toBe(1);
    expect(h.source).toContain('## Added mid-save');
    expect(h.source).toContain('anchor=document');
  });

  it('discardNarrationSaveProgress removes what an abandoned attempt left behind', async () => {
    const h = makeHarness();
    const progress: NarrationSaveProgress = {};

    h.failSidecar(true);
    await expect(executeNarrationSave(makePlan(), makeTake(), h.deps, progress)).rejects.toThrow();
    expect(h.audioFiles().length).toBe(1);

    // The user gives up on this take rather than retrying.
    await discardNarrationSaveProgress(progress, {
      mediaProvider: h.deps.mediaProvider,
      container: h.deps.container,
    });

    expect(h.audioFiles()).toEqual([]);
    expect(progress.audioPath).toBeUndefined();
  });

  it('a fresh take after a discarded failure starts clean (no resurrected path)', async () => {
    const h = makeHarness();
    const progress: NarrationSaveProgress = {};
    h.failSidecar(true);
    await expect(executeNarrationSave(makePlan(), makeTake(), h.deps, progress)).rejects.toThrow();
    await discardNarrationSaveProgress(progress, {
      mediaProvider: h.deps.mediaProvider,
      container: h.deps.container,
    });

    h.failSidecar(false);
    // A NEW take gets a NEW progress record — the view keys it by take identity.
    const result = await executeNarrationSave(makePlan(), makeTake(), h.deps, {});
    expect(h.audioFiles()).toEqual([result.audioPath]);
    expect(h.source).toContain(`{[audio src=${result.audioPath} anchor=document]}`);
  });
});
