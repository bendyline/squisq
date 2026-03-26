/**
 * detectFfmpeg
 *
 * Checks whether a native ffmpeg binary is available on the system PATH.
 * Returns the absolute path to the binary if found, or null if not.
 *
 * Uses `which` on macOS/Linux and `where` on Windows.
 */

import { execFile } from 'node:child_process';

/**
 * Detect whether native ffmpeg is installed and available on PATH.
 *
 * @returns Absolute path to ffmpeg binary, or null if not found
 */
export async function detectFfmpeg(): Promise<string | null> {
  const command = process.platform === 'win32' ? 'where' : 'which';

  return new Promise((resolve) => {
    execFile(command, ['ffmpeg'], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
        return;
      }
      // `which` and `where` can return multiple lines; take the first
      const path = stdout.trim().split('\n')[0].trim();
      resolve(path);
    });
  });
}
