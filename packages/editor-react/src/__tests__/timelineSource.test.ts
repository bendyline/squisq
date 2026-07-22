import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import {
  formatSeconds,
  setBlockDurationInSource,
  setBlockStartTimeInSource,
  setBlockTransitionInSource,
  setMediaClipInSource,
  buildClipAnnotation,
  placeClipInBlock,
} from '../timelineSource';

/** Re-parse and read a block's duration to confirm the edit took effect. */
function durationOf(source: string, blockIndex: number): number {
  const doc = markdownToDoc(parseMarkdown(source), { articleId: 't' });
  return doc.blocks[blockIndex].duration;
}

describe('formatSeconds', () => {
  it('keeps integers bare and rounds fractions', () => {
    expect(formatSeconds(8)).toBe('8');
    expect(formatSeconds(8.5)).toBe('8.5');
    expect(formatSeconds(8.499)).toBe('8.5');
    expect(formatSeconds(-3)).toBe('0');
  });
});

describe('setBlockDurationInSource', () => {
  it('inserts the duration on a bare heading in the squiggly form', () => {
    const src = '# Intro\n\nBody.\n';
    const next = setBlockDurationInSource(src, 1, 12)!;
    expect(next).toContain('# Intro {[duration=12]}');
    expect(durationOf(next, 0)).toBe(12);
  });

  it('folds the duration into an existing template annotation', () => {
    const src = '# Title {[sectionHeader]}\n\nBody.\n';
    const next = setBlockDurationInSource(src, 1, 7)!;
    expect(next).toContain('{[sectionHeader duration=7]}');
    expect(durationOf(next, 0)).toBe(7);
  });

  it('updates an existing squiggly duration in place', () => {
    const src = '# Intro {[duration=5]}\n\nBody.\n';
    const next = setBlockDurationInSource(src, 1, 9)!;
    expect(next).toContain('{[duration=9]}');
    expect(next).not.toContain('duration=5');
    expect(durationOf(next, 0)).toBe(9);
  });

  it('migrates a legacy Pandoc duration to squiggly, preserving id/classes', () => {
    const src = '# Intro {#intro .hero duration=5}\n\nBody.\n';
    const next = setBlockDurationInSource(src, 1, 9)!;
    expect(next).toContain('#intro');
    expect(next).toContain('.hero');
    expect(next).toContain('{[duration=9]}');
    // The stale Pandoc duration is gone so the two forms can't disagree.
    expect(next).not.toMatch(/\{[^[]*duration=/);
    expect(durationOf(next, 0)).toBe(9);
  });

  it('clears explicit duration to restore automatic timing', () => {
    const src = '# Intro {#intro duration=5} {[title duration=9 color=blue]}\n\nBody.\n';
    const next = setBlockDurationInSource(src, 1, null)!;
    expect(next).toBe('# Intro {#intro} {[title color=blue]}\n\nBody.\n');
    expect(durationOf(next, 0)).not.toBe(9);
  });

  it('returns null for a non-heading line', () => {
    expect(setBlockDurationInSource('not a heading\n', 1, 5)).toBeNull();
  });
});

describe('other block properties in timeline source', () => {
  it('sets and clears an explicit start time', () => {
    const source = '# Intro {[title]}\n\nBody.\n';
    const set = setBlockStartTimeInSource(source, 1, 2.5)!;
    expect(set).toContain('{[title startTime=2.5]}');
    expect(setBlockStartTimeInSource(set, 1, null)).toBe(source);
  });

  it('sets a transition through the shared heading serializer', () => {
    const next = setBlockTransitionInSource('# Intro\n', 1, {
      type: 'fade',
      direction: '',
      duration: '0.7',
    });
    expect(next).toBe('# Intro {[transition=fade transitionDuration=0.7]}\n');
  });
});

describe('setMediaClipInSource', () => {
  const src = '# B {duration=20}\n\n{[audio src=a.mp3 startAt=2]}\n';

  it('patches startAt on a media annotation', () => {
    const next = setMediaClipInSource(src, 3, { startAt: 6 })!;
    expect(next).toContain('{[audio src=a.mp3 startAt=6]}');
    const doc = markdownToDoc(parseMarkdown(next), { articleId: 't' });
    expect(doc.blocks[0].media![0].startAt).toBe(6);
  });

  it('adds clipEnd and toggles spillover, keeping src', () => {
    const next = setMediaClipInSource(src, 3, { clipEnd: 30, spillover: true })!;
    expect(next).toContain('src=a.mp3');
    expect(next).toContain('clipEnd=30');
    expect(next).toContain('spillover=true');
  });

  it('removes a key when patched with null', () => {
    const withSpill = setMediaClipInSource(src, 3, { spillover: true })!;
    const removed = setMediaClipInSource(withSpill, 3, { spillover: null })!;
    expect(removed).not.toContain('spillover');
  });

  it('returns null for a non-media line', () => {
    expect(setMediaClipInSource(src, 1, { startAt: 1 })).toBeNull();
  });

  it('patches timing attributes on an unlocked toolbar-authored HTML video', () => {
    const html =
      '# B {duration=20}\n\n<video src="v.mp4" controls data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>\n';
    const next = setMediaClipInSource(html, 3, { startAt: 6, clipEnd: 14 })!;
    expect(next).toContain('data-squisq-video-start-at="6"');
    expect(next).toContain('data-squisq-video-clip-end="14"');
    expect(next).toContain('data-squisq-video-lock-to-block="false"');
    const doc = markdownToDoc(parseMarkdown(next), { articleId: 't' });
    expect(doc.documentMedia?.[0]).toMatchObject({ startAt: 6, clipEnd: 14 });
  });

  it('patches video composition properties on annotations', () => {
    const video = '# B {duration=20}\n\n{[video src=v.mp4 pip=true]}\n';
    const next = setMediaClipInSource(video, 3, {
      placement: 'picture-in-picture',
      lockToBlock: false,
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'top-left',
    })!;
    expect(next).not.toContain('pip=true');
    expect(next).toContain('placement=picture-in-picture');
    expect(next).toContain('lockToBlock=false');
    expect(next).toContain('pipSize=large');
    expect(next).toContain('pipShape=wide');
    expect(next).toContain('pipPosition=top-left');
    const doc = markdownToDoc(parseMarkdown(next), { articleId: 't' });
    expect(doc.documentMedia?.[0]).toMatchObject({
      placement: 'picture-in-picture',
      lockToBlock: false,
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'top-left',
    });
  });

  it('patches and clears video composition properties on HTML video', () => {
    const html = '# B\n\n<video src="v.mp4" controls></video>\n';
    const placed = setMediaClipInSource(html, 3, {
      placement: 'picture-in-picture',
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'top-right',
    })!;
    expect(placed).toContain('data-squisq-video-placement="picture-in-picture"');
    expect(placed).toContain('data-squisq-video-pip-size="large"');
    expect(placed).toContain('data-squisq-video-pip-shape="wide"');
    expect(placed).toContain('data-squisq-video-pip-position="top-right"');

    const content = setMediaClipInSource(placed, 3, {
      placement: 'content',
      lockToBlock: null,
      pipSize: null,
      pipShape: null,
      pipPosition: null,
    })!;
    expect(content).toBe(html);
  });
});

describe('buildClipAnnotation', () => {
  it('emits a minimal annotation', () => {
    expect(buildClipAnnotation({ kind: 'video', src: 'r.webm' }, 0)).toBe('{[video src=r.webm]}');
  });

  it('includes timing fields when set', () => {
    expect(
      buildClipAnnotation({ kind: 'audio', src: 'a.mp3', clipEnd: 8, spillover: true }, 5),
    ).toBe('{[audio src=a.mp3 startAt=5 clipEnd=8 spillover=true]}');
  });
});

describe('placeClipInBlock', () => {
  // Lines: 1 "# One {duration=10}", 2 "", 3 "<video src=r.webm></video>",
  //        4 "", 5 "# Two {duration=10}", 6 "", 7 "body"
  const src =
    '# One {duration=10}\n\n<video src="r.webm"></video>\n\n# Two {duration=10}\n\nbody\n';

  it('converts an embed to an annotation in place (same block)', () => {
    const next = placeClipInBlock(src, 3, 1, { kind: 'video', src: 'r.webm', clipEnd: 10 }, 0)!;
    expect(next).toContain('{[video src=r.webm clipEnd=10]}');
    expect(next).not.toContain('<video');
    // Still under block One (line 1), before block Two.
    expect(next.indexOf('{[video')).toBeLessThan(next.indexOf('# Two'));
  });

  it('relocates the clip into a different (earlier/later) block', () => {
    // Move the embed (line 3, in block One) into block Two (heading line 5).
    const next = placeClipInBlock(src, 3, 5, { kind: 'video', src: 'r.webm', clipEnd: 4 }, 2)!;
    expect(next).not.toContain('<video');
    // The annotation now sits after block Two's heading.
    const twoIdx = next.indexOf('# Two');
    const clipIdx = next.indexOf('{[video');
    expect(clipIdx).toBeGreaterThan(twoIdx);
    expect(next).toContain('startAt=2');
    // Re-parsing attaches it to block Two as a media clip.
    const doc = markdownToDoc(parseMarkdown(next), { articleId: 't' });
    expect(doc.blocks[1].media?.[0]).toMatchObject({ src: 'r.webm', startAt: 2, anchor: 'block' });
    expect(doc.blocks[0].media).toBeUndefined();
  });
});
