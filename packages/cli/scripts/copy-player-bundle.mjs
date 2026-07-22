import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stdout } from 'node:process';

const cliDir = resolve(import.meta.dirname, '..');
const reactDir = resolve(cliDir, '..', 'react');
const playerSource = resolve(reactDir, 'dist', 'squisq-player.global.js');
const playerTarget = resolve(cliDir, 'dist', 'squisq-player.global.js');
const fullPlayerSource = resolve(reactDir, 'dist', 'squisq-player.full.global.js');
const fullPlayerTarget = resolve(cliDir, 'dist', 'squisq-player.full.global.js');

await copyFile(playerSource, playerTarget);
await copyFile(fullPlayerSource, fullPlayerTarget);

const reactLicenses = await readFile(resolve(reactDir, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
const cliLicenses = reactLicenses.replace(
  /^THIRD-PARTY LICENSES FOR .+$/m,
  'THIRD-PARTY LICENSES FOR @bendyline/squisq-cli\n\nThe inventory below covers the bundled light and full standalone player artifacts.',
);
await writeFile(resolve(cliDir, 'THIRD_PARTY_LICENSES.txt'), cliLicenses, 'utf8');

stdout.write(
  'Copied the light and full standalone players and their bundle-derived licenses into the CLI\n',
);
