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

import { Command } from 'commander';
import { registerConvertCommand } from './commands/convert.js';
import { registerVideoCommand } from './commands/video.js';

// Colored banner: cyan brackets, bold white text, dim version
console.error(
  '\x1b[36m{[\x1b[0m \x1b[1msquiggly square\x1b[0m \x1b[2m—\x1b[0m \x1b[1msquisq\x1b[0m \x1b[2m—\x1b[0m \x1b[33mv1.0.0\x1b[0m \x1b[36m]}\x1b[0m',
);

const program = new Command();

program
  .name('squisq')
  .description('Squisq CLI — convert and process markdown-based documents')
  .version('1.0.0');

registerConvertCommand(program);
registerVideoCommand(program);

program.parse();
