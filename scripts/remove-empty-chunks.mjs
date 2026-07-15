import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const outputDir = resolve(process.cwd(), process.argv[2] ?? 'dist');

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJavaScriptFiles(path)));
    } else if (entry.name.endsWith('.js')) {
      files.push(path);
    }
  }

  return files;
}

const files = await listJavaScriptFiles(outputDir);
const sources = new Map(
  await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')])),
);
const emptyFiles = new Set(
  [...sources].filter(([, source]) => source.trim() === '').map(([file]) => file),
);

if (emptyFiles.size === 0) {
  process.exit(0);
}

const emptyNames = new Set([...emptyFiles].map((file) => basename(file)));
const rewritten = new Map();

for (const [file, source] of sources) {
  if (emptyFiles.has(file)) continue;

  const hadFinalNewline = source.endsWith('\n');
  const lines = source.split(/\r?\n/).filter((line) => {
    const match = line.trim().match(/^import\s+['"]([^'"]+)['"];?$/);
    if (!match) return true;
    return !emptyNames.has(basename(match[1]));
  });
  let nextSource = lines.join('\n');
  if (hadFinalNewline && !nextSource.endsWith('\n')) nextSource += '\n';
  rewritten.set(file, nextSource);
}

for (const [file, source] of rewritten) {
  for (const name of emptyNames) {
    if (source.includes(name)) {
      throw new Error(`Cannot remove ${name}: it is still referenced by ${file}`);
    }
  }
}

await Promise.all(
  [...rewritten]
    .filter(([file, source]) => source !== sources.get(file))
    .map(([file, source]) => writeFile(file, source)),
);
await Promise.all([...emptyFiles].map((file) => rm(file)));

console.log(`Removed ${emptyFiles.size} empty JavaScript chunk(s) from ${outputDir}.`);
