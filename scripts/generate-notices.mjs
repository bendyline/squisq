import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');

const packageDirs = ['core', 'formats', 'react', 'editor-react', 'video', 'video-react', 'cli'];
const manifests = new Map(
  packageDirs.map((dir) => [dir, readJson(resolve(repoRoot, 'packages', dir, 'package.json'))]),
);
const workspaceByName = new Map(
  [...manifests.entries()].map(([dir, manifest]) => [manifest.name, { dir, manifest }]),
);

const repositoryOverrides = {
  '@bendyline/squisq': 'https://github.com/bendyline/squisq',
  '@bendyline/squisq-formats': 'https://github.com/bendyline/squisq',
  '@bendyline/squisq-react': 'https://github.com/bendyline/squisq',
  '@bendyline/squisq-video': 'https://github.com/bendyline/squisq',
  '@monaco-editor/loader': 'https://github.com/suren-atoyan/monaco-loader',
  '@monaco-editor/react': 'https://github.com/suren-atoyan/monaco-react',
  '@pdf-lib/upng': 'https://github.com/Hopding/upng',
  '@xmldom/xmldom': 'https://github.com/xmldom/xmldom',
  '@ffmpeg/core': 'https://github.com/ffmpegwasm/ffmpeg.wasm',
  '@ffmpeg/ffmpeg': 'https://github.com/ffmpegwasm/ffmpeg.wasm',
  '@ffmpeg/util': 'https://github.com/ffmpegwasm/ffmpeg.wasm',
  '@fortawesome/fontawesome-free': 'https://github.com/FortAwesome/Font-Awesome',
  commander: 'https://github.com/tj/commander.js',
  'genson-js': 'https://github.com/aspecto-io/genson-js',
  'hast-util-from-html': 'https://github.com/syntax-tree/hast-util-from-html',
  html2canvas: 'https://github.com/niklasvh/html2canvas',
  jszip: 'https://github.com/Stuk/jszip',
  localforage: 'https://github.com/localForage/localForage',
  mermaid: 'https://github.com/mermaid-js/mermaid',
  'monaco-editor': 'https://github.com/microsoft/monaco-editor',
  'mp4-muxer': 'https://github.com/Vanilagy/mp4-muxer',
  ngeohash: 'https://github.com/sunng87/node-geohash',
  'pdf-lib': 'https://pdf-lib.js.org',
  'pdfjs-dist': 'https://mozilla.github.io/pdf.js',
  'playwright-core': 'https://github.com/microsoft/playwright',
  preact: 'https://github.com/preactjs/preact',
  react: 'https://github.com/facebook/react',
  'react-dom': 'https://github.com/facebook/react',
  'remark-directive': 'https://github.com/remarkjs/remark-directive',
  'remark-frontmatter': 'https://github.com/remarkjs/remark-frontmatter',
  'remark-gfm': 'https://github.com/remarkjs/remark-gfm',
  'remark-math': 'https://github.com/remarkjs/remark-math',
  'remark-parse': 'https://github.com/remarkjs/remark/tree/main/packages/remark-parse',
  'remark-stringify': 'https://github.com/remarkjs/remark/tree/main/packages/remark-stringify',
  'state-local': 'https://github.com/suren-atoyan/state-local',
  'type-fest': 'https://github.com/sindresorhus/type-fest',
  unified: 'https://unifiedjs.com',
};

const licenseOverrides = {
  '@fortawesome/fontawesome-free': 'CC-BY-4.0 AND OFL-1.1 AND MIT',
  jszip: 'MIT OR GPL-3.0-or-later',
  'type-fest': 'MIT OR CC0-1.0',
};

const footers = {
  core: `Copyright and complete license texts for these dependencies are included in
their respective npm distributions and source repositories.`,
  formats: `Squisq uses jszip under its MIT license option. Copyright and complete license
texts for these dependencies are included in their respective npm
distributions and source repositories.`,
  react: `Mermaid is Copyright (c) 2014-2022 Knut Sveidqvist and is distributed under
the MIT License. Preact is used by the standalone browser bundles. Copyright
and complete license texts for these dependencies are included in their
respective distributions and source repositories.`,
  'editor-react': `Font Awesome Free contains icon artwork under CC-BY-4.0, font files under
OFL-1.1, and CSS/JavaScript under MIT. Attribution is required when its icon
artwork is redistributed. The Monaco React adapter, loader, and state-local
are bundled so consumers do not inherit the adapter's mandatory Monaco peer.
Complete license texts remain available in the respective distributions and
source repositories.`,
  video: `The @ffmpeg/ffmpeg and @ffmpeg/util packages provide JavaScript APIs and
utilities. This npm package does not include @ffmpeg/core, ffmpeg-core.js, or
ffmpeg-core.wasm; applications that use a WebAssembly core supply and
distribute it separately.

Copyright and complete license texts for the listed dependencies are included
in their respective npm distributions and source repositories.`,
  'video-react': `## @ffmpeg/core WebAssembly runtime

@ffmpeg/core is a WebAssembly build with an upstream dependency on the FFmpeg
project and external libraries. Version 0.12.9 declares GPL-2.0-or-later. A
verbatim copy of GPLv2 is included as COPYING.GPL-2.0.txt. Hosts that publish
ffmpeg-core.js or ffmpeg-core.wasm must preserve the applicable notices,
provide the GPL text, and provide equivalent access to the corresponding
source for the exact binaries.

Squisq's demo site uses the unmodified ESM files from @ffmpeg/core@0.12.9.
Upstream identifies ffmpeg.wasm release v12.14, commit
d3c018aa40a241384965268f0506b73f47dee60c, as the source release containing
that package version:

- https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.14
- https://github.com/ffmpegwasm/ffmpeg.wasm/tree/d3c018aa40a241384965268f0506b73f47dee60c
- https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.14.tar.gz
- https://ffmpegwasm.netlify.app/docs/contribution/core/

mp4-muxer is bundled as a private runtime implementation detail so its legacy
global WebCodecs declaration dependencies are not installed for consumers.`,
  cli: `Copyright and complete license texts for these dependencies are included in
their respective npm distributions and source repositories.`,
};

const configs = {
  core: { heading: 'Runtime dependencies' },
  formats: { heading: 'Runtime dependencies' },
  react: {
    heading: 'Runtime, peer, and bundled dependencies',
    bundled: ['preact'],
    peers: true,
  },
  'editor-react': {
    heading: 'Runtime, peer, and bundled dependencies',
    bundled: ['@monaco-editor/react', '@monaco-editor/loader', 'state-local'],
    peers: true,
  },
  video: { heading: 'Runtime dependencies' },
  'video-react': {
    heading: 'Runtime, peer, and bundled dependencies',
    bundled: ['mp4-muxer'],
    peers: true,
  },
  cli: { heading: 'Runtime dependencies' },
};

let stale = false;
for (const [dir, config] of Object.entries(configs)) {
  const manifest = manifests.get(dir);
  const rows = [];

  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    rows.push(dependencyRow(name, version));
  }
  for (const name of config.bundled ?? []) {
    const metadata = dependencyMetadata(name);
    rows.push(dependencyRow(name, metadata.version, 'bundled'));
  }
  if (config.peers) {
    for (const [name, version] of Object.entries(manifest.peerDependencies ?? {})) {
      rows.push(dependencyRow(name, version, 'peer'));
    }
  }

  const notice = renderNotice(manifest.name, config.heading, rows, footers[dir]);
  const noticePath = resolve(repoRoot, 'packages', dir, 'NOTICE.md');
  const current = readFileSync(noticePath, 'utf8').replace(/\r\n/g, '\n');
  if (current === notice) continue;

  stale = true;
  if (checkOnly) {
    console.error(`${noticePath} is stale; run npm run notices`);
  } else {
    writeFileSync(noticePath, notice, 'utf8');
    console.log(`updated ${noticePath}`);
  }
}

if (checkOnly && stale) process.exitCode = 1;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function dependencyMetadata(name) {
  const workspace = workspaceByName.get(name);
  if (workspace) return workspace.manifest;
  return readJson(resolve(repoRoot, 'node_modules', ...name.split('/'), 'package.json'));
}

function dependencyRow(name, version, role) {
  const metadata = dependencyMetadata(name);
  const license = licenseOverrides[name] ?? String(metadata.license ?? 'SEE PACKAGE');
  const repository = repositoryOverrides[name] ?? normalizeRepository(metadata);
  return {
    package: role ? `${name} _(${role})_` : name,
    version,
    license: license.replace(/^\((.*)\)$/, '$1'),
    repository,
  };
}

function normalizeRepository(metadata) {
  const raw =
    typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
  const candidate = raw || metadata.homepage || '';
  return String(candidate)
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git(?:#.*)?$/, '')
    .replace(/#readme$/, '');
}

function renderNotice(packageName, heading, rows, footer) {
  return `# Third-Party Notices for ${packageName}

This notice applies to the \`${packageName}\` npm package.
Squisq-authored code is licensed under the MIT license in \`LICENSE\`.
Third-party components remain under their respective license terms.

## ${heading}

${renderTable(rows)}

${footer}
`;
}

function renderTable(rows) {
  const headers = ['Package', 'Version', 'License', 'Repository'];
  const escapedRows = rows.map((row) => [
    row.package,
    String(row.version).replaceAll('|', '\\|'),
    row.license,
    row.repository,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...escapedRows.map((row) => row[index].length)),
  );
  const line = (cells) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(' | ')} |`;
  return [
    line(headers),
    line(widths.map((width) => '-'.repeat(width))),
    ...escapedRows.map(line),
  ].join('\n');
}
