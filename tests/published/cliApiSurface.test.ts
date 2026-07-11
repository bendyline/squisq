import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadPublicPackages } from './_packages';

describe('@bendyline/squisq-cli/api built surface', () => {
  it('publishes the native file and byte encoders promised to Node callers', async () => {
    const pkg = loadPublicPackages().find((candidate) => candidate.name.endsWith('squisq-cli'))!;
    const api = await import(pathToFileURL(resolve(pkg.dist, 'api.js')).href);

    expect(api.framesToMp4Native).toBeTypeOf('function');
    expect(api.framesToMp4NativeBytes).toBeTypeOf('function');
  });
});
