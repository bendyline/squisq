/**
 * Lazy, shared Monaco loader.
 *
 * The first subscriber imports Squisq's compact Monaco core and configures the
 * `@monaco-editor/react` singleton. Each caller also names the languages it
 * needs and whether a full code file warrants worker-backed language services.
 * Core, grammar, feature, and service promises are cached across editors.
 */

import { useEffect, useState } from 'react';
import { loader } from '@monaco-editor/react';
import {
  monacoLanguageRequestKey,
  type MonacoLanguageLoadOptions,
  type MonacoLanguageRequest,
} from './monacoLanguageDetection.js';

type SquisqMonacoModule = typeof import('./monaco.js');

let monacoPromise: Promise<SquisqMonacoModule> | null = null;
let monacoSuggestionsPromise: Promise<void> | null = null;
let monacoNamespace: typeof import('monaco-editor') | null = null;
const loadedLanguageProfiles = new Set<string>();

export interface UseMonacoLoaderResult {
  /** The Monaco namespace once loaded, or `null` while the core is in flight. */
  monaco: typeof import('monaco-editor') | null;
  /** True after the compact core and this caller's language profile are ready. */
  ready: boolean;
}

function languagesFromRequestKey(requestKey: string): string[] {
  const separator = requestKey.indexOf(':');
  const languages = separator === -1 ? '' : requestKey.slice(separator + 1);
  return languages ? languages.split(',') : [];
}

async function loadMonacoProfile(
  requestKey: string,
  languageServices: boolean,
): Promise<typeof import('monaco-editor')> {
  const monaco = await loadMonacoModule();

  if (!loadedLanguageProfiles.has(requestKey)) {
    await monaco.loadMonacoLanguages(languagesFromRequestKey(requestKey), { languageServices });
    loadedLanguageProfiles.add(requestKey);
  }
  return monaco;
}

async function loadMonacoModule(): Promise<SquisqMonacoModule> {
  if (!monacoPromise) {
    monacoPromise = import('./monaco.js').then((monaco) => {
      loader.config({ monaco });
      monacoNamespace = monaco;
      return monaco;
    });
  }

  return monacoPromise;
}

/** Start Monaco and the requested language profile before a React editor mounts. */
export function preloadMonaco(
  requestedLanguages: MonacoLanguageRequest = [],
  options: MonacoLanguageLoadOptions = {},
): Promise<typeof import('monaco-editor')> {
  const languageServices = options.languageServices === true;
  const requestKey = monacoLanguageRequestKey(requestedLanguages, { languageServices });
  return loadMonacoProfile(requestKey, languageServices);
}

/** Load completion and snippet UI after the compact editor is already usable. */
export function preloadMonacoSuggestions(): Promise<void> {
  monacoSuggestionsPromise ??= loadMonacoModule()
    .then((monaco) => monaco.loadMonacoSuggestions())
    .catch((error: unknown) => {
      monacoSuggestionsPromise = null;
      throw error;
    });
  return monacoSuggestionsPromise;
}

/** Subscribe to the shared Monaco namespace and a demand-loaded language profile. */
export function useMonacoLoader(
  requestedLanguages: MonacoLanguageRequest = [],
  options: MonacoLanguageLoadOptions = {},
): UseMonacoLoaderResult {
  const languageServices = options.languageServices === true;
  const requestKey = monacoLanguageRequestKey(requestedLanguages, { languageServices });
  const [initialReady, setInitialReady] = useState(
    () => monacoNamespace !== null && loadedLanguageProfiles.has(requestKey),
  );

  useEffect(() => {
    let cancelled = false;
    void loadMonacoProfile(requestKey, languageServices).then(() => {
      if (!cancelled) setInitialReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [languageServices, requestKey]);

  return {
    monaco: monacoNamespace,
    // Once this mounted consumer has completed its first profile, later
    // language additions register in place without unmounting the editor.
    ready: monacoNamespace !== null && initialReady,
  };
}
