/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMediaEdits, parseMediaFx } from '@bendyline/squisq/mediaEdit';
import type { MediaEdits } from '@bendyline/squisq/schemas';
import {
  buildClipAnnotation,
  placeClipInBlock,
  setMediaClipInSource,
  setMediaClipsInSource,
} from '../timelineSource';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { TiptapVideo } from '../tiptap/TiptapVideo';
import { TiptapAudio } from '../tiptap/TiptapAudio';
import { collectEmbeddedMediaSchedule } from '../embeddedMedia';

const cleanup: MediaEdits = {
  fx: parseMediaFx('denoise:0.8 debreath:-15 loudness:-16')!,
  cuts: [{ start: 3, end: 4.5 }],
  gain: -2,
};

function clipsOf(source: string) {
  const doc = markdownToDoc(parseMarkdown(source), { articleId: 't' });
  return doc.documentMedia ?? [];
}

describe('setMediaClipInSource — edits', () => {
  it('writes a whole recipe onto an annotation, preserving unrelated params', () => {
    const source = '{[audio src=audio/take.webm anchor=document startAt=2]}\n\n# One\n';
    const next = setMediaClipInSource(source, 1, { edits: cleanup })!;
    expect(next.split('\n')[0]).toBe(
      '{[audio src=audio/take.webm anchor=document startAt=2' +
        ' fx="denoise:0.8 debreath:-15 loudness:-16" cuts=3-4.5 gain=-2]}',
    );
    expect(clipsOf(next)[0].edits).toEqual(cleanup);
  });

  it('replaces the recipe and removes fields the new recipe drops', () => {
    const source =
      '{[audio src=a.webm anchor=document fx=denoise:0.5 cuts=1-2 gain=-3]}\n\n# One\n';
    const next = setMediaClipInSource(source, 1, { edits: { gain: 4 } })!;
    expect(next.split('\n')[0]).toBe('{[audio src=a.webm anchor=document gain=4]}');
    const cleared = setMediaClipInSource(next, 1, { edits: null })!;
    expect(cleared.split('\n')[0]).toBe('{[audio src=a.webm anchor=document]}');
  });

  it('writes recipe attributes onto a standalone video tag', () => {
    const source =
      '# One\n\n<video src="video/s.webm" controls data-squisq-video-placement="overlay"></video>\n';
    const next = setMediaClipInSource(source, 3, {
      edits: { fx: parseMediaFx('loudness:-14')!, crop: { x: 0.1, y: 0, w: 0.8, h: 1 } },
    })!;
    expect(next.split('\n')[2]).toBe(
      '<video src="video/s.webm" controls data-squisq-video-placement="overlay"' +
        ' data-squisq-video-fx="loudness:-14" data-squisq-video-crop="0.1 0 0.8 1"></video>',
    );
  });

  it('applies a group of patches as one rewrite, or nothing when a line is not media', () => {
    const source = '{[audio src=a.webm anchor=document]}\n\n{[audio src=b.webm anchor=document]}\n';
    const both = setMediaClipsInSource(source, [
      { line: 1, patch: { edits: { gain: -1 } } },
      { line: 3, patch: { edits: { gain: -1 } } },
    ])!;
    expect(clipsOf(both).map((c) => c.edits?.gain)).toEqual([-1, -1]);
    expect(
      setMediaClipsInSource(source, [
        { line: 1, patch: { edits: { gain: -1 } } },
        { line: 2, patch: { edits: { gain: -1 } } },
      ]),
    ).toBeNull();
  });
});

describe('clip relocation keeps the recipe', () => {
  it('buildClipAnnotation serializes edits', () => {
    expect(buildClipAnnotation({ kind: 'audio', src: 'a.webm', edits: { gain: -6 } }, 0)).toBe(
      '{[audio src=a.webm gain=-6]}',
    );
  });

  it('placeClipInBlock carries edits across blocks', () => {
    const source = '# One\n\n{[audio src=a.webm fx=loudness]}\n\n# Two\n\nBody\n';
    const edits = parseMediaEdits({ fx: 'loudness' });
    const next = placeClipInBlock(source, 3, 5, { kind: 'audio', src: 'a.webm', edits }, 1)!;
    expect(next).toContain('# Two\n\n{[audio src=a.webm startAt=1 fx=loudness:-16]}');
  });
});

describe('Write view round-trip', () => {
  it('tiptapToMarkdown keeps recipe attributes on video and audio in canonical order', () => {
    const video =
      '<video src="v.webm" controls data-squisq-video-group="g1" data-squisq-video-fx="denoise:0.8"' +
      ' data-squisq-video-crop="0 0 0.5 0.5"></video>';
    expect(tiptapToMarkdown(video)).toContain(
      '<video src="v.webm" controls data-squisq-video-fx="denoise:0.8"' +
        ' data-squisq-video-crop="0 0 0.5 0.5" data-squisq-video-group="g1"></video>',
    );
    const audio = '<audio src="a.webm" controls data-squisq-audio-fade-in="0.3"></audio>';
    expect(tiptapToMarkdown(audio)).toContain(
      '<audio src="a.webm" controls data-squisq-audio-fade-in="0.3"></audio>',
    );
  });

  it('survives a trip through the Tiptap node schema', () => {
    const md =
      '<video src="v.webm" controls data-squisq-video-placement="overlay"' +
      ' data-squisq-video-lock-to-block="false" data-squisq-video-fx="loudness:-16"' +
      ' data-squisq-video-cuts="1-2"></video>\n\n' +
      '<audio src="a.webm" controls data-squisq-audio-gain="-3"></audio>';
    const editor = new Editor({
      extensions: [StarterKit, TiptapVideo, TiptapAudio],
      content: markdownToTiptap(md),
    });
    const out = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    expect(out).toContain('data-squisq-video-fx="loudness:-16" data-squisq-video-cuts="1-2"');
    expect(out).toContain('data-squisq-audio-gain="-3"');
  });
});

describe('embedded media schedule', () => {
  it('honors cuts, gain and fades on a body-embedded audio tag', () => {
    const md =
      '# One {[duration=30]}\n\n' +
      '<audio src="a.webm" controls data-squisq-audio-clip-end="20"' +
      ' data-squisq-audio-cuts="5-8" data-squisq-audio-gain="-6" data-squisq-audio-fade-in="1"></audio>\n';
    const doc = markdownToDoc(parseMarkdown(md), { articleId: 't' });
    const schedule = collectEmbeddedMediaSchedule(doc);
    expect(schedule.map((c) => [c.absoluteStart, c.absoluteEnd, c.sourceIn])).toEqual([
      [0, 5, 0],
      [5, 17, 8],
    ]);
    expect(schedule.map((c) => c.gain)).toEqual([-6, -6]);
    expect(schedule[0].fadeIn).toBe(1);
    expect(schedule[1].fadeIn).toBeUndefined();
  });
});
