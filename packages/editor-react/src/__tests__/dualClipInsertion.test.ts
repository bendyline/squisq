import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { resolveMediaSchedule, getDocPlaybackDuration } from '@bendyline/squisq/schemas';
import { buildDualClipInsertion } from '../recorder/dualClipInsertion';
import type { RecorderSaveResult } from '../recorder/RecorderModal';

/**
 * The screen+camera save produces two scheduled clips: a full-frame screen
 * overlay and a camera picture-in-picture bubble. This locks the exact emitted
 * markup (attribute presence/omission by skew sign) AND proves it round-trips
 * through core into two document-anchored `MediaClip`s with the right windows.
 */

function dualResult(offsetSec: number, screenDur = 12.4): RecorderSaveResult {
  return {
    source: 'screen+camera',
    mediaKind: 'video',
    relativePath: 'video/screen-20260721-101500.webm',
    filename: 'screen-20260721-101500.webm',
    mimeType: 'video/webm',
    duration: screenDur,
    hasTimingSidecar: false,
    camera: {
      relativePath: 'video/camera-20260721-101500.webm',
      filename: 'camera-20260721-101500.webm',
      mimeType: 'video/webm',
      duration: Math.max(0, screenDur - offsetSec),
      offsetSec,
    },
  };
}

describe('buildDualClipInsertion — emitted markup', () => {
  it('returns null for a non-dual result', () => {
    const single: RecorderSaveResult = {
      relativePath: 'video/clip.webm',
      filename: 'clip.webm',
      source: 'screen',
      mediaKind: 'video',
      mimeType: 'video/webm',
      duration: 5,
      hasTimingSidecar: false,
    };
    expect(buildDualClipInsertion(single)).toBeNull();
  });

  it('omits start-at and clip-start when the skew is negligible', () => {
    const dual = buildDualClipInsertion(dualResult(0))!;
    expect(dual.screenTag).toBe(
      '<video src="video/screen-20260721-101500.webm" controls width="480"' +
        ' data-squisq-video-placement="overlay"' +
        ' data-squisq-video-lock-to-block="false"' +
        ' data-squisq-video-clip-end="12.4"></video>',
    );
    expect(dual.cameraTag).toBe(
      '<video src="video/camera-20260721-101500.webm" controls width="240"' +
        ' data-squisq-video-placement="picture-in-picture"' +
        ' data-squisq-video-lock-to-block="false"' +
        ' data-squisq-video-clip-end="12.4"></video>',
    );
    expect(dual.cameraTag).not.toContain('data-squisq-video-start-at');
    expect(dual.cameraTag).not.toContain('data-squisq-video-clip-start');
    expect(dual.cameraAttrs.startAt).toBeUndefined();
    expect(dual.cameraAttrs.clipStart).toBeUndefined();
  });

  it('emits start-at when the camera started after the screen', () => {
    const dual = buildDualClipInsertion(dualResult(0.42))!;
    expect(dual.cameraTag).toContain('data-squisq-video-start-at="0.42"');
    expect(dual.cameraTag).not.toContain('data-squisq-video-clip-start');
    expect(dual.cameraTag).toContain('data-squisq-video-clip-end="11.98"');
    expect(dual.cameraAttrs.startAt).toBe(0.42);
  });

  it('emits clip-start when the camera started before the screen', () => {
    const dual = buildDualClipInsertion(dualResult(-0.3))!;
    expect(dual.cameraTag).toContain('data-squisq-video-clip-start="0.3"');
    expect(dual.cameraTag).not.toContain('data-squisq-video-start-at');
    // duration − (−0.3) = 12.7
    expect(dual.cameraTag).toContain('data-squisq-video-clip-end="12.7"');
    expect(dual.cameraAttrs.clipStart).toBe(0.3);
    expect(dual.cameraAttrs.startAt).toBeUndefined();
  });
});

describe('buildDualClipInsertion — round-trips into two scheduled clips', () => {
  it('parses back to overlay + picture-in-picture document clips with aligned windows', () => {
    const dual = buildDualClipInsertion(dualResult(0.42))!;
    const markdown = `# Demo\n\n${dual.screenTag}\n\n${dual.cameraTag}\n`;
    const doc = markdownToDoc(parseMarkdown(markdown));

    expect(doc.documentMedia).toHaveLength(2);
    const [screen, camera] = doc.documentMedia!;

    expect(screen.kind).toBe('video');
    expect(screen.placement).toBe('overlay');
    expect(screen.anchor).toBe('document');
    expect(screen.lockToBlock).toBe(false);
    expect(screen.startAt).toBe(0);
    expect(screen.clipEnd).toBe(12.4);

    expect(camera.placement).toBe('picture-in-picture');
    expect(camera.anchor).toBe('document');
    expect(camera.startAt).toBe(0.42);
    expect(camera.clipEnd).toBe(11.98);

    const schedule = resolveMediaSchedule(doc);
    const screenClip = schedule.find((c) => c.src === screen.src)!;
    const cameraClip = schedule.find((c) => c.src === camera.src)!;
    expect(screenClip.absoluteStart).toBe(0);
    expect(screenClip.absoluteEnd).toBeCloseTo(12.4, 5);
    expect(cameraClip.absoluteStart).toBeCloseTo(0.42, 5);
    expect(cameraClip.absoluteEnd).toBeCloseTo(12.4, 5);

    // The pair extends the timeline even in an otherwise text-only doc.
    expect(getDocPlaybackDuration(doc)).toBeGreaterThanOrEqual(12.4);
  });
});
