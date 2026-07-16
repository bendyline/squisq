import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stdout } from 'node:process';

const cliDir = resolve(import.meta.dirname, '..');
const reactDir = resolve(cliDir, '..', 'react');
const playerSource = resolve(reactDir, 'dist', 'squisq-player.global.js');
const playerTarget = resolve(cliDir, 'dist', 'squisq-player.global.js');

await copyFile(playerSource, playerTarget);

const reactLicenses = await readFile(resolve(reactDir, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
const cliLicenses = reactLicenses.replace(
  /^THIRD-PARTY LICENSES FOR .+$/m,
  'THIRD-PARTY LICENSES FOR @bendyline/squisq-cli\n\nThe inventory below covers the bundled light standalone player artifact.',
);
await writeFile(resolve(cliDir, 'THIRD_PARTY_LICENSES.txt'), cliLicenses, 'utf8');

stdout.write('Copied the light standalone player and its bundle-derived licenses into the CLI\n');
