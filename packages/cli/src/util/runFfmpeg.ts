import { execFile } from 'node:child_process';

export interface RunFfmpegOptions {
  timeoutMs: number;
  failureMessage: string;
  signal?: AbortSignal;
}

/** Run one bounded FFmpeg-style child process while preserving caller cancellation. */
export async function runFfmpeg(
  command: string,
  args: readonly string[],
  options: RunFfmpegOptions,
): Promise<void> {
  options.signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    execFile(command, [...args], { timeout: options.timeoutMs, signal: options.signal }, (err) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason);
      } else if (err) {
        reject(new Error(`${options.failureMessage}: ${err.message}`));
      } else {
        resolve();
      }
    });
  });
  options.signal?.throwIfAborted();
}
