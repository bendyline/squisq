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

/** Injectable process/browser boundary used to test every diagnostic branch. */
export interface DoctorRuntime {
  nodeVersion: string;
  detectFfmpeg: typeof detectFfmpegDetailed;
  getFfmpegVersion: typeof getFfmpegVersion;
  launchChromium: () => Promise<{
    executablePath: string;
    close: () => Promise<void>;
  }>;
  log: (line: string) => void;
}

const defaultDoctorRuntime: DoctorRuntime = {
  nodeVersion: process.version,
  detectFfmpeg: detectFfmpegDetailed,
  getFfmpegVersion,
  async launchChromium() {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true });
    return {
      executablePath: chromium.executablePath(),
      close: () => browser.close(),
    };
  },
  log: (line) => console.error(line),
};

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(
      'Check that ffmpeg and Playwright Chromium are available for video/image rendering',
    )
    .action(async () => {
      const allPresent = await runDoctor();
      process.exitCode = allPresent ? 0 : 1;
    });
}

export async function runDoctor(runtime: DoctorRuntime = defaultDoctorRuntime): Promise<boolean> {
  let ffmpegOk = true;
  let chromiumOk = true;

  // ── Node ─────────────────────────────────────────────────────────
  runtime.log(`Node:     ${runtime.nodeVersion}`);

  // ── ffmpeg ───────────────────────────────────────────────────────
  try {
    const detection = await runtime.detectFfmpeg();
    if (detection) {
      const version = await runtime.getFfmpegVersion(detection.path);
      runtime.log(
        `ffmpeg:   ${detection.path} (source: ${detection.source}) — ${version ?? 'version unknown'}`,
      );
    } else {
      ffmpegOk = false;
      runtime.log('ffmpeg:   not found.');
      runtime.log('          Install it with:');
      runtime.log('            macOS:   brew install ffmpeg');
      runtime.log('            Ubuntu:  sudo apt install ffmpeg');
      runtime.log('            Windows: winget install ffmpeg');
      runtime.log('          Or: npm install ffmpeg-static, or set SQUISQ_FFMPEG.');
    }
  } catch (err: unknown) {
    // detectFfmpegDetailed throws when SQUISQ_FFMPEG is set but broken
    ffmpegOk = false;
    runtime.log(`ffmpeg:   ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Playwright Chromium ──────────────────────────────────────────
  try {
    const browser = await runtime.launchChromium();
    await browser.close();
    runtime.log(`Chromium: available (${browser.executablePath})`);
  } catch (err: unknown) {
    chromiumOk = false;
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    runtime.log(`Chromium: not available — ${detail}`);
    runtime.log('          Run: npx playwright install chromium');
  }

  // ── Feature readiness ────────────────────────────────────────────
  // Video/GIF need both tools; the dashboard PNG image needs Chromium only.
  runtime.log(`video/gif (ffmpeg + Chromium): ${ffmpegOk && chromiumOk ? 'ready' : 'not ready'}`);
  runtime.log(`image PNG (Chromium only):     ${chromiumOk ? 'ready' : 'not ready'}`);

  const allPresent = ffmpegOk && chromiumOk;
  runtime.log(allPresent ? '\n✓ All checks passed' : '\n✗ Some checks failed');
  return allPresent;
}
