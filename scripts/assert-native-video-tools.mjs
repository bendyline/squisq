import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ffmpeg = process.env.SQUISQ_FFMPEG || 'ffmpeg';

async function output(args) {
  try {
    const result = await run(ffmpeg, args, { maxBuffer: 16 * 1024 * 1024 });
    return `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to run ${ffmpeg} ${args.join(' ')}: ${detail}`);
  }
}

await output(['-version']);
const encoders = await output(['-hide_banner', '-encoders']);
const filters = await output(['-hide_banner', '-filters']);

const missing = [];
if (!/\b(?:libx264|h264_[a-z0-9_]+|h264)\b/i.test(encoders)) missing.push('H.264 encoder');
if (!/^\s*[A-Z.]{6}\s+aac\s/im.test(encoders)) missing.push('AAC encoder');
if (!/^\s*[A-Z.]{3}\s+palettegen\s/im.test(filters)) missing.push('palettegen filter');
if (!/^\s*[A-Z.]{3}\s+paletteuse\s/im.test(filters)) missing.push('paletteuse filter');

if (missing.length > 0) {
  throw new Error(`FFmpeg is present but lacks: ${missing.join(', ')}`);
}

console.log('FFmpeg native MP4/GIF capabilities are available.');
