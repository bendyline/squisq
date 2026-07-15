/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
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
import { buildNarrationSavePlan } from '../teleprompter/recording/narrationSave';
import { buildFilename } from '../recorder/formats';

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
});
