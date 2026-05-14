/**
 * generate-icon-data.mjs
 *
 * One-shot generator for `packages/core/src/icons/iconData.ts`. Reads
 * FontAwesome Free's metadata (`icon-families.json`) at the repo root,
 * filters to the families we support (brands / solid / regular), and
 * emits a compact TypeScript module that the core `resolveIcon` helper
 * indexes at module load.
 *
 * Run via `node scripts/generate-icon-data.mjs` whenever
 * @fortawesome/fontawesome-free is bumped. The output is committed so
 * downstream consumers don't need the FA metadata at install time.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const metadataPath = path.join(
  repoRoot,
  'node_modules',
  '@fortawesome',
  'fontawesome-free',
  'metadata',
  'icon-families.json',
);
const outPath = path.join(repoRoot, 'packages', 'core', 'src', 'icons', 'iconData.ts');

const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

const FAMILIES = /** @type {const} */ (['brands', 'solid', 'regular']);
const entries = [];

for (const [name, entry] of Object.entries(meta)) {
  const classic = entry.svgs?.classic;
  if (!classic) continue;
  for (const family of FAMILIES) {
    if (!classic[family]) continue;
    const label = entry.label ?? name;
    const termList = entry.search?.terms ?? [];
    // Keywords: name itself + label words + search terms, all lowercase
    // and joined with single spaces for the keyword-substring search.
    const keywords = Array.from(
      new Set(
        [name, ...label.toLowerCase().split(/\s+/), ...termList]
          .filter((t) => typeof t === 'string' && t.length > 0)
          .map((t) => String(t).toLowerCase()),
      ),
    ).join(' ');
    // FA's Private-Use-Area codepoint as a hex string (e.g. 'f09b').
    // Stored as the string form so the runtime can either render it
    // via the FA font (after `String.fromCodePoint(parseInt(unicode, 16))`)
    // or pass it through to a `<i class="fa-…">` element verbatim.
    const unicode = typeof entry.unicode === 'string' ? entry.unicode : '';
    entries.push({ name, family, label, keywords, unicode });
  }
}

// Stable sort: family first, then name. Stable order keeps diffs minimal
// when FA bumps add/remove icons.
entries.sort(
  (a, b) =>
    a.family.localeCompare(b.family) ||
    a.name.localeCompare(b.name),
);

const banner = `/**
 * iconData.ts — GENERATED FILE
 *
 * FontAwesome Free icon catalog. Run \`node scripts/generate-icon-data.mjs\`
 * to regenerate after bumping @fortawesome/fontawesome-free.
 *
 * Entry count: ${entries.length}
 * Generated:   ${new Date().toISOString()}
 */
`;

// Parse from a JSON string at module load. The 2k-entry literal would
// otherwise overwhelm the dts generator with a giant union type
// (TS2590). Runtime cost is one-time ~2ms; type safety is preserved
// because the const carries the explicit `IconEntry[]` annotation.
const body = `
export type IconFamily = 'brands' | 'solid' | 'regular';

export interface IconEntry {
  /** Icon name without the \`fa-\` prefix (e.g. \`github\`). */
  name: string;
  /** Family bucket — drives the \`fa-brands\` / \`fa-solid\` / \`fa-regular\` class. */
  family: IconFamily;
  /** Human display label (used by the picker tooltip). */
  label: string;
  /** Lowercase, space-joined search keywords. */
  keywords: string;
  /** FontAwesome Private-Use-Area codepoint as a hex string (e.g. \`'f09b'\`).
   *  Use \`String.fromCodePoint(parseInt(unicode, 16))\` to get the rendered
   *  glyph when the FA font is loaded. */
  unicode: string;
}

const ICONS_JSON = ${JSON.stringify(JSON.stringify(entries))};

export const ICONS: IconEntry[] = JSON.parse(ICONS_JSON) as IconEntry[];
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, banner + body, 'utf8');

const byFamily = entries.reduce((acc, e) => {
  acc[e.family] = (acc[e.family] ?? 0) + 1;
  return acc;
}, {});
const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(
  `Wrote ${outPath}\n  total: ${entries.length}\n  brands: ${byFamily.brands ?? 0}\n  solid: ${byFamily.solid ?? 0}\n  regular: ${byFamily.regular ?? 0}\n  size: ${sizeKb} KB`,
);
