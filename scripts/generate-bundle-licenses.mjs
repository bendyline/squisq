import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { removeGeneratedLicenseMetadata } from './remove-license-metadata.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const packageDir = resolve(process.argv[2] ?? '.');
const metadataDir = resolve(packageDir, 'dist', '.license-meta');
const extraPackages = process.argv.slice(3);
const packageManifest = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
const components = new Map();

for (const entry of await readdir(metadataDir)) {
  if (!entry.endsWith('.json')) continue;
  const metadata = JSON.parse(await readFile(resolve(metadataDir, entry), 'utf8'));
  for (const input of metadata.inputs) {
    const component = await componentFromInput(metadata.absWorkingDir, input);
    if (component) components.set(component.key, component);
  }
}

for (const name of extraPackages) {
  const root = await findPackageRoot(packageDir, name);
  const component = await readComponent(root);
  components.set(component.key, component);
}

const sorted = [...components.values()].sort((a, b) => a.key.localeCompare(b.key));
const output = renderLicenseFile(packageManifest.name, sorted);
await writeFile(resolve(packageDir, 'THIRD_PARTY_LICENSES.txt'), output, 'utf8');
await removeGeneratedLicenseMetadata(packageDir);
console.log(`Generated ${packageManifest.name} license inventory (${sorted.length} components)`);

async function componentFromInput(absWorkingDir, input) {
  const absolute = resolve(absWorkingDir, input).replaceAll('\\', '/');
  const marker = '/node_modules/';
  const markerIndex = absolute.lastIndexOf(marker);
  if (markerIndex < 0) return null;

  const remainder = absolute.slice(markerIndex + marker.length);
  const segments = remainder.split('/');
  const name = segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
  if (!name || name.startsWith('@bendyline/')) return null;
  const packageRoot = absolute.slice(0, markerIndex + marker.length) + name;
  return readComponent(packageRoot);
}

async function findPackageRoot(start, name) {
  let current = start;
  while (true) {
    const candidate = resolve(current, 'node_modules', ...name.split('/'));
    try {
      await readFile(resolve(candidate, 'package.json'), 'utf8');
      return candidate;
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error(`Cannot resolve license source for ${name}`);
      current = parent;
    }
  }
}

async function readComponent(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const entries = await readdir(root);
  const legalFiles = entries
    .filter((entry) => /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry))
    .sort((a, b) => a.localeCompare(b));
  const fallback = legalFiles.length === 0 ? await repositoryLicenseFallback(manifest) : null;
  if (legalFiles.length === 0 && !fallback) {
    throw new Error(`Bundled package ${manifest.name}@${manifest.version} has no license file`);
  }
  const declaredLicense =
    manifest.license ??
    manifest.licenses
      ?.map((entry) => entry.type)
      .filter(Boolean)
      .join(' OR ') ??
    'SEE PACKAGE';
  return {
    key: `${manifest.name}@${manifest.version}`,
    name: manifest.name,
    version: manifest.version,
    declaredLicense: String(declaredLicense),
    legalFiles: fallback
      ? [fallback]
      : await Promise.all(
          legalFiles.map(async (name) => ({
            name,
            text: await readFile(resolve(root, name), 'utf8'),
          })),
        ),
  };
}

async function repositoryLicenseFallback(manifest) {
  const repository = String(
    typeof manifest.repository === 'string'
      ? manifest.repository
      : (manifest.repository?.url ?? ''),
  );
  let filename;
  if (manifest.name === 'remark-math' && manifest.version === '6.0.0') {
    filename = 'remark-math-6.0.0.txt';
  } else if (manifest.name?.startsWith('@tiptap/') && manifest.version === '2.27.2') {
    filename = 'tiptap-2.27.2.txt';
  } else if (manifest.name === '@ffmpeg/ffmpeg' && manifest.version === '0.12.15') {
    filename = 'ffmpeg-wasm-0.12.15.txt';
  } else if (manifest.name === 'format' && manifest.version === '0.2.2') {
    filename = 'format-0.2.2.txt';
  } else {
    return null;
  }
  return {
    name: `VENDORED-${filename}`,
    text: await readFile(resolve(repoRoot, 'third_party', 'licenses', filename), 'utf8'),
    repository,
  };
}

function renderLicenseFile(packageName, bundled) {
  const lines = [
    `THIRD-PARTY LICENSES FOR ${packageName}`,
    '',
    'Generated from the actual esbuild input graph. Package-local license, copying,',
    'and notice files are reproduced verbatim. When an npm tarball omits its',
    'repository license, the pinned upstream copy is vendored and identified below.',
    '',
    'COMPONENTS',
    ...bundled.map(
      (component) =>
        `- ${component.key} (${component.declaredLicense}); files: ${component.legalFiles.map((file) => file.name).join(', ')}`,
    ),
    '',
  ];

  for (const component of bundled) {
    for (const file of component.legalFiles) {
      lines.push('='.repeat(78));
      lines.push(`${component.key} - ${file.name}`);
      lines.push('='.repeat(78));
      lines.push(file.text.endsWith('\n') ? file.text.slice(0, -1) : file.text);
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}
