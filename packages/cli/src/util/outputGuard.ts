/**
 * Output-file overwrite protection.
 *
 * The CLI writes into the user's working directory — by default right next to
 * the input file. A bare `squisq convert report.md` emits seven files, and
 * before this guard every one of them clobbered any existing file of that name
 * with no prompt, warning, or flag. Hand-edited exports were destroyed silently.
 *
 * Policy: refuse to replace an existing file unless `--overwrite` is passed.
 * The flag is deliberately named `--overwrite` rather than `--force`/`-f`
 * because `-f` is already `--formats` on `squisq convert`, and a `--force` long
 * flag whose short form means something unrelated is a trap.
 *
 * Non-interactive by design: this never prompts, so scripts either pass
 * `--overwrite` or fail with a non-zero exit.
 */

import { writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

/** True when something already exists at `path`. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** The error message used for both the pre-flight check and the atomic write. */
function refusalMessage(paths: readonly string[]): string {
  const list = paths.map((p) => `  ${p}`).join('\n');
  const noun = paths.length === 1 ? 'File' : 'Files';
  return (
    `${noun} already exist${paths.length === 1 ? 's' : ''} and would be overwritten:\n${list}\n` +
    'Pass --overwrite to replace, or choose a different -o/--output-dir.'
  );
}

/**
 * Fail before doing any work if any intended output already exists.
 *
 * Called up front so a multi-format convert refuses *before* spending minutes
 * rendering, rather than after partially writing the output set.
 */
export async function assertOutputsWritable(
  paths: readonly string[],
  overwrite: boolean | undefined,
): Promise<void> {
  if (overwrite) return;
  const conflicts: string[] = [];
  for (const path of paths) {
    if (await exists(path)) conflicts.push(path);
  }
  if (conflicts.length > 0) throw new Error(refusalMessage(conflicts));
}

/**
 * Write `data` to `path`, refusing to replace an existing file unless
 * `overwrite` is set.
 *
 * Uses the `wx` open flag rather than a check-then-write, so the guarantee
 * holds even if the file appears between {@link assertOutputsWritable} and this
 * call. The pre-flight check is for a good error early; this is the guarantee.
 */
export async function writeFileGuarded(
  path: string,
  data: Uint8Array,
  overwrite: boolean | undefined,
): Promise<void> {
  try {
    await writeFile(path, data, overwrite ? undefined : { flag: 'wx' });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(refusalMessage([path]));
    }
    throw err;
  }
}
