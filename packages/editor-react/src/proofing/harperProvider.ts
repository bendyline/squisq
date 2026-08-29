/**
 * harper.js-backed {@link ProofingProvider}.
 *
 * harper.js is an OPTIONAL peer dependency: this module reaches it only
 * through dynamic `import('harper.js')` inside function bodies, so
 * consumers who never enable proofing load none of it (and its types
 * never appear in published declarations — the optional-peer contract
 * pinned by `tests/published/harperOptionalPeer.test.ts`).
 *
 * Engine facts this adapter encodes (spike-verified against 2.7.0):
 *  - spans are UTF-16 code units — no conversion toward PM/Monaco/DOM;
 *  - `WorkerLinter` runs the WASM in an inlined blob worker (browser);
 *    `LocalLinter` is the Node path for tests;
 *  - ignoring one lint can reveal a stacked same-span lint from another
 *    rule on the next pass, so ignore iterates until the span is clean;
 *  - `exportIgnoredLints()` JSON holds integers above 2^53 → opaque;
 *  - `importWords` semantics are not guaranteed additive, so the full
 *    cumulative word set is re-imported on every change.
 */

import {
  categorizeLintKind,
  type ProofFinding,
  type ProofSuggestionKind,
} from '@bendyline/squisq/proof';
import type { HarperProofingConfig, ProofingLintOptions, ProofingProvider } from './types.js';

type HarperModule = typeof import('harper.js');
type HarperLinter = import('harper.js').Linter;
type HarperLint = import('harper.js').Lint;

/** harper `SuggestionKind` numeric values → provider vocabulary. */
const SUGGESTION_KINDS: readonly ProofSuggestionKind[] = ['replace', 'remove', 'insertAfter'];

/** Bound on the stacked-rule ignore iteration. */
const MAX_IGNORE_ROUNDS = 5;

interface EngineHandle {
  harper: HarperModule;
  linter: HarperLinter;
}

interface LastPass {
  source: string;
  language: 'plaintext' | 'markdown';
  byId: Map<string, { lint: HarperLint; start: number; end: number }>;
}

/**
 * Create a proofing provider backed by harper.js. Construction is cheap
 * and side-effect-free; all loading happens in `setup()` (or lazily on
 * first use). Requires `harper.js` to be installed by the host.
 */
export function createHarperProofingProvider(config: HarperProofingConfig = {}): ProofingProvider {
  let enginePromise: Promise<EngineHandle> | null = null;
  let lastPass: LastPass | null = null;
  let disposed = false;
  const words = new Set<string>(config.initialWords ?? []);

  const load = async (): Promise<EngineHandle> => {
    const harper = await import('harper.js');
    let binary = config.binary;
    if (binary === undefined) {
      if (config.wasmUrl) {
        // The engine fetches the WASM from INSIDE its blob: worker, where
        // a root-relative URL cannot resolve (no meaningful base). Make a
        // host-relative URL absolute against the page before handing it
        // over so `wasmUrl: '/harper/harper_wasm_bg.wasm'` just works.
        const absolute =
          typeof location !== 'undefined'
            ? new URL(config.wasmUrl, location.href).toString()
            : config.wasmUrl;
        binary = harper.createBinaryModuleFromUrl(absolute);
      } else {
        binary = (await import('harper.js/binary')).binary;
      }
    }
    const dialect = harper.Dialect[config.dialect ?? 'American'];
    const init = { binary, dialect } as ConstructorParameters<typeof harper.LocalLinter>[0];
    // WorkerLinter needs a real Web Worker (browser); LocalLinter is the
    // Node/test path. jsdom does not provide Worker, so the check holds.
    const linter: HarperLinter =
      typeof Worker !== 'undefined' ? new harper.WorkerLinter(init) : new harper.LocalLinter(init);
    await linter.setup();
    if (words.size > 0) await linter.importWords([...words]);
    return { harper, linter };
  };

  const ensure = (): Promise<EngineHandle> => {
    if (disposed) return Promise.reject(new Error('ProofingProvider has been disposed'));
    if (!enginePromise) {
      enginePromise = load().catch((err: unknown) => {
        // Reset so a later call retries the load instead of caching the
        // failure for the session (transient chunk/WASM fetch failures).
        enginePromise = null;
        throw err;
      });
    }
    return enginePromise;
  };

  const toFinding = (lint: HarperLint, id: string, text: string): ProofFinding => {
    const span = lint.span();
    const kind = lint.lint_kind();
    return {
      id,
      start: span.start,
      end: span.end,
      category: categorizeLintKind(kind),
      kind,
      message: lint.message(),
      originalText: text.slice(span.start, span.end),
      suggestions: lint.suggestions().map((suggestion) => ({
        text: suggestion.get_replacement_text(),
        kind: SUGGESTION_KINDS[suggestion.kind()] ?? 'replace',
      })),
    };
  };

  let passCounter = 0;

  return {
    // App-level additions only persist if the host gave us somewhere to
    // put them; without a callback the editor hides that menu item.
    hasAppDictionary: config.onDictionaryWord != null,

    async setup(): Promise<void> {
      await ensure();
    },

    async lint(text: string, options?: ProofingLintOptions): Promise<ProofFinding[]> {
      const { linter } = await ensure();
      const language = options?.language ?? 'plaintext';
      const lints = await linter.lint(text, { language });
      passCounter += 1;
      const byId = new Map<string, { lint: HarperLint; start: number; end: number }>();
      const findings = lints.map((lint, index) => {
        const id = `${passCounter}:${index}`;
        const finding = toFinding(lint, id, text);
        byId.set(id, { lint, start: finding.start, end: finding.end });
        return finding;
      });
      lastPass = { source: text, language, byId };
      return findings;
    },

    async ignoreFinding(findingId: string): Promise<void> {
      const { linter } = await ensure();
      const pass = lastPass;
      const entry = pass?.byId.get(findingId);
      if (!pass || !entry) {
        console.warn('squisq proofing: ignoreFinding called with a stale finding id', findingId);
        return;
      }
      // Suppressing one rule's lint can surface a lower-priority rule's
      // lint on the same span (deduped away until now) — iterate until
      // the span stays clean or the bound is hit.
      let lint: HarperLint | undefined = entry.lint;
      for (let round = 0; round < MAX_IGNORE_ROUNDS && lint; round += 1) {
        await linter.ignoreLint(pass.source, lint);
        const relint = await linter.lint(pass.source, { language: pass.language });
        lint = relint.find(
          (candidate) =>
            candidate.span().start === entry.start && candidate.span().end === entry.end,
        );
      }
      // Persisting the result is the editor's job — it knows which
      // document the ignore belongs to and owns the host store.
    },

    async addWord(word: string): Promise<void> {
      const { linter } = await ensure();
      words.add(word);
      await linter.importWords([...words]);
      config.onDictionaryWord?.(word);
    },

    async addWords(list: readonly string[]): Promise<void> {
      if (list.length === 0) return;
      const { linter } = await ensure();
      for (const word of list) words.add(word);
      await linter.importWords([...words]);
    },

    async exportIgnored(): Promise<string> {
      const { linter } = await ensure();
      return linter.exportIgnoredLints();
    },

    async clearIgnored(): Promise<void> {
      const { linter } = await ensure();
      await linter.clearIgnoredLints();
    },

    async importIgnored(json: string): Promise<void> {
      const { linter } = await ensure();
      await linter.importIgnoredLints(json);
    },

    async setDialect(dialect): Promise<void> {
      const { harper, linter } = await ensure();
      await linter.setDialect(harper.Dialect[dialect]);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      lastPass = null;
      const pending = enginePromise;
      enginePromise = null;
      void pending
        ?.then((handle) => handle.linter.dispose())
        .catch(() => {
          // Engine never finished loading — nothing to release.
        });
    },
  };
}
