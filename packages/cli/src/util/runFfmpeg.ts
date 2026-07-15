import { execFile, type ExecFileException } from 'node:child_process';

export interface RunFfmpegOptions {
  timeoutMs: number;
  failureMessage: string;
  signal?: AbortSignal;
}

/**
 * Banner/progress noise FFmpeg always writes to stderr. None of it explains a
 * failure, and the real diagnostic is usually the line just before the generic
 * "Error while opening encoder…" trailer.
 */
const FFMPEG_NOISE =
  /^(?:ffmpeg version |\s{2}(?:built with|configuration:|lib[a-z0-9]+\s+\d)|frame=|size=|video:|Press \[q\]|\s*Stream mapping:|\s*Metadata:|\s*Duration:|Input #|Output #|\s{4})/;

/** Lines that name an actual problem, preferred over the last line of output. */
const FFMPEG_ERRORISH =
  /error|invalid|failed|not divisible|no such file|permission denied|unable to|unrecognized|does not contain|conversion failed/i;

/**
 * Reduce buffered FFmpeg stderr to the single most useful line.
 *
 * Picks the FIRST error-ish line, not the last. FFmpeg reports the root cause
 * and then cascades: `width not divisible by 2` → `Error while opening
 * encoder…` → `Conversion failed!`. The last line is always the least
 * informative of the three.
 *
 * Also strips the heap addresses FFmpeg stamps into component tags
 * (`[libx264 @ 0x55d3…]` → `[libx264]`) since they are noise in an error
 * message and make output non-deterministic across runs.
 */
export function lastMeaningfulFfmpegLine(stderr: string): string | null {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/ @ 0x[0-9a-f]+/gi, '').trimEnd())
    .filter((line) => line.trim().length > 0 && !FFMPEG_NOISE.test(line));
  if (lines.length === 0) return null;
  const errorish = lines.find((line) => FFMPEG_ERRORISH.test(line));
  return (errorish ?? lines[lines.length - 1]).trim();
}

/**
 * Turn an `execFile` failure into one concise, actionable sentence.
 *
 * `err.message` is deliberately NOT used: execFile prefixes it with
 * "Command failed: <the entire command line>" and then appends the whole
 * stderr buffer, so surfacing it printed dozens of temp-file arguments under an
 * `Error:` heading and buried the one line that said what went wrong.
 */
export function describeFfmpegFailure(
  err: ExecFileException,
  stderr: string,
  timeoutMs: number,
): string {
  if (err.code === 'ENOENT') {
    return 'the ffmpeg binary could not be started (ENOENT). Run `squisq doctor` to check your FFmpeg installation.';
  }
  const detail = lastMeaningfulFfmpegLine(stderr);
  if (err.killed) {
    const seconds = Math.round(timeoutMs / 1000);
    return `it timed out after ${seconds}s${detail ? ` (last output: ${detail})` : ''}.`;
  }
  const exit = typeof err.code === 'number' ? ` (exit code ${err.code})` : '';
  return detail ? `${detail}${exit}` : `ffmpeg exited unsuccessfully${exit}.`;
}

/** Run one bounded FFmpeg-style child process while preserving caller cancellation. */
export async function runFfmpeg(
  command: string,
  args: readonly string[],
  options: RunFfmpegOptions,
): Promise<void> {
  options.signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    execFile(
      command,
      [...args],
      { timeout: options.timeoutMs, signal: options.signal },
      (err, _stdout, stderr) => {
        if (options.signal?.aborted) {
          reject(options.signal.reason);
        } else if (err) {
          reject(
            new Error(
              `${options.failureMessage}: ${describeFfmpegFailure(err, stderr ?? '', options.timeoutMs)}`,
            ),
          );
        } else {
          resolve();
        }
      },
    );
  });
  options.signal?.throwIfAborted();
}
