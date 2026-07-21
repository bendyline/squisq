import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { resolveMediaSchedule } from '../schemas/Media.js';

function toDoc(md: string) {
  return markdownToDoc(parseMarkdown(md), { articleId: 't' });
}

describe('markdownToDoc media annotations', () => {
  it('lifts a block-level audio annotation into block.media', () => {
    const doc = toDoc(
      '# One {duration=10}\n\nIntro.\n\n{[audio src=narration.mp3 startAt=5 clipEnd=8 spillover=true]}\n',
    );
    const block = doc.blocks[0];
    expect(block.media).toHaveLength(1);
    expect(block.media![0]).toMatchObject({
      src: 'narration.mp3',
      kind: 'audio',
      startAt: 5,
      clipEnd: 8,
      spillover: true,
      anchor: 'block',
    });
    // The annotation paragraph is removed from the visible contents.
    expect(JSON.stringify(block.contents)).not.toContain('narration.mp3');
  });

  it('routes anchor=document annotations to doc.documentMedia', () => {
    const doc = toDoc('{[audio src=voice.mp3 anchor=document]}\n\n# First\n\nBody.\n');
    expect(doc.documentMedia).toHaveLength(1);
    expect(doc.documentMedia![0]).toMatchObject({ src: 'voice.mp3', anchor: 'document' });
    // It is not also attached to the preamble block's media.
    expect(doc.blocks[0].media).toBeUndefined();
  });

  it('recognizes a video annotation as kind video', () => {
    const doc = toDoc('# B {duration=20}\n\n{[video src=clip.mp4 clipStart=2 clipEnd=8]}\n');
    expect(doc.blocks[0].media![0]).toMatchObject({
      src: 'clip.mp4',
      kind: 'video',
      clipStart: 2,
      clipEnd: 8,
    });
  });

  it('parses per-video PIP and overlay placement aliases', () => {
    const doc = toDoc(
      '# B {duration=20}\n\n{[video src=pip.mp4 pip=true]}\n\n{[video src=overlay.mp4 placement=overlay]}\n',
    );
    expect(doc.blocks[0].media?.map((clip) => [clip.src, clip.placement])).toEqual([
      ['pip.mp4', 'picture-in-picture'],
      ['overlay.mp4', 'overlay'],
    ]);
    expect(resolveMediaSchedule(doc).map((clip) => clip.placement)).toEqual([
      'picture-in-picture',
      'overlay',
    ]);
  });

  it('carries per-video PIP size, shape, and position into the schedule', () => {
    const doc = toDoc(
      '# B {duration=20}\n\n{[video src=pip.mp4 placement=picture-in-picture pipSize=large pipShape=wide pipPosition=top-left]}\n',
    );
    expect(doc.blocks[0].media?.[0]).toMatchObject({
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'top-left',
    });
    expect(resolveMediaSchedule(doc)[0]).toMatchObject({
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'top-left',
    });
  });

  it('keeps content videos in the block but promotes placed HTML videos to the schedule', () => {
    const content = toDoc('# B\n\n<video src="content.mp4" controls></video>\n');
    expect(content.blocks[0].media).toBeUndefined();
    expect(JSON.stringify(content.blocks[0].contents)).toContain('content.mp4');

    const pip = toDoc(
      '# B {duration=12}\n\n<video src="presenter.mp4" controls data-squisq-video-placement="picture-in-picture"></video>\n',
    );
    expect(pip.blocks[0].media?.[0]).toMatchObject({
      src: 'presenter.mp4',
      kind: 'video',
      placement: 'picture-in-picture',
      lockToBlock: true,
      anchor: 'block',
    });
    expect(JSON.stringify(pip.blocks[0].contents)).not.toContain('presenter.mp4');
  });

  it('reads per-video PIP size, shape, and position from HTML video attributes', () => {
    const doc = toDoc(
      '# B {duration=12}\n\n<video src="presenter.mp4" data-squisq-video-placement="picture-in-picture" data-squisq-video-pip-size="large" data-squisq-video-pip-shape="wide" data-squisq-video-pip-position="top-right"></video>\n',
    );
    expect(doc.blocks[0].media?.[0]).toMatchObject({
      placement: 'picture-in-picture',
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'top-right',
    });
  });

  it('makes an unlocked placed video document-timed without changing block duration', () => {
    const doc = toDoc(
      '# First {duration=10}\n\nIntro.\n\n# Second {duration=8}\n\n<video src="presenter.mp4" controls data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>\n\n# Third {duration=7}\n\nEnd.\n',
    );
    expect(doc.blocks[1].media).toBeUndefined();
    expect(doc.blocks[1].duration).toBe(8);
    expect(doc.documentMedia?.[0]).toMatchObject({
      src: 'presenter.mp4',
      placement: 'overlay',
      lockToBlock: false,
      anchor: 'document',
      startAt: 10,
    });
    expect(resolveMediaSchedule(doc)[0]).toMatchObject({
      absoluteStart: 10,
      absoluteEnd: 25,
      lockToBlock: false,
      anchor: 'document',
    });
  });

  it('honors explicit independent HTML video timing', () => {
    const doc = toDoc(
      '# B {duration=20}\n\n<video src="presenter.mp4" data-squisq-video-placement="picture-in-picture" data-squisq-video-lock-to-block="false" data-squisq-video-start-at="3" data-squisq-video-clip-start="1" data-squisq-video-clip-end="6"></video>\n',
    );
    expect(doc.documentMedia?.[0]).toMatchObject({
      startAt: 3,
      clipStart: 1,
      clipEnd: 6,
      lockToBlock: false,
    });
    expect(resolveMediaSchedule(doc)[0]).toMatchObject({
      absoluteStart: 3,
      absoluteEnd: 8,
      sourceIn: 1,
    });
  });

  it('accepts startTime as an alias of startAt (startAt wins when both given)', () => {
    const alias = toDoc('# B {duration=20}\n\n{[audio src=a.mp3 startTime=5]}\n');
    expect(alias.blocks[0].media![0].startAt).toBe(5);

    const both = toDoc('# B {duration=20}\n\n{[audio src=a.mp3 startAt=3 startTime=5]}\n');
    expect(both.blocks[0].media![0].startAt).toBe(3);
  });

  it('media annotation text does not inflate block duration', () => {
    // No explicit duration; body is only the annotation → default (5s), not reading-time of the annotation text.
    const doc = toDoc('# B\n\n{[audio src=a.mp3]}\n');
    expect(doc.blocks[0].duration).toBe(5);
  });

  it('feeds resolveMediaSchedule end to end', () => {
    const doc = toDoc(
      '{[audio src=voice.mp3 anchor=document]}\n\n# One {duration=30}\n\n# Two {duration=20}\n\n{[audio src=a.mp3 startAt=5 clipEnd=8]}\n',
    );
    const sched = resolveMediaSchedule(doc);
    const doc1 = sched.find((c) => c.anchor === 'document')!;
    const block = sched.find((c) => c.anchor === 'block')!;
    expect(doc1.absoluteStart).toBe(0);
    expect(doc1.absoluteEnd).toBe(50); // spans both blocks
    expect(block.absoluteStart).toBe(35); // block Two at 30 + startAt 5
  });
});

describe('media annotations vs standalone template blocks', () => {
  it('extracts media annotations as clips, not standalone blocks (media names win)', () => {
    const doc = toDoc('# One\n\nIntro.\n\n{[audio src=narration.mp3]}\n\n{[video src=clip.mp4]}\n');
    const block = doc.blocks[0];
    expect(block.media?.map((m) => m.kind)).toEqual(['audio', 'video']);
    // No sibling standalone blocks were produced for the media names.
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks.some((b) => b.standaloneAnnotation)).toBe(false);
  });

  it('mixes a media clip and a standalone template block in one section', () => {
    const doc = toDoc('# One\n\n{[audio src=n.mp3]}\n\n{[quote]}\n\nquoted\n');
    expect(doc.blocks[0].media?.map((m) => m.kind)).toEqual(['audio']);
    const q = doc.blocks[1];
    expect(q.template).toBe('quote');
    expect(q.standaloneAnnotation).toBe(true);
  });
});
