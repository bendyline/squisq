import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stdout } from 'node:process';
import { removeGeneratedLicenseMetadata } from '../../../scripts/remove-license-metadata.mjs';

const cliDir = resolve(import.meta.dirname, '..');
const reactDir = resolve(cliDir, '..', 'react');
const playerSource = resolve(reactDir, 'dist', 'squisq-player.global.js');
const playerTarget = resolve(cliDir, 'dist', 'squisq-player.global.js');
const fullPlayerSource = resolve(reactDir, 'dist', 'squisq-player.full.global.js');
const fullPlayerTarget = resolve(cliDir, 'dist', 'squisq-player.full.global.js');
const iconStylesSource = resolve(reactDir, 'dist', 'standalone-icon-styles.js');
const iconBootstrapTarget = resolve(cliDir, 'dist', 'squisq-player-icons.global.js');

await copyFile(playerSource, playerTarget);
await copyFile(fullPlayerSource, fullPlayerTarget);
const { PLAYER_ICON_STYLES } = await import(pathToFileURL(iconStylesSource).href);
await writeFile(
  iconBootstrapTarget,
  `globalThis.__SQUISQ_PLAYER_ICON_STYLES__=${JSON.stringify(PLAYER_ICON_STYLES)};\n`,
  'utf8',
);

const reactLicenses = await readFile(resolve(reactDir, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
const cliLicenses = reactLicenses.replace(
  /^THIRD-PARTY LICENSES FOR .+$/m,
  'THIRD-PARTY LICENSES FOR @bendyline/squisq-cli\n\nThe inventory below covers the bundled light and full standalone player artifacts and their shared icon styles.',
);
await writeFile(resolve(cliDir, 'THIRD_PARTY_LICENSES.txt'), cliLicenses, 'utf8');
await removeGeneratedLicenseMetadata(cliDir);

stdout.write(
  'Copied the light and full standalone players, shared icon styles, and bundle-derived licenses into the CLI\n',
);
