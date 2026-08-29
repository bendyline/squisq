/**
 * The proofing capability contract between an editor host and the shell.
 *
 * A host that wants grammar/spellcheck passes a {@link ProofingProvider}
 * (or a factory) to `EditorShell`'s `proofing` prop — the same
 * capability-injection semantics as `ffmpegWasm`: absent means the
 * feature is off, and there is no CDN fallback. The provider surface is
 * plain data end to end, deliberately free of harper.js types so the
 * engine stays an optional peer dependency that never appears in this
 * package's published declarations.
 */

import type { ProofDialect, ProofFinding } from '@bendyline/squisq/proof';

/** Markup mode for one lint call. */
export type ProofingLanguage = 'plaintext' | 'markdown';

export interface ProofingLintOptions {
  /** Defaults to `plaintext`. */
  language?: ProofingLanguage;
}

/**
 * An engine adapter the editor drives. Implementations must serialize
 * their own engine access (calls may arrive while a previous one is in
 * flight) and keep `lint` results resolvable by finding id until the
 * next `lint` call.
 */
export interface ProofingProvider {
  /**
   * Load the engine (module + WASM). Idempotent and safe to call
   * repeatedly; a rejection is retryable — a later call attempts a
   * fresh load. All expensive work belongs here, never in construction.
   */
  setup(): Promise<void>;
  /** Lint `text`; finding offsets index into `text` (UTF-16 units). */
  lint(text: string, options?: ProofingLintOptions): Promise<ProofFinding[]>;
  /**
   * Persistently ignore the finding's underlying lint — including any
   * stacked same-span lints other rules reveal once the first is
   * suppressed. `findingId` must come from the most recent `lint` call.
   */
  ignoreFinding(findingId: string): Promise<void>;
  /**
   * Accept one word into the APP-level dictionary — fires the host's
   * `onDictionaryWord` so it can persist wherever it keeps user
   * settings. Backs the menu's "Add to dictionary".
   */
  addWord(word: string): Promise<void>;
  /**
   * Accept words for this session without notifying the host. Used both
   * to load a document's own word list at setup and to back the menu's
   * "Add to document word list" (where the DOC's frontmatter, not the
   * app, is the store of record).
   */
  addWords(words: readonly string[]): Promise<void>;
  /**
   * Whether app-level additions actually persist — i.e. the host wired
   * `onDictionaryWord`. When `false`, the editor hides "Add to
   * dictionary" so a word can never appear to be saved app-wide and
   * then silently come back. `undefined` (a provider that doesn't
   * report) is treated as capable.
   */
  readonly hasAppDictionary?: boolean;
  /**
   * The engine's ignored-findings state as an OPAQUE string — it holds
   * context hashes as integers above 2^53, so it must never be
   * JSON-parsed or rebuilt, only stored and handed back verbatim.
   */
  exportIgnored(): Promise<string>;
  /** Merge previously exported ignored-findings state into the engine. */
  importIgnored(json: string): Promise<void>;
  /**
   * Drop all ignored findings. The editor calls this when the engine's
   * ignore set belongs to a different document than the one about to be
   * linted — ignores are per-document, but an engine instance may be
   * shared across documents and shells.
   */
  clearIgnored(): Promise<void>;
  /** Switch English dialect. The caller re-lints afterwards. */
  setDialect(dialect: ProofDialect): Promise<void>;
  /** Release engine resources. Further calls reject. */
  dispose(): void;
}

/**
 * Deferred construction. When the shell receives a factory it creates
 * the provider on first activation and disposes it on unmount; a host
 * that passes an instance owns its lifetime (letting one warm engine
 * survive shell remounts).
 */
export type ProofingProviderFactory = () => ProofingProvider;

/** What the `proofing` shell prop accepts. */
export type ProofingCapability = ProofingProvider | ProofingProviderFactory;

/**
 * Identifies the document a set of ignored findings belongs to. Hosts
 * key their storage off whichever field suits them — usually the file
 * path, falling back to the article id for unsaved buffers.
 */
export interface ProofingDocumentRef {
  /** The document's `articleId` (always present; `'untitled'` default). */
  articleId: string;
  /** The document's file name / path, when the host supplied one. */
  fileName?: string;
}

/**
 * Host-owned persistence for dismissed ("Ignore") findings.
 *
 * Ignores are deliberately never written into the document — they are
 * one person's editing preference, and a doc travelling through git
 * shouldn't carry them. Instead the editor hands the state to the host,
 * scoped per document, and the host stores it wherever its user data
 * lives (a settings file, IndexedDB, a per-workspace record keyed by
 * path…). The payload is the engine's OPAQUE export: store it as a
 * string, never parse it.
 *
 * Omit the store and Ignore still works — it just lasts for the
 * session, which is often the right behavior for a scratch buffer.
 */
export interface ProofingIgnoreStore {
  /** Previously saved state for this document, if any. */
  load(doc: ProofingDocumentRef): string | undefined | Promise<string | undefined>;
  /** Persist this document's state. Called after every Ignore. */
  save(doc: ProofingDocumentRef, ignoredJson: string): void | Promise<void>;
}

/** Configuration for {@link createHarperProofingProvider}. */
export interface HarperProofingConfig {
  /**
   * Same-origin URL of harper's WASM binary (the host serves
   * `harper.js/dist/harper_wasm_bg.wasm` itself — see docs/proofing.md).
   * When omitted, the `harper.js/binary` module default is used, which
   * relies on the host bundler resolving the WASM as an asset.
   */
  wasmUrl?: string;
  /** Initial dialect (default American). */
  dialect?: ProofDialect;
  /** App-level dictionary loaded during setup. */
  initialWords?: readonly string[];
  /**
   * Fired when the user adds a word app-wide — persist it host-side.
   * Its absence reports `hasAppDictionary: false`, which hides the
   * "Add to dictionary" menu item.
   *
   * Note the asymmetry with ignores: a dictionary word is app-global
   * (a proper noun is spelled the same everywhere), so it belongs on
   * the engine's config. Ignores are per-document and go through
   * `EditorShell`'s `proofingIgnoreStore` instead.
   */
  onDictionaryWord?: (word: string) => void;
  /**
   * Escape hatch: a preconstructed harper `BinaryModule`. Typed
   * `unknown` so harper types stay out of published declarations
   * (Node tests pass `binaryInlined` here — harper's `file://` loader
   * is broken on Windows).
   */
  binary?: unknown;
}
