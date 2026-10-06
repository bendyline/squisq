/**
 * Frame sink tests: the pure ffmpeg argument builder, the streaming pipe sink
 * against a fake encoder that counts PNG signatures on stdin, and the spool
 * directory's manifest/resume behaviour.
 */
import { after, before, describe, it } from 'mocha';
import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@bendyline/squisq/schemas';
import {
  createFfmpegPipeSink,
  docRenderHash,
  ffmpegPipeArgs,
  openDirectoryFrameStore,
  type FrameManifest,
} from '../util/frameSink.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A PNG signature followed by random payload. The payload is masked to 7-bit
 * bytes so it can never contain 0x89 — otherwise the fake encoder's signature
 * scan finds a spurious match in ~31 MB of random bytes about 1 run in 140.
 */
function fakePngFrame(bytes = 64 * 1024): Uint8Array {
  const payload = randomBytes(bytes);
  for (let i = 0; i < payload.length; i += 1) payload[i] &= 0x7f;
  return Buffer.concat([PNG_SIGNATURE, payload]);
}

/**
 * A stand-in for ffmpeg: counts PNG signatures arriving on stdin, echoes
 * progress to stderr, and writes the count to the output path (last argument)
 * when stdin ends. FAKE_FFMPEG_EXIT forces a non-zero exit code.
 */
const FAKE_FFMPEG = `#!${process.execPath}
const fs = require('fs');
const out = process.argv[process.argv.length - 1];
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
let carry = Buffer.alloc(0);
let count = 0;
process.stdin.on('data', (chunk) => {
  const buf = Buffer.concat([carry, chunk]);
  let i = 0;
  while ((i = buf.indexOf(sig, i)) !== -1) { count += 1; i += sig.length; }
  carry = buf.subarray(Math.max(0, buf.length - (sig.length - 1)));
  process.stderr.write('frame=' + count + '\\n');
});
process.stdin.on('end', () => {
  fs.writeFileSync(out, String(count));
  if (process.env.FAKE_FFMPEG_EXIT) {
    process.stderr.write('Conversion failed!\\n');
    process.exit(Number(process.env.FAKE_FFMPEG_EXIT));
  }
  process.exit(0);
});
`;

describe('ffmpegPipeArgs', () => {
  const base = {
    outputPath: '/tmp/out.mp4',
    fps: 30,
    width: 1920,
    height: 1080,
    quality: 'normal' as const,
    captureFormat: 'png' as const,
    audioPath: null,
  };

  it('reads stills from stdin and writes a faststart H.264 file', () => {
    const args = ffmpegPipeArgs(base);
    expect(args.slice(0, 2)).to.deep.equal(['-y', '-f']);
    expect(args).to.include('image2pipe');
    expect(args).to.include('pipe:0');
    expect(args[args.indexOf('-c:v') + 1]).to.equal('png');
    expect(args).to.include('libx264');
    expect(args).to.include('yuv420p');
    expect(args[args.indexOf('-movflags') + 1]).to.equal('+faststart');
    expect(args[args.length - 1]).to.equal('/tmp/out.mp4');
    expect(args).to.not.include('-af');
    expect(args[args.indexOf('-vf') + 1]).to.not.include('in_range');
  });

  it('decodes JPEG captures with mjpeg and muxes AAC audio when an audio file is given', () => {
    const args = ffmpegPipeArgs({ ...base, captureFormat: 'jpeg', audioPath: '/tmp/mix.mp3' });
    expect(args[args.indexOf('-c:v') + 1]).to.equal('mjpeg');
    // Full-range JPEG input is converted to limited-range yuv420p, never tagged yuvj420p.
    expect(args[args.indexOf('-vf') + 1]).to.include('in_range=pc:out_range=tv');
    expect(args[args.indexOf('-color_range') + 1]).to.equal('tv');
    expect(args).to.include('/tmp/mix.mp3');
    expect(args).to.include('aac');
    expect(args).to.include('apad');
    expect(args).to.include('-shortest');
  });
});

describe('createFfmpegPipeSink', function () {
  this.timeout(30_000);
  let dir: string;
  let fakeFfmpeg: string;

  before(async function () {
    if (process.platform === 'win32') this.skip();
    dir = await mkdtemp(join(tmpdir(), 'squisq-frame-sink-'));
    fakeFfmpeg = join(dir, 'fake-ffmpeg.js');
    await writeFile(fakeFfmpeg, FAKE_FFMPEG);
    await chmod(fakeFfmpeg, 0o755);
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const sinkOptions = (outputPath: string, signal?: AbortSignal) => ({
    ffmpegPath: fakeFfmpeg,
    outputPath,
    fps: 10,
    width: 320,
    height: 180,
    quality: 'normal' as const,
    captureFormat: 'png' as const,
    audioPath: null,
    signal,
  });

  it('streams every frame (repeats included) through stdin with backpressure', async () => {
    const outputPath = join(dir, 'count.txt');
    const sink = createFfmpegPipeSink(sinkOptions(outputPath));
    await sink.write(fakePngFrame(), 4); // cover pre-roll: one still, four frames
    for (let i = 0; i < 120; i += 1) await sink.write(fakePngFrame(256 * 1024));
    await sink.finish();
    expect(sink.frameCount).to.equal(124);
    expect(await readFile(outputPath, 'utf8')).to.equal('124');
  });

  it('reports the encoder failure with its last meaningful line', async () => {
    const outputPath = join(dir, 'failed.txt');
    const previous = process.env.FAKE_FFMPEG_EXIT;
    process.env.FAKE_FFMPEG_EXIT = '1';
    try {
      const sink = createFfmpegPipeSink(sinkOptions(outputPath));
      await sink.write(fakePngFrame());
      let message = '';
      try {
        await sink.finish();
      } catch (err: unknown) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).to.include('ffmpeg failed');
      expect(message).to.include('exit code 1');
      expect(message).to.include('Conversion failed!');
    } finally {
      if (previous === undefined) delete process.env.FAKE_FFMPEG_EXIT;
      else process.env.FAKE_FFMPEG_EXIT = previous;
    }
  });

  it('terminates the encoder on abort and refuses further writes', async () => {
    const outputPath = join(dir, 'aborted.txt');
    const controller = new AbortController();
    const sink = createFfmpegPipeSink(sinkOptions(outputPath, controller.signal));
    await sink.write(fakePngFrame());
    controller.abort(new Error('stop rendering'));
    await sink.abort();
    let rejected: unknown;
    try {
      await sink.write(fakePngFrame());
    } catch (err: unknown) {
      rejected = err;
    }
    expect(rejected).to.be.instanceOf(Error);
    expect((rejected as Error).message).to.equal('stop rendering');
  });
});

describe('openDirectoryFrameStore', () => {
  let dir: string;
  const manifest: FrameManifest = {
    generatedBy: 'squisq-cli',
    docHash: 'abc',
    fps: 30,
    width: 1920,
    height: 1080,
    captionStyle: null,
    animationsEnabled: true,
    coverPreRoll: 2,
    captureFormat: 'png',
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'squisq-frame-store-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a manifest, then offers matching frames back on resume', async () => {
    const first = await openDirectoryFrameStore(dir, manifest, false);
    expect(first.reusable).to.equal(false);
    const frame = fakePngFrame(1024);
    await first.write(0, frame);
    await first.write(7, fakePngFrame(1024));
    expect(first.path(7).endsWith('frame-000007.png')).to.equal(true);
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).to.deep.equal(manifest);

    const resumed = await openDirectoryFrameStore(dir, manifest, true);
    expect(resumed.reusable).to.equal(true);
    expect(await resumed.has(0)).to.equal(true);
    expect(await resumed.has(3)).to.equal(false);
    expect(Buffer.from(await resumed.read(0)).equals(Buffer.from(frame))).to.equal(true);
  });

  it('does not reuse a spool whose manifest differs, and replaces the manifest', async () => {
    const changed = { ...manifest, fps: 24 };
    const store = await openDirectoryFrameStore(dir, changed, true);
    expect(store.reusable).to.equal(false);
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).fps).to.equal(24);
    const withoutResume = await openDirectoryFrameStore(dir, changed, false);
    expect(withoutResume.reusable).to.equal(false);
  });

  it('hashes the doc content stably', () => {
    const doc: Doc = { articleId: 'a', duration: 1, blocks: [], audio: { segments: [] } };
    expect(docRenderHash(doc)).to.equal(docRenderHash({ ...doc }));
    expect(docRenderHash(doc)).to.not.equal(docRenderHash({ ...doc, duration: 2 }));
  });
});
