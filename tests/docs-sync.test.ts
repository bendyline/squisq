import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * AGENTS.md is the canonical agent-guidance file; CLAUDE.md must be a
 * byte-for-byte compatibility copy for tools that read that filename. This test
 * fails on drift so the two can't silently diverge — they have before. To update:
 * edit AGENTS.md, then `cp AGENTS.md CLAUDE.md`.
 */
describe('agent-guidance docs stay in sync', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  it('CLAUDE.md is identical to AGENTS.md', () => {
    const agents = readFileSync(resolve(repoRoot, 'AGENTS.md'), 'utf8');
    const claude = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf8');
    expect(claude, 'CLAUDE.md has drifted from AGENTS.md — run `cp AGENTS.md CLAUDE.md`').toBe(
      agents,
    );
  });
});
