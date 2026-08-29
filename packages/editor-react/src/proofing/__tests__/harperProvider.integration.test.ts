/**
 * Opt-in smoke test against the REAL harper.js engine. Heavy (~5s WASM
 * setup), so it runs only when explicitly requested:
 *
 *   HARPER_INTEGRATION=1 npx vitest run packages/editor-react/src/proofing/__tests__/harperProvider.integration.test.ts
 *
 * The binary is injected via `binaryInlined` because harper's Node
 * `file://` loader is broken on Windows (double-drive path bug).
 */

import { describe, expect, it } from 'vitest';
import { createHarperProofingProvider } from '../harperProvider';

describe.skipIf(!process.env.HARPER_INTEGRATION)('harper.js integration', () => {
  it('lints, suggests, and round-trips an ignore', { timeout: 120_000 }, async () => {
    const { binaryInlined } = await import('harper.js/binaryInlined');
    const provider = createHarperProofingProvider({ binary: binaryInlined });
    await provider.setup();

    const text = 'This is teh best result.';
    const findings = await provider.lint(text, { language: 'plaintext' });
    const typo = findings.find((finding) => finding.originalText === 'teh');
    expect(typo).toBeTruthy();
    expect(typo!.category).toBe('spelling');
    expect(typo!.suggestions.some((s) => s.text === 'the' && s.kind === 'replace')).toBe(true);

    // Ignore round-trip: the stacked-rule iteration must leave the span
    // clean on a fresh pass, and the export re-imports.
    await provider.ignoreFinding(typo!.id);
    const after = await provider.lint(text, { language: 'plaintext' });
    expect(after.some((finding) => finding.originalText === 'teh')).toBe(false);

    const exported = await provider.exportIgnored();
    expect(exported).toContain('context_hashes');
    provider.dispose();
  });
});
