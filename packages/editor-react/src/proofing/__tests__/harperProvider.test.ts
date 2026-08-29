/**
 * Harper adapter contract, with harper.js fully mocked: binary
 * resolution branches, Lint → ProofFinding mapping, the stacked-rule
 * ignore iteration, cumulative dictionary re-import, setup-failure
 * retry, and dispose poisoning.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeLintSpec {
  start: number;
  end: number;
  kind: string;
  message?: string;
  suggestions?: { text: string; kind: number }[];
}

const harness = vi.hoisted(() => {
  const state = {
    /** Queue of lint results; each lint() shifts one (last repeats). */
    lintScript: [] as FakeLintSpec[][],
    lintCalls: [] as { text: string; options: unknown }[],
    ignoreCalls: [] as FakeLintSpec[][],
    importWordsCalls: [] as string[][],
    importIgnoredCalls: [] as string[],
    clearIgnoredCalls: 0,
    setDialectCalls: [] as number[],
    disposeCount: 0,
    setupFailures: 0,
    constructedWith: [] as unknown[],
    exportJson: '{"context_hashes":[2617823912457726629]}',
  };

  const makeLint = (spec: FakeLintSpec) => ({
    span: () => ({ start: spec.start, end: spec.end }),
    lint_kind: () => spec.kind,
    message: () => spec.message ?? `msg:${spec.kind}`,
    suggestions: () =>
      (spec.suggestions ?? []).map((s) => ({
        get_replacement_text: () => s.text,
        kind: () => s.kind,
      })),
    __spec: spec,
  });

  class FakeLinter {
    constructor(init: unknown) {
      state.constructedWith.push(init);
    }
    async setup(): Promise<void> {
      if (state.setupFailures > 0) {
        state.setupFailures -= 1;
        throw new Error('wasm fetch failed');
      }
    }
    async lint(text: string, options: unknown) {
      state.lintCalls.push({ text, options });
      const specs = state.lintScript.length > 1 ? state.lintScript.shift() : state.lintScript[0];
      return (specs ?? []).map(makeLint);
    }
    async ignoreLint(_source: string, lint: { __spec: FakeLintSpec }) {
      state.ignoreCalls.push([lint.__spec]);
    }
    async exportIgnoredLints(): Promise<string> {
      return state.exportJson;
    }
    async importIgnoredLints(json: string): Promise<void> {
      state.importIgnoredCalls.push(json);
    }
    async clearIgnoredLints(): Promise<void> {
      state.clearIgnoredCalls += 1;
    }
    async importWords(words: string[]): Promise<void> {
      state.importWordsCalls.push([...words].sort());
    }
    async setDialect(dialect: number): Promise<void> {
      state.setDialectCalls.push(dialect);
    }
    async dispose(): Promise<void> {
      state.disposeCount += 1;
    }
  }

  return { state, FakeLinter };
});

vi.mock('harper.js', () => ({
  Dialect: { American: 0, British: 1, Australian: 2, Canadian: 3, Indian: 4 },
  createBinaryModuleFromUrl: vi.fn((url: string) => ({ kind: 'url-binary', url })),
  WorkerLinter: harness.FakeLinter,
  LocalLinter: harness.FakeLinter,
}));

vi.mock('harper.js/binary', () => ({
  binary: { kind: 'default-binary' },
}));

import { createHarperProofingProvider } from '../harperProvider';

beforeEach(() => {
  const { state } = harness;
  state.lintScript = [];
  state.lintCalls = [];
  state.ignoreCalls = [];
  state.importWordsCalls = [];
  state.importIgnoredCalls = [];
  state.clearIgnoredCalls = 0;
  state.setDialectCalls = [];
  state.disposeCount = 0;
  state.setupFailures = 0;
  state.constructedWith = [];
});

describe('binary resolution', () => {
  it('absolutizes a root-relative wasmUrl for the blob worker', async () => {
    const provider = createHarperProofingProvider({ wasmUrl: '/harper/harper.wasm' });
    await provider.setup();
    const init = harness.state.constructedWith[0] as { binary: { kind: string; url: string } };
    // Inside harper's blob: worker a relative URL has no base — the
    // adapter must hand over an absolute URL resolved against the page.
    expect(init.binary.kind).toBe('url-binary');
    expect(init.binary.url).toBe(new URL('/harper/harper.wasm', location.href).toString());
    expect(init.binary.url).toMatch(/^http/);
  });

  it('passes an injected binary through untouched', async () => {
    const injected = { kind: 'injected' };
    const provider = createHarperProofingProvider({ binary: injected });
    await provider.setup();
    const init = harness.state.constructedWith[0] as { binary: unknown };
    expect(init.binary).toBe(injected);
  });

  it('falls back to the harper.js/binary default', async () => {
    const provider = createHarperProofingProvider();
    await provider.setup();
    const init = harness.state.constructedWith[0] as { binary: { kind: string } };
    expect(init.binary).toEqual({ kind: 'default-binary' });
  });
});

describe('lint mapping', () => {
  it('maps spans, kinds, categories, suggestions, and originalText', async () => {
    harness.state.lintScript = [
      [
        {
          start: 8,
          end: 11,
          kind: 'Typo',
          message: 'Did you mean `the`?',
          suggestions: [
            { text: 'the', kind: 0 },
            { text: '', kind: 1 },
            { text: ',', kind: 2 },
          ],
        },
        { start: 0, end: 4, kind: 'Agreement' },
        { start: 12, end: 16, kind: 'Readability' },
      ],
    ];
    const provider = createHarperProofingProvider({ binary: {} });
    const findings = await provider.lint('This is teh test.', { language: 'plaintext' });

    expect(findings).toHaveLength(3);
    expect(findings[0]).toMatchObject({
      start: 8,
      end: 11,
      kind: 'Typo',
      category: 'spelling',
      message: 'Did you mean `the`?',
      originalText: 'teh',
    });
    expect(findings[0].suggestions).toEqual([
      { text: 'the', kind: 'replace' },
      { text: '', kind: 'remove' },
      { text: ',', kind: 'insertAfter' },
    ]);
    expect(findings[1].category).toBe('grammar');
    expect(findings[2].category).toBe('style');
    // Ids are unique within the pass.
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(3);
  });
});

describe('stacked-rule ignore', () => {
  it('iterates until the span is clean, leaving persistence to the caller', async () => {
    const first: FakeLintSpec = { start: 8, end: 11, kind: 'Typo' };
    const stacked: FakeLintSpec = { start: 8, end: 11, kind: 'Spelling' };
    const other: FakeLintSpec = { start: 0, end: 4, kind: 'Agreement' };
    // Pass 1 (the UI lint), then re-lints during ignore: stacked appears
    // once, then the span is clean.
    harness.state.lintScript = [[first, other], [stacked, other], [other]];
    const provider = createHarperProofingProvider({ binary: {} });
    const findings = await provider.lint('This is teh test.');

    await provider.ignoreFinding(findings.find((f) => f.kind === 'Typo')!.id);

    expect(harness.state.ignoreCalls).toEqual([[first], [stacked]]);
    // The editor exports and stores it — the engine adapter does not,
    // because only the editor knows which document this belongs to.
    expect(await provider.exportIgnored()).toBe(harness.state.exportJson);
  });

  it('warns and no-ops on a stale finding id', async () => {
    harness.state.lintScript = [[{ start: 0, end: 3, kind: 'Typo' }]];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = createHarperProofingProvider({ binary: {} });
    await provider.lint('teh test');
    await provider.ignoreFinding('99:99');
    expect(harness.state.ignoreCalls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('dictionary', () => {
  it('reports app-dictionary capability from the presence of the host callback', () => {
    // Drives whether the editor offers "Add to dictionary" at all — a
    // word must never look saved app-wide with nowhere to save it.
    expect(createHarperProofingProvider({ binary: {} }).hasAppDictionary).toBe(false);
    expect(
      createHarperProofingProvider({ binary: {}, onDictionaryWord: () => {} }).hasAppDictionary,
    ).toBe(true);
  });

  it('re-imports the cumulative set and fires the callback only for addWord', async () => {
    const onDictionaryWord = vi.fn();
    const provider = createHarperProofingProvider({
      binary: {},
      initialWords: ['Squisq'],
      onDictionaryWord,
    });
    await provider.setup();
    expect(harness.state.importWordsCalls).toEqual([['Squisq']]);

    await provider.addWords(['gezellig', 'Noord']);
    expect(harness.state.importWordsCalls[1]).toEqual(['Noord', 'Squisq', 'gezellig']);
    expect(onDictionaryWord).not.toHaveBeenCalled();

    await provider.addWord('Bendyline');
    expect(harness.state.importWordsCalls[2]).toContain('Bendyline');
    expect(onDictionaryWord).toHaveBeenCalledWith('Bendyline');
  });
});

describe('ignored-state transfer', () => {
  it('imports, exports, and clears on demand for per-document scoping', async () => {
    const provider = createHarperProofingProvider({ binary: {} });
    await provider.importIgnored('{"context_hashes":[1]}');
    expect(harness.state.importIgnoredCalls).toEqual(['{"context_hashes":[1]}']);
    await provider.clearIgnored();
    expect(harness.state.clearIgnoredCalls).toBe(1);
    expect(await provider.exportIgnored()).toBe(harness.state.exportJson);
  });
});

describe('setup', () => {
  it('applies the configured dialect', async () => {
    const provider = createHarperProofingProvider({ binary: {}, dialect: 'British' });
    await provider.setup();
    const init = harness.state.constructedWith[0] as { dialect: number };
    expect(init.dialect).toBe(1);
  });

  it('a failed load is retryable', async () => {
    harness.state.setupFailures = 1;
    const provider = createHarperProofingProvider({ binary: {} });
    await expect(provider.setup()).rejects.toThrow('wasm fetch failed');
    await expect(provider.setup()).resolves.toBeUndefined();
  });
});

describe('dispose', () => {
  it('poisons further calls and releases the engine', async () => {
    const provider = createHarperProofingProvider({ binary: {} });
    await provider.setup();
    provider.dispose();
    await vi.waitFor(() => expect(harness.state.disposeCount).toBe(1));
    await expect(provider.lint('text')).rejects.toThrow(/disposed/);
  });
});
