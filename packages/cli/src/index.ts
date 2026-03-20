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

const program = new Command();

program
  .name('squisq')
  .description('Squisq CLI — convert and process markdown-based documents')
  .version('1.0.0');

registerConvertCommand(program);

program.parse();
