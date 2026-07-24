import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadPublicPackages } from './_packages';

function readDeclarations(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return readDeclarations(path);
      return entry.name.endsWith('.d.ts') ? [readFileSync(path, 'utf8')] : [];
    })
    .join('\n');
}

describe('@bendyline/squisq-react standalone browser contract', () => {
  const pkg = loadPublicPackages().find((candidate) => candidate.name.endsWith('squisq-react'))!;

  it('has no external Node built-ins or post-build compatibility shims', () => {
    const bundle = readFileSync(resolve(pkg.dist, 'squisq-player.global.js'), 'utf8');
    expect(bundle).toMatch(/^var SquisqPlayer=\(function\(exports\)\{/);
    expect(bundle).not.toContain('__SQUISQ_PATH_SHIM__');
    expect(bundle).not.toContain('__SQUISQ_PROCESS_SHIM__');
    expect(bundle).not.toContain('__SQUISQ_URL_SHIM__');
    expect(bundle).toContain('exports.getHandle=');
    expect(bundle).not.toContain('exports.mountStatic=');
    expect(bundle).not.toContain('squisqActivePlayerId');
    expect(bundle).not.toContain('squisqPlayers');
  });

  it('resolves vfile through its browser conditional exports', () => {
    const bundle = readFileSync(resolve(pkg.dist, 'squisq-player.global.js'), 'utf8');
    expect(bundle).not.toContain('node:path');
    expect(bundle).not.toContain('node:process');
    expect(bundle).not.toContain('node:url');
  });

  it('keeps the default player below the light-bundle budget and offers a full variant', () => {
    const light = readFileSync(resolve(pkg.dist, 'squisq-player.global.js'));
    const full = readFileSync(resolve(pkg.dist, 'squisq-player.full.global.js'));
    expect(light.byteLength).toBeLessThan(2_000_000);
    expect(full.byteLength).toBeGreaterThan(light.byteLength);
  });

  it('stores icon webfonts once while keeping embedded exports self-contained', async () => {
    const light = readFileSync(resolve(pkg.dist, 'squisq-player.global.js'), 'utf8');
    const full = readFileSync(resolve(pkg.dist, 'squisq-player.full.global.js'), 'utf8');
    const iconStyles = readFileSync(resolve(pkg.dist, 'standalone-icon-styles.js'), 'utf8');

    expect(light).not.toContain('data:font/woff2;base64');
    expect(full).not.toContain('data:font/woff2;base64');
    expect(iconStyles).toContain('data:font/woff2;base64');

    const sourceUrl = pathToFileURL(resolve(pkg.dist, 'standalone-source.js')).href;
    const { PLAYER_BUNDLE } = (await import(sourceUrl)) as { PLAYER_BUNDLE: string };
    expect(PLAYER_BUNDLE).toContain('globalThis.__SQUISQ_PLAYER_ICON_STYLES__=');
    expect(PLAYER_BUNDLE).toContain('data:font/woff2;base64');
  });

  it.each(['squisq-player.global.js', 'squisq-player.full.global.js'])(
    '%s reports the package manifest version',
    (file) => {
      const bundle = readFileSync(resolve(pkg.dist, file), 'utf8');
      const bundledVersion = Function(`${bundle}; return SquisqPlayer.version;`)() as unknown;

      expect(bundledVersion).toBe(pkg.pkg.version);
    },
  );

  it('publishes the callback API and options-object playback signature', () => {
    const declarations = readDeclarations(pkg.dist);
    expect(declarations).toContain('onRenderAPIReady?: (api: SquisqRenderAPI | null) => void;');
    expect(declarations).toContain('interface SquisqPlayerHandle');
    expect(declarations).toContain('interface UseDocPlaybackOptions');
    expect(declarations).toContain('options?: UseDocPlaybackOptions');
    expect(declarations).not.toMatch(/\bSquisqWindow\b/);
  });
});
