/**
 * Self-skipping native Playwright + FFmpeg check that motion profiles change
 * captured frames deterministically: a vibrant render differs from a calm
 * one mid-entrance, and rendering the same profile twice yields identical
 * stills (the offline renderer seeks every keyframe animation and count-up).
 */
import { after, before, describe, it } from 'mocha';
import { expect } from 'chai';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc, MotionSpec } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { renderDocToMp4 } from '../api.js';
import { detectFfmpegDetailed } from '../util/detectFfmpeg.js';

async function chromiumAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/** A chart, a statistic and a comparison — every effect a profile switches on. */
function motionDoc(): Doc {
  return {
    articleId: 'motion-e2e',
    duration: 3,
    themeId: 'standard',
    blocks: [
      {
        template: 'barChart',
        id: 'bars',
        startTime: 0,
        duration: 1.5,
        audioSegment: 0,
        title: 'Rainfall',
        headers: ['Month', 'mm'],
        rows: [
          ['Jan', '120'],
          ['Feb', '80'],
          ['Mar', '40'],
        ],
        showValues: true,
      },
      {
        template: 'statHighlight',
        id: 'stat',
        startTime: 1.5,
        duration: 1.5,
        audioSegment: 0,
        stat: '73%',
        description: 'of the island is forest',
      },
    ] as unknown as Doc['blocks'],
    audio: { segments: [] },
  };
}

async function renderFrames(
  dir: string,
  label: string,
  motion: MotionSpec,
): Promise<Map<string, Buffer>> {
  const framesDir = join(dir, `frames-${label}`);
  await renderDocToMp4(motionDoc(), new MemoryContentContainer(), {
    outputPath: join(dir, `${label}.mp4`),
    fps: 5,
    width: 640,
    height: 360,
    quality: 'draft',
    captureFormat: 'png',
    frameTransport: 'pipe',
    framesDir,
    coverPreRoll: 0,
    motion,
  });
  const frames = new Map<string, Buffer>();
  for (const name of (await readdir(framesDir)).filter((n) => n.endsWith('.png')).sort()) {
    frames.set(name, await readFile(join(framesDir, name)));
  }
  return frames;
}

describe('motion profile e2e', function () {
  this.timeout(240_000);
  let dir: string;

  before(async function () {
    let hasFfmpeg = false;
    try {
      hasFfmpeg = (await detectFfmpegDetailed()) !== null;
    } catch {
      hasFfmpeg = false;
    }
    if (!hasFfmpeg || !(await chromiumAvailable())) {
      this.skip();
    }
    dir = await mkdtemp(join(tmpdir(), 'squisq-motion-e2e-'));
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('renders vibrant frames that differ from calm mid-entrance and repeat byte for byte', async () => {
    const calm = await renderFrames(dir, 'calm', 'calm');
    const vibrant = await renderFrames(dir, 'vibrant', 'vibrant');
    const again = await renderFrames(dir, 'vibrant-again', 'vibrant');
    expect(calm.size).to.be.greaterThan(10);
    expect(vibrant.size).to.equal(calm.size);

    const names = [...vibrant.keys()];
    // Frames 1–3 (0.2–0.6 s) sit inside the bar growth and the count-up.
    const early = names.slice(1, 4);
    const differing = early.filter((name) => !calm.get(name)!.equals(vibrant.get(name)!));
    expect(
      differing,
      `early frames that differ: ${differing.join(', ')}`,
    ).to.have.length.greaterThan(0);

    for (const name of names) {
      expect(again.get(name)!.equals(vibrant.get(name)!), `${name} is not deterministic`).to.equal(
        true,
      );
    }
  });
});
