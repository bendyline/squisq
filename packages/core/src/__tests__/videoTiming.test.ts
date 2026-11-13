import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { applyVideoDurations, flattenBlocks, markdownToDoc } from '../doc/markdownToDoc.js';
import { blockVideoLength, collectVideoDurationSources } from '../doc/videoTiming.js';
import type { Block, Doc } from '../schemas/Doc.js';

function toDoc(md: string): Doc {
  return markdownToDoc(parseMarkdown(md), { articleId: 't' });
}

function block(doc: Doc, title: string): Block {
  const found = flattenBlocks(doc.blocks).find((b) => b.title === title);
  if (!found) throw new Error(`no block titled ${title}`);
  return found;
}

/** A caption-only slide over a clip — the shape that used to cut off at 3s. */
const CLIP_SLIDE = '# Demo\n\n.\n\n<video src="demo.mp4" controls width="480"></video>\n';
const NEXT = '\n# Next\n\nThe following slide has a sentence of its own.\n';

describe('a block is held open for its video', () => {
  it('keeps the text estimate when the video length is unknown', () => {
    const doc = toDoc(CLIP_SLIDE + NEXT);
    expect(block(doc, 'Demo').duration).toBe(3);
    expect(block(doc, 'Next').startTime).toBe(3);
  });

  it('uses an authored out-point without any lookup', () => {
    const doc = toDoc(
      '# Demo\n\n.\n\n<video src="demo.mp4" data-squisq-video-clip-end="100"></video>\n' + NEXT,
    );
    expect(block(doc, 'Demo').duration).toBe(100);
    expect(block(doc, 'Next').startTime).toBe(100);
    expect(doc.duration).toBe(100 + block(doc, 'Next').duration);
  });

  it('measures from the block start through the trimmed, cut clip', () => {
    const doc = toDoc(
      '# Demo\n\n.\n\n<video src="demo.mp4" data-squisq-video-start-at="2"' +
        ' data-squisq-video-clip-start="10" data-squisq-video-clip-end="40"' +
        ' data-squisq-video-cuts="20-25"></video>\n',
    );
    // 2s delay + (40 − 10) − 5s cut.
    expect(block(doc, 'Demo').duration).toBe(27);
  });

  it('never shortens a block whose text reads longer than its video', () => {
    const prose = 'This sentence is long enough to read slowly. '.repeat(20);
    const doc = toDoc(
      `# Demo\n\n${prose}\n\n<video src="demo.mp4" data-squisq-video-clip-end="2"></video>\n`,
    );
    expect(block(doc, 'Demo').duration).toBeGreaterThan(10);
  });

  it('lets an author-pinned duration win', () => {
    const doc = toDoc(
      '# Demo {duration=5}\n\n<video src="demo.mp4" data-squisq-video-clip-end="100"></video>\n',
    );
    expect(block(doc, 'Demo').duration).toBe(5);
    expect(applyVideoDurations(doc, () => 100)).toBe(doc);
  });

  it('counts a block-anchored video clip that ends with its block', () => {
    const doc = toDoc('# Demo\n\n.\n\n{[video src=clip.mp4 clipStart=2 clipEnd=32]}\n');
    expect(block(doc, 'Demo').duration).toBe(30);
  });

  it('ignores spillover clips and audio', () => {
    const doc = toDoc(
      '# Demo\n\n.\n\n{[video src=clip.mp4 clipEnd=60 spillover=true]}\n\n' +
        '{[audio src=bed.mp3 clipEnd=90]}\n',
    );
    expect(block(doc, 'Demo').duration).toBe(3);
  });
});

describe('applyVideoDurations', () => {
  it('re-lays the timeline once a file length is known', () => {
    const doc = toDoc(CLIP_SLIDE + NEXT);
    const timed = applyVideoDurations(doc, (src) => (src === 'demo.mp4' ? 101.5 : undefined));

    expect(block(timed, 'Demo').duration).toBe(101.5);
    expect(block(timed, 'Next').startTime).toBe(101.5);
    expect(timed.duration).toBe(101.5 + block(timed, 'Next').duration);
    // The next slide's caption moves with it.
    const nextCaption = timed.captions?.phrases.find((p) => p.text.startsWith('The following'));
    expect(nextCaption?.startTime).toBe(101.5);
  });

  it('matches what conversion produces from the same length authored', () => {
    const probed = applyVideoDurations(toDoc(CLIP_SLIDE + NEXT), () => 42);
    const authored = toDoc(
      '# Demo\n\n.\n\n<video src="demo.mp4" controls width="480" data-squisq-video-clip-end="42"></video>\n' +
        NEXT,
    );
    const timing = (doc: Doc) =>
      flattenBlocks(doc.blocks).map((b) => [b.id, b.startTime, b.duration]);
    expect(timing(probed)).toEqual(timing(authored));
    expect(probed.captions?.phrases).toEqual(authored.captions?.phrases);
    expect(probed.duration).toBe(authored.duration);
  });

  it('does not mutate its input', () => {
    const doc = toDoc(CLIP_SLIDE + NEXT);
    const before = JSON.stringify(doc);
    applyVideoDurations(doc, () => 60);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('returns the same doc when no block grows', () => {
    const doc = toDoc(CLIP_SLIDE + NEXT);
    expect(applyVideoDurations(doc, () => 1)).toBe(doc);
    expect(applyVideoDurations(doc, () => undefined)).toBe(doc);
  });

  it('applies a file length to a markdown-image video', () => {
    const doc = toDoc('# Demo\n\n![Walkthrough](walkthrough.webm)\n' + NEXT);
    const timed = applyVideoDurations(doc, () => 75);
    expect(block(timed, 'Demo').duration).toBe(75);
  });

  it('starts an unlocked video with its re-timed block', () => {
    const doc = toDoc(
      CLIP_SLIDE +
        NEXT +
        '\n<video src="talk.mp4" data-squisq-video-placement="overlay"' +
        ' data-squisq-video-lock-to-block="false"></video>\n',
    );
    const timed = applyVideoDurations(doc, (src) => (src === 'demo.mp4' ? 80 : undefined));
    const talk = timed.documentMedia?.find((clip) => clip.src === 'talk.mp4');
    expect(talk?.startAt).toBe(80);
  });
});

describe('collectVideoDurationSources', () => {
  it('lists each video whose length only its file can tell, once', () => {
    const doc = toDoc(
      CLIP_SLIDE +
        '\n# Again\n\n<video src="demo.mp4"></video>\n\n' +
        '<video src="trimmed.mp4" data-squisq-video-clip-end="9"></video>\n\n' +
        '![Walkthrough](walkthrough.webm)\n',
    );
    expect(collectVideoDurationSources(doc)).toEqual(['demo.mp4', 'walkthrough.webm']);
  });

  it('reports no length for a block without video', () => {
    expect(blockVideoLength(block(toDoc(NEXT), 'Next'), () => 99)).toBeNull();
  });
});
