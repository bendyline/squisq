/**
 * Site proofing provider — the reference host wiring for the
 * `EditorShell` `proofing` capability (the proofing analog of
 * `ffmpegWasmConfig.ts`).
 *
 * A module-scope SINGLETON instance (not a factory) is deliberate: the
 * shell remounts on every sample switch (`key=`), and a host-owned
 * instance keeps the warm engine (~5s cold WASM setup) alive across
 * remounts. The site owns disposal, which for a demo page is "never".
 *
 * The app-level dictionary persists in localStorage so "Add to
 * dictionary" sticks across visits; per-doc words still ride each doc's
 * own `squisq-proof-dictionary` frontmatter.
 */

import { createHarperProofingProvider } from '@bendyline/squisq-editor-react';
import type { ProofingDocumentRef, ProofingIgnoreStore } from '@bendyline/squisq-editor-react';

const DICTIONARY_STORAGE_KEY = 'squisq:proof-dictionary';

function readLocalDictionary(): string[] {
  try {
    const raw = localStorage.getItem(DICTIONARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

function appendLocalDictionary(word: string): void {
  try {
    const words = new Set(readLocalDictionary());
    words.add(word);
    localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify([...words]));
  } catch {
    // Private mode / storage denied — the word still applies this session.
  }
}

export const siteProofingProvider = createHarperProofingProvider({
  wasmUrl: `${import.meta.env.BASE_URL}harper/harper_wasm_bg.wasm`,
  initialWords: readLocalDictionary(),
  onDictionaryWord: appendLocalDictionary,
});

const IGNORE_STORAGE_KEY = 'squisq:proof-ignored';

/**
 * Reference per-document ignore storage.
 *
 * Dismissed findings never go into the document, so the host keeps them
 * — here as one localStorage record of `{ [documentKey]: opaqueJson }`.
 * A real host would key by workspace-relative file path and put this
 * wherever its user data lives. The payload is the engine's opaque
 * export: stored and returned verbatim, never parsed.
 */
function documentKey(doc: ProofingDocumentRef): string {
  return doc.fileName ?? doc.articleId;
}

function readIgnoreRecord(): Record<string, string> {
  try {
    const raw = localStorage.getItem(IGNORE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export const siteProofingIgnoreStore: ProofingIgnoreStore = {
  load(doc) {
    return readIgnoreRecord()[documentKey(doc)];
  },
  save(doc, ignoredJson) {
    try {
      const record = readIgnoreRecord();
      record[documentKey(doc)] = ignoredJson;
      localStorage.setItem(IGNORE_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Private mode / storage denied — the dismissal still holds for
      // the rest of the session.
    }
  },
};
