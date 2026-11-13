import { describe, expect, it, vi } from 'vitest';
import { mediaBakeKey } from '@bendyline/squisq/mediaEdit';
import type { MediaClip } from '@bendyline/squisq/schemas';
import type { MediaEditRenderManager } from '@bendyline/squisq-video-react/media-edit';
import { bakeMarkdownMedia } from '../mediaEdit/bakedMarkdown';
import { setMediaClipInSource } from '../timelineSource';

/** A manager whose `bake` names files the way the real store does. */
function bakingManager(
  extension: Record<'audio' | 'video', string> = { audio: 'm4a', video: 'mp4' },
) {
  const bake = vi.fn(async (clip: MediaClip, options?: { onProgress?: (f: number) => void }) => {
    options?.onProgress?.(0.5);
    options?.onProgress?.(1);
    const stem = clip.src
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '');
    return `notes_files/.mediaEdits/${stem}.${mediaBakeKey(clip)}.baked.${extension[clip.kind]}`;
  });
  return { manager: { bake } as unknown as MediaEditRenderManager, bake };
}

const DOC = [
  '{[audio src=notes_files/audio/take.webm anchor=document clipStart=1 clipEnd=20 cuts="2-3 6-8" gain=-3 group=rec-a]}',
  '',
  '# One',
  '',
  'Body text.',
  '',
  '<video src="notes_files/video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-clip-start="0.5" data-squisq-video-crop="0.1 0 0.8 1" data-squisq-video-group="rec-a"></video>',
  '',
  '<audio src="notes_files/audio/plain.webm" controls></audio>',
  '',
  '{[audio src=notes_files/audio/trimmed.webm clipStart=2 clipEnd=9]}',
  '',
].join('\n');

describe('bakeMarkdownMedia', () => {
  it('points each edited clip at its baked file and takes the recipe and trim off', async () => {
    const { manager, bake } = bakingManager();
    const result = await bakeMarkdownMedia(DOC, manager);
    const lines = result.markdown.split('\n');

    expect(bake).toHaveBeenCalledTimes(2);
    expect(result.failures).toEqual([]);
    expect(result.baked.map((b) => [b.sourceLine, b.kind, b.src])).toEqual([
      [1, 'audio', 'notes_files/audio/take.webm'],
      [7, 'video', 'notes_files/video/screen.webm'],
    ]);
    const [audio, video] = result.baked;
    expect(audio.reference).toBe(audio.path);
    expect(audio.path).toMatch(/^notes_files\/\.mediaEdits\/take\.[0-9a-f]{12}\.baked\.m4a$/);

    // The annotation keeps what still applies (its anchor); the rest is baked in.
    expect(lines[0]).toBe(`{[audio src=${audio.path} anchor=document]}`);
    expect(lines[6]).toBe(
      `<video src="${video.path}" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>`,
    );
    // Untouched: a clip with no recipe, and one with only a trim (a plain player honors that).
    expect(lines[8]).toBe('<audio src="notes_files/audio/plain.webm" controls></audio>');
    expect(lines[10]).toBe('{[audio src=notes_files/audio/trimmed.webm clipStart=2 clipEnd=9]}');
    expect(lines).toHaveLength(DOC.split('\n').length);
  });

  it('bakes the clip the document describes: trim, cuts and gain together', async () => {
    const { manager, bake } = bakingManager();
    await bakeMarkdownMedia(DOC, manager);
    expect(bake.mock.calls[0][0]).toMatchObject({
      src: 'notes_files/audio/take.webm',
      kind: 'audio',
      clipStart: 1,
      clipEnd: 20,
      edits: {
        cuts: [
          { start: 2, end: 3 },
          { start: 6, end: 8 },
        ],
        gain: -3,
      },
    });
    expect(bake.mock.calls[1][0]).toMatchObject({
      src: 'notes_files/video/screen.webm',
      kind: 'video',
      clipStart: 0.5,
      edits: { crop: { x: 0.1, y: 0, w: 0.8, h: 1 } },
    });
  });

  it('can refer to a visible copy beside the source, for exports that carry their own files', async () => {
    const { manager } = bakingManager();
    const result = await bakeMarkdownMedia(DOC, manager, { reference: 'copy' });
    expect(result.baked.map((b) => b.reference)).toEqual([
      'notes_files/audio/take-edited.m4a',
      'notes_files/video/screen-edited.mp4',
    ]);
    expect(result.baked[0].path).toContain('/.mediaEdits/');
    expect(result.markdown.split('\n')[0]).toBe(
      '{[audio src=notes_files/audio/take-edited.m4a anchor=document]}',
    );
  });

  it('gives two recipes over one source different copy names', async () => {
    const { manager } = bakingManager();
    const twice =
      '{[audio src=a/take.webm cuts=1-2]}\n\n# One\n\n{[audio src=a/take.webm cuts=3-4]}\n';
    const result = await bakeMarkdownMedia(twice, manager, { reference: 'copy' });
    expect(result.baked.map((b) => b.reference)).toEqual([
      'a/take-edited.m4a',
      'a/take-edited-2.m4a',
    ]);
  });

  it('reports progress across the clips', async () => {
    const { manager } = bakingManager();
    const seen: Array<[number, number, string]> = [];
    await bakeMarkdownMedia(DOC, manager, {
      onProgress: (fraction, clip) => seen.push([fraction, clip.index, clip.src]),
    });
    expect(seen.map(([fraction]) => fraction)).toEqual([0, 0.25, 0.5, 0.5, 0.75, 1, 1]);
    expect(seen[1]).toEqual([0.25, 0, 'notes_files/audio/take.webm']);
    expect(seen[4]).toEqual([0.75, 1, 'notes_files/video/screen.webm']);
  });

  it('leaves a clip that cannot be baked as it was, and says why', async () => {
    const { manager, bake } = bakingManager();
    bake.mockImplementationOnce(async () => {
      throw new Error('Audio cleanup failed: no audio track');
    });
    const result = await bakeMarkdownMedia(DOC, manager);
    expect(result.failures).toEqual([
      {
        src: 'notes_files/audio/take.webm',
        sourceLine: 1,
        error: 'Audio cleanup failed: no audio track',
      },
    ]);
    expect(result.markdown.split('\n')[0]).toBe(DOC.split('\n')[0]);
    // The other clip still bakes.
    expect(result.baked.map((b) => b.sourceLine)).toEqual([7]);
  });

  it('stops when cancelled', async () => {
    const { manager, bake } = bakingManager();
    const controller = new AbortController();
    bake.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    });
    await expect(
      bakeMarkdownMedia(DOC, manager, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(bake).toHaveBeenCalledTimes(1);
  });

  it('returns the source unchanged when nothing needs baking', async () => {
    const { manager, bake } = bakingManager();
    const plain = '# One\n\n<audio src="a.webm" controls></audio>\n';
    expect(await bakeMarkdownMedia(plain, manager)).toEqual({
      markdown: plain,
      baked: [],
      failures: [],
    });
    expect(bake).not.toHaveBeenCalled();
  });
});

describe('setMediaClipInSource — src', () => {
  it('repoints an annotation and an HTML tag, leaving the rest alone', () => {
    expect(
      setMediaClipInSource('{[audio src="a b.webm" anchor=document gain=-3]}', 1, {
        src: 'c d.m4a',
      }),
    ).toBe('{[audio src="c d.m4a" anchor=document gain=-3]}');
    expect(
      setMediaClipInSource('<video src="a.webm" controls data-squisq-video-gain="-3"></video>', 1, {
        src: 'b.mp4',
      }),
    ).toBe('<video src="b.mp4" controls data-squisq-video-gain="-3"></video>');
  });
});
