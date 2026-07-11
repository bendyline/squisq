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
  });

  it('resolves vfile through its browser conditional exports', () => {
    const map = JSON.parse(
      readFileSync(resolve(pkg.dist, 'squisq-player.global.js.map'), 'utf8'),
    ) as { sources: string[] };
    expect(map.sources).not.toContain('../../../node_modules/vfile/lib/minpath.js');
    expect(map.sources).not.toContain('../../../node_modules/vfile/lib/minproc.js');
    expect(map.sources).not.toContain('../../../node_modules/vfile/lib/minurl.js');
  });
});
