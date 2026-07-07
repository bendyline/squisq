/**
 * detectFfmpeg
 *
 * Locates a native ffmpeg binary. Resolution order:
 * 1. `SQUISQ_FFMPEG` environment variable — verified by running
 *    `<path> -version`. A value that is set but broken is a hard error
 *    (never silently ignored), so misconfiguration surfaces immediately.
 * 2. System PATH lookup (`which` on macOS/Linux, `where` on Windows).
 * 3. The optional `ffmpeg-static` npm package, when the user has installed
 *    it themselves. It is deliberately NOT a dependency of the CLI — the
 *    import is opportunistic and falls through cleanly when absent.
 */

import { execFile } from 'node:child_process';

/** Where a detected ffmpeg binary came from. */
export type FfmpegSource = 'env' | 'path' | 'ffmpeg-static';

/** A successfully detected ffmpeg binary. */
export interface FfmpegDetection {
  /** Absolute path to the ffmpeg binary. */
  path: string;
  /** Which resolution step found it. */
  source: FfmpegSource;
}

/** Run a command and resolve with trimmed stdout, or null on any failure. */
function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Run `<path> -version` and return the first line of output
 * (e.g. "ffmpeg version 7.1 ..."), or null when the binary fails to run.
 */
export async function getFfmpegVersion(path: string): Promise<string | null> {
  const out = await run(path, ['-version']);
  return out ? out.split('\n')[0].trim() : null;
}

/**
 * Detect ffmpeg and report which source found it (see module doc for the
 * resolution order). Returns null when no working binary is found.
 *
 * @throws Error when `SQUISQ_FFMPEG` is set but the binary does not run —
 *   an explicit override must never be silently ignored.
 */
export async function detectFfmpegDetailed(): Promise<FfmpegDetection | null> {
  // 1. Explicit override
  const envPath = process.env.SQUISQ_FFMPEG;
  if (envPath) {
    const version = await getFfmpegVersion(envPath);
    if (!version) {
      throw new Error(
        `SQUISQ_FFMPEG is set to "${envPath}" but running "${envPath} -version" failed. ` +
          'Fix the path or unset SQUISQ_FFMPEG.',
      );
    }
    return { path: envPath, source: 'env' };
  }

  // 2. System PATH
  const command = process.platform === 'win32' ? 'where' : 'which';
  const found = await run(command, ['ffmpeg']);
  if (found) {
    // `which` and `where` can return multiple lines; take the first
    return { path: found.split('\n')[0].trim(), source: 'path' };
  }

  // 3. Optional ffmpeg-static package. The specifier is a variable so
  // bundlers/TypeScript don't try to resolve a package we don't depend on.
  try {
    const specifier = 'ffmpeg-static';
    const mod = (await import(specifier)) as { default?: unknown } | string;
    // CJS default export shape (`module.exports = path`) surfaces as
    // `mod.default`; some build setups expose the string directly.
    const candidate =
      typeof mod === 'string' ? mod : typeof mod.default === 'string' ? mod.default : null;
    if (candidate) {
      return { path: candidate, source: 'ffmpeg-static' };
    }
  } catch {
    // Not installed — fall through.
  }

  return null;
}

/**
 * Detect whether native ffmpeg is available (SQUISQ_FFMPEG, PATH, or an
 * installed `ffmpeg-static` package).
 *
 * @returns Absolute path to ffmpeg binary, or null if not found
 * @throws Error when `SQUISQ_FFMPEG` is set but broken
 */
export async function detectFfmpeg(): Promise<string | null> {
  const detection = await detectFfmpegDetailed();
  return detection?.path ?? null;
}
