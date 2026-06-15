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
