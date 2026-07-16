import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('npm run all', () => {
  it('contains every test gate used by CI', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const all = manifest.scripts.all;
    const ciTestGates = new Set(
      [...workflow.matchAll(/\brun:\s+npm run (test:[\w:-]+)/g)].map((match) => match[1]!),
    );

    for (const gate of ciTestGates) {
      expect(all, `npm run all must include ${gate}`).toContain(`npm run ${gate}`);
    }

    // CI's cross-platform jobs also run `npm test`; test:coverage runs that
    // complete Vitest suite while additionally enforcing the coverage floors.
    expect(workflow).toContain('run: npm test');
    expect(all).toContain('npm run test:coverage');
  });

  it('leaves mutation testing to the opt-in extended test suite', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

    expect(manifest.scripts['test:extended']).toContain('npm run test:mutation');
    expect(manifest.scripts.all).not.toContain('test:mutation');
    expect(workflow).not.toContain('test:mutation');
  });
});
