import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { computeAudioTimeline } from '../audioTimeline';

/**
 * A video laid out in a slide (a `<video>` tag in its body) is not a
 * scheduled clip, so the export mix reads its recipe off the video layer.
 */

function docWith(attributes: string) {
  return markdownToDoc(
    parseMarkdown(
      `# Camera\n\n<video src="video/camera.webm" controls data-squisq-video-clip-end="30" ${attributes}></video>`,
    ),
    { generateCoverBlock: false },
  );
}

describe('export sound of a body video', () => {
  it('carries the clip’s gain and its fades at the two ends', () => {
    const doc = docWith(
      'data-squisq-video-gain="-3" data-squisq-video-fade-in="1" data-squisq-video-fade-out="2"',
    );
    expect(computeAudioTimeline(doc)).toEqual([
      {
        src: 'video/camera.webm',
        startSec: 0,
        sourceInSec: 0,
        durationSec: 30,
        sourceKind: 'video',
        gainDb: -3,
        fadeInSec: 1,
        fadeOutSec: 2,
      },
    ]);
  });

  it('puts the fades at the ends of the PLAYED clip and de-clicks the joins', () => {
    const doc = docWith(
      'data-squisq-video-cuts="10-20" data-squisq-video-fade-in="1" data-squisq-video-fade-out="2"',
    );
    expect(computeAudioTimeline(doc)).toEqual([
      {
        src: 'video/camera.webm',
        startSec: 0,
        sourceInSec: 0,
        durationSec: 10,
        sourceKind: 'video',
        fadeInSec: 1,
        fadeOutSec: 0.01,
      },
      {
        src: 'video/camera.webm',
        startSec: 10,
        sourceInSec: 20,
        durationSec: 10,
        sourceKind: 'video',
        fadeInSec: 0.01,
        fadeOutSec: 2,
      },
    ]);
  });

  it('mixes the processed render in place of the video’s own sound', () => {
    const doc = docWith('data-squisq-video-fx="loudness:-16" data-squisq-video-cuts="10-20"');
    const asked: string[] = [];
    const timeline = computeAudioTimeline(doc, 0, {
      processedAudio: (clip) => {
        asked.push(`${clip.src} ${clip.edits?.fx?.ops.map((op) => op.id).join(',')}`);
        return '.mediaEdits/camera.0123456789ab.webm';
      },
    });
    expect(asked).toEqual(['video/camera.webm loudness']);
    // The render shares the source's clock, so the same ranges are kept — and
    // it is an audio file, so it is not marked as a possibly silent video.
    expect(timeline).toEqual([
      {
        src: '.mediaEdits/camera.0123456789ab.webm',
        startSec: 0,
        sourceInSec: 0,
        durationSec: 10,
        fadeOutSec: 0.01,
      },
      {
        src: '.mediaEdits/camera.0123456789ab.webm',
        startSec: 10,
        sourceInSec: 20,
        durationSec: 10,
        fadeInSec: 0.01,
      },
    ]);
  });

  it('keeps the video’s own sound when no render exists yet', () => {
    const doc = docWith('data-squisq-video-fx="loudness:-16"');
    const [clip] = computeAudioTimeline(doc, 0, { processedAudio: () => undefined });
    expect(clip).toMatchObject({ src: 'video/camera.webm', sourceKind: 'video' });
  });
});
