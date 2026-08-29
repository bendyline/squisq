import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import {
  buildDocumentNarrationTags,
  documentNarrationVideoTag,
  firstBlockBodyLine,
  insertDocumentNarration,
} from '../recorder/documentNarrationInsertion';
import type { RecorderSaveResult } from '../recorder/RecorderModal';

/**
 * "Insert → Document narration" differs from "Record media" only in the
 * markdown it writes: the take lands at the top of the FIRST block and, for
 * video, is unlocked from that block so it plays across the whole document.
 * These tests lock the emitted markup, the placement rules, and — through
 * `markdownToDoc` — that the result really is a document-anchored clip
 * starting at t=0.
 */

function videoResult(duration = 42.5): RecorderSaveResult {
  return {
    relativePath: 'video/camera-20260827-101500.webm',
    filename: 'camera-20260827-101500.webm',
    source: 'camera',
    mediaKind: 'video',
    mimeType: 'video/webm',
    duration,
    hasTimingSidecar: false,
  };
}

function audioResult(): RecorderSaveResult {
  return {
    relativePath: 'audio/narration-20260827-101500.webm',
    filename: 'narration-20260827-101500.webm',
    source: 'mic',
    mediaKind: 'audio',
    mimeType: 'audio/webm',
    duration: 30,
    hasTimingSidecar: false,
  };
}

function dualResult(): RecorderSaveResult {
  return {
    relativePath: 'video/screen-20260827-101500.webm',
    filename: 'screen-20260827-101500.webm',
    source: 'screen+camera',
    mediaKind: 'video',
    mimeType: 'video/webm',
    duration: 12,
    hasTimingSidecar: false,
    camera: {
      relativePath: 'video/camera-20260827-101500.webm',
      filename: 'camera-20260827-101500.webm',
      mimeType: 'video/webm',
      duration: 12,
      offsetSec: 0,
    },
  };
}

describe('buildDocumentNarrationTags', () => {
  it('emits an unlocked full-frame overlay for a solo video take', () => {
    expect(buildDocumentNarrationTags(videoResult())).toEqual([
      '<video src="video/camera-20260827-101500.webm" controls width="480"' +
        ' data-squisq-video-placement="overlay"' +
        ' data-squisq-video-lock-to-block="false"' +
        ' data-squisq-video-clip-end="42.5"></video>',
    ]);
  });

  it('emits a document-anchored annotation for an audio-only take', () => {
    expect(buildDocumentNarrationTags(audioResult())).toEqual([
      '{[audio src=audio/narration-20260827-101500.webm anchor=document]}',
    ]);
  });

  it('reuses the dual screen + camera pair, screen first', () => {
    const tags = buildDocumentNarrationTags(dualResult());
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain('data-squisq-video-placement="overlay"');
    expect(tags[1]).toContain('data-squisq-video-placement="picture-in-picture"');
    expect(tags.every((tag) => tag.includes('data-squisq-video-lock-to-block="false"'))).toBe(true);
  });
});

describe('firstBlockBodyLine', () => {
  it('lands just after the first heading', () => {
    expect(firstBlockBodyLine(['# Title', '', 'Body'])).toBe(1);
  });

  it('skips frontmatter when looking for the heading', () => {
    expect(firstBlockBodyLine(['---', 'title: X', '---', '', '## Two', 'Body'])).toBe(5);
  });

  it('ignores a heading-shaped line inside a fenced code block', () => {
    expect(firstBlockBodyLine(['```sh', '# not a heading', '```', '', '# Real', 'Body'])).toBe(5);
  });

  it('falls back to the top of a heading-less document', () => {
    expect(firstBlockBodyLine(['Just prose.'])).toBe(0);
    expect(firstBlockBodyLine(['---', 'title: X', '---', 'Just prose.'])).toBe(3);
  });
});

describe('insertDocumentNarration', () => {
  const tag = documentNarrationVideoTag('video/take.webm', 8);

  it('writes the tag inside the first block, blank-line separated', () => {
    expect(insertDocumentNarration('# Title\n\nIntro.\n', [tag])).toBe(
      `# Title\n\n${tag}\n\nIntro.\n`,
    );
  });

  it('writes at the top of a heading-less document', () => {
    expect(insertDocumentNarration('Just prose.\n', [tag])).toBe(`${tag}\n\nJust prose.\n`);
  });

  it('writes after frontmatter and the first heading', () => {
    const source = '---\ntitle: X\n---\n\n# Title\n\nIntro.\n';
    expect(insertDocumentNarration(source, [tag])).toBe(
      `---\ntitle: X\n---\n\n# Title\n\n${tag}\n\nIntro.\n`,
    );
  });

  it('replaces a previous take instead of stacking a second document track', () => {
    const once = insertDocumentNarration('# Title\n\nIntro.\n', [tag]);
    const retake = documentNarrationVideoTag('video/take-2.webm', 9);
    const twice = insertDocumentNarration(once, [retake]);
    expect(twice).toBe(`# Title\n\n${retake}\n\nIntro.\n`);
    expect(twice).not.toContain('video/take.webm');
  });

  it('replaces a previous dual pair with a single solo take', () => {
    const pair = buildDocumentNarrationTags(dualResult());
    const once = insertDocumentNarration('# Title\n\nIntro.\n', pair);
    expect(once).toContain('picture-in-picture');
    const twice = insertDocumentNarration(once, [tag]);
    expect(twice).toBe(`# Title\n\n${tag}\n\nIntro.\n`);
  });

  it('leaves a block-locked video the user authored elsewhere alone', () => {
    const authored =
      '# Title\n\n<video src="video/demo.webm" controls width="480"></video>\n\nIntro.\n';
    const next = insertDocumentNarration(authored, [tag]);
    expect(next).toContain('<video src="video/demo.webm" controls width="480"></video>');
    expect(next).toBe(
      `# Title\n\n${tag}\n\n<video src="video/demo.webm"` +
        ' controls width="480"></video>\n\nIntro.\n',
    );
  });

  it('does not touch a document-anchored annotation further down the document', () => {
    const authored =
      '# Title\n\nIntro.\n\n# Second\n\n{[audio src=audio/music.webm anchor=document]}\n';
    const next = insertDocumentNarration(authored, [tag]);
    expect(next).toContain('{[audio src=audio/music.webm anchor=document]}');
  });

  it('is a no-op with no tags', () => {
    expect(insertDocumentNarration('# Title\n', [])).toBe('# Title\n');
  });
});

describe('round trip through markdownToDoc', () => {
  it('produces a document-anchored clip that starts when playback starts', () => {
    const source = insertDocumentNarration(
      '# First\n\nIntro.\n\n# Second\n\nMore.\n',
      buildDocumentNarrationTags(videoResult(42.5)),
    );
    const doc = markdownToDoc(parseMarkdown(source));
    expect(doc.documentMedia).toHaveLength(1);
    const clip = doc.documentMedia![0];
    expect(clip.kind).toBe('video');
    expect(clip.placement).toBe('overlay');
    expect(clip.lockToBlock).toBe(false);
    expect(clip.anchor).toBe('document');
    // The first block starts the timeline, so an unlocked clip living in it
    // begins at zero — the whole point of writing it there.
    expect(clip.startAt).toBe(0);
    expect(clip.clipEnd).toBe(42.5);
    // The tag is lifted out of the body, so the block still reads as prose.
    expect(doc.blocks[0].contents?.some((node) => node.type === 'htmlBlock')).toBeFalsy();
  });

  it('lifts an audio take into the document-spanning narration slot', () => {
    const source = insertDocumentNarration(
      '# First\n\nIntro.\n',
      buildDocumentNarrationTags(audioResult()),
    );
    const doc = markdownToDoc(parseMarkdown(source));
    expect(doc.documentMedia).toHaveLength(1);
    expect(doc.documentMedia![0]).toMatchObject({
      kind: 'audio',
      anchor: 'document',
      src: 'audio/narration-20260827-101500.webm',
      startAt: 0,
    });
  });
});
