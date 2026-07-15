import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadPublicPackages } from './_packages';

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

  it('publishes the callback API and options-object playback signature', () => {
    const declarations = readFileSync(resolve(pkg.dist, 'index.d.ts'), 'utf8');
    expect(declarations).toContain('onRenderAPIReady?: (api: SquisqRenderAPI | null) => void;');
    expect(declarations).toContain('interface SquisqPlayerHandle');
    expect(declarations).toContain('interface UseDocPlaybackOptions');
    expect(declarations).toContain('options?: UseDocPlaybackOptions');
    expect(declarations).not.toMatch(/\bSquisqWindow\b/);
  });
});
