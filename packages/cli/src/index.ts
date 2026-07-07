/**
 * squisq CLI
 *
 * Command-line tool for converting and processing Squisq documents.
 * Designed for easy addition of future subcommands (e.g., import).
 *
 * Usage:
 *   squisq convert <input> [options]
 *   squisq --help
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerConvertCommand } from './commands/convert.js';
import { registerVideoCommand } from './commands/video.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerDoctorCommand } from './commands/doctor.js';

// Read the real version from package.json at runtime (ESM-safe). From the built
// `dist/index.js`, `../package.json` resolves to `packages/cli/package.json`.
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

// Colored banner: cyan brackets, bold white text, dim version
console.error(
  `\x1b[36m{[\x1b[0m \x1b[1msquiggly square\x1b[0m \x1b[2m—\x1b[0m \x1b[1msquisq\x1b[0m \x1b[2m—\x1b[0m \x1b[33mv${version}\x1b[0m \x1b[36m]}\x1b[0m`,
);

const program = new Command();

program
  .name('squisq')
  .description('Squisq CLI — convert and process markdown-based documents')
  .version(version);

registerConvertCommand(program);
registerVideoCommand(program);
registerValidateCommand(program);
registerDoctorCommand(program);

program.parse();
