import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('npm run all', () => {
  it('contains every test gate used by CI', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const all = manifest.scripts.all;
    const ciTestGates = [
      'test:coverage',
      'test:mutation',
      'test:published',
      'test:cli',
      'test:cli:native:required',
      'test:e2e:ci',
    ];

    for (const gate of ciTestGates) {
      expect(all, `npm run all must include ${gate}`).toContain(`npm run ${gate}`);
    }
  });
});
