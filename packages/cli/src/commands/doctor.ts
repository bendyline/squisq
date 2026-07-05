/**
 * doctor command
 *
 * Environment preflight for video rendering. Reports:
 * - ffmpeg: path, version, and which source found it (env / path /
 *   ffmpeg-static), or an actionable install hint when missing
 * - Playwright Chromium: attempts a headless launch + immediate close
 * - Node version
 *
 * Exit code: 0 when everything `squisq video` needs is present, 1 otherwise.
 *
 * Usage:
 *   squisq doctor
 */

import type { Command } from 'commander';
import { detectFfmpegDetailed, getFfmpegVersion } from '../util/detectFfmpeg.js';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check that ffmpeg and Playwright Chromium are available for video rendering')
    .action(async () => {
      const allPresent = await runDoctor();
      process.exitCode = allPresent ? 0 : 1;
    });
}

async function runDoctor(): Promise<boolean> {
  let allPresent = true;

  // ── Node ─────────────────────────────────────────────────────────
  console.error(`Node:     ${process.version}`);

  // ── ffmpeg ───────────────────────────────────────────────────────
  try {
    const detection = await detectFfmpegDetailed();
    if (detection) {
      const version = await getFfmpegVersion(detection.path);
      console.error(
        `ffmpeg:   ${detection.path} (source: ${detection.source}) — ${version ?? 'version unknown'}`,
      );
    } else {
      allPresent = false;
      console.error('ffmpeg:   not found.');
      console.error('          Install it with:');
      console.error('            macOS:   brew install ffmpeg');
      console.error('            Ubuntu:  sudo apt install ffmpeg');
      console.error('            Windows: winget install ffmpeg');
      console.error('          Or: npm install ffmpeg-static, or set SQUISQ_FFMPEG.');
    }
  } catch (err: unknown) {
    // detectFfmpegDetailed throws when SQUISQ_FFMPEG is set but broken
    allPresent = false;
    console.error(`ffmpeg:   ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Playwright Chromium ──────────────────────────────────────────
  try {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    console.error(`Chromium: available (${chromium.executablePath()})`);
  } catch (err: unknown) {
    allPresent = false;
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.error(`Chromium: not available — ${detail}`);
    console.error('          Run: npx playwright install chromium');
  }

  console.error(allPresent ? '\n✓ All checks passed' : '\n✗ Some checks failed');
  return allPresent;
}
