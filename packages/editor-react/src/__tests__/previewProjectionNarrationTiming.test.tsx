/**
 * @vitest-environment jsdom
 *
 * The runtime half of the presenter-advance path: a document-anchored take's
 * `.timing.json` sidecar must reach the PROJECTION the preview renders, not
 * just the container.
 *
 * `usePreviewProjection` only resolves audio when it is given a
 * `ContentContainer` — a host that wires a `MediaProvider` alone silently skips
 * `applyNarrationTiming`, and the block timings never change. This pins both
 * halves of that: with a container the sidecar is applied, without one the
 * projection falls back to reading-time estimates.
 */
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc, flattenRenderableBlocks } from '@bendyline/squisq/doc';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  buildAdvanceTimingJson,
  recordSlideShown,
  EMPTY_ADVANCE_LOG,
} from '@bendyline/squisq/narration';
import type { SlideAdvanceLog } from '@bendyline/squisq/narration';
import { usePreviewProjection } from '../usePreviewProjection';

const VIDEO = 'video/camera-audio-20260829-154137.webm';
const TAKE_SEC = 20.2;

const MD = `# About SquigglySquare {[title]}

<video src="${VIDEO}" controls width="480" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-clip-end="${TAKE_SEC}"></video>

Squisq turns plain Markdown into designed documents.

## The Philosophy {[sectionHeader colorScheme=blue]}

Author in the Markdown you already know.

## One Document, Three Views {[list colorScheme=teal]}

- Raw
- Editor
- Play
`;

const doc = markdownToDoc(parseMarkdown(MD));

/** The sidecar a slides-mode take writes: advances at 0s, 6s and 13s. */
function sidecarBytes(): Uint8Array {
  const ids = flattenRenderableBlocks(doc.blocks).map((block) => block.id);
  let log: SlideAdvanceLog = EMPTY_ADVANCE_LOG;
  [0, 6000, 13_000].forEach((atMs, i) => {
    log = recordSlideShown(log, ids[i], atMs);
  });
  return new TextEncoder().encode(JSON.stringify(buildAdvanceTimingJson(doc, log, TAKE_SEC)));
}

async function containerWithSidecar(): Promise<MemoryContentContainer> {
  const container = new MemoryContentContainer();
  await container.writeFile(VIDEO, new Uint8Array([1, 2, 3]), 'video/webm');
  await container.writeFile(`${VIDEO}.timing.json`, sidecarBytes(), 'application/json');
  return container;
}

function timings(blocks: Array<{ startTime: number; duration: number }>) {
  return blocks.map((block) => [block.startTime, block.duration]);
}

describe('usePreviewProjection — presenter-advance timings', () => {
  it('re-times the player doc from the sidecar when a container is wired', async () => {
    const container = await containerWithSidecar();
    const { result } = renderHook(() => usePreviewProjection(doc, '', container));

    await waitFor(() => {
      expect(result.current?.playerDoc.blocks[0].duration).toBe(6);
    });

    expect(timings(result.current!.playerDoc.blocks.slice(0, 3))).toEqual([
      [0, 6],
      [6, 7],
      [13, 7.199999999999999],
    ]);
  });

  it('leaves the reading-time estimate in place when the host wires no container', async () => {
    const { result } = renderHook(() => usePreviewProjection(doc, '', null));

    await waitFor(() => expect(result.current).not.toBeNull());
    // Whatever the estimate is, it is NOT the take's observed 0/6/13 layout.
    expect(timings(result.current!.playerDoc.blocks.slice(0, 3))).not.toEqual([
      [0, 6],
      [6, 7],
      [13, 7.199999999999999],
    ]);
  });
});
