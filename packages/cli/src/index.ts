/**
 * squisq CLI
 *
 * Command-line tool for converting and processing Squisq documents.
 * Designed for easy addition of future subcommands (e.g., import).
 *
 * Usage:
 *   squisq convert <input> [options]
 *   squisq video <input> [output.mp4|output.gif] [options]
 *   squisq image <input> [output.png] [options]
 *   squisq --help
 *
 * THIS MODULE IS THE `squisq` BIN ENTRY POINT ONLY. Importing it runs the CLI:
 * the module body may print a TTY banner and calls `program.parse()` against
 * the host process's argv. It is therefore deliberately NOT reachable through the
 * package's `exports` map — `main`/`exports["."]` resolve to `./dist/api.js`,
 * and the programmatic surface lives at `@bendyline/squisq-cli/api`. Only the
 * `bin` field (which bypasses `exports`) points here.
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerConvertCommand } from './commands/convert.js';
import { registerVideoCommand } from './commands/video.js';
import { registerImageCommand } from './commands/image.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerTransformCommand } from './commands/transform.js';

// Read the real version from package.json at runtime (ESM-safe). From the built
// `dist/index.js`, `../package.json` resolves to `packages/cli/package.json`.
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

// Keep scripted stdout/stderr quiet; the colored identity is terminal chrome.
if (process.stderr.isTTY) {
  console.error(
    `\x1b[36m{[\x1b[0m \x1b[1msquiggly square\x1b[0m \x1b[2m—\x1b[0m \x1b[1msquisq\x1b[0m \x1b[2m—\x1b[0m \x1b[33mv${version}\x1b[0m \x1b[36m]}\x1b[0m`,
  );
}

const program = new Command();

program
  .name('squisq')
  .description('Squisq CLI — convert and process markdown-based documents')
  .version(version);

registerConvertCommand(program);
registerVideoCommand(program);
registerImageCommand(program);
registerValidateCommand(program);
registerDoctorCommand(program);
registerTransformCommand(program);

program.parse();
