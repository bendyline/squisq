/**
 * Proofing orchestration — the one place that coordinates the engine
 * provider, the two editor surfaces, and the doc-level settings.
 *
 * Coordination contract (see docs/proofing.md for the host view):
 *  - findings are PER VIEW: the Write pass lints the Tiptap document's
 *    own text (which differs from the source when wrap-policy unwraps
 *    prose), the Source pass lints `model.getValue()` — never a shared
 *    offset space;
 *  - one debounced (450 ms) single-flight pass at a time, with a dirty
 *    flag coalescing anything that arrives mid-flight into exactly one
 *    trailing pass; stale results (doc changed under the pass) are
 *    discarded — mapped decorations keep tracking edits meanwhile;
 *  - enable state resolves `session override ?? doc frontmatter ??
 *    host default`, and the session override resets whenever the
 *    frontmatter value changes; the host's spelling/grammar category
 *    preferences sit outside that stack — they filter findings, and
 *    turning both off is equivalent to disabling proofing;
 *  - the engine loads only once a markdown doc is actually active with
 *    proofing effective — passing the capability alone fetches nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import {
  blankProtectedSpans,
  buildJoinedText,
  formatProofDictionary,
  mapJoinedSpanToSegment,
  readProofingSettings,
  type ProofDialect,
  type ProofFinding,
} from '@bendyline/squisq/proof';
import { setFrontmatterValues } from '@bendyline/squisq/markdown';
import { PROOF_FRONTMATTER_KEYS } from '@bendyline/squisq/proof';
import { useEditorContext, type EditorView } from '../EditorContext';
import type { ProofingDocumentRef, ProofingProvider } from './types';
import {
  clearTiptapProofingDecorations,
  proofingDecorationAt,
  proofingDecorationById,
  updateTiptapProofingDecorations,
  type TiptapProofDecoration,
} from './ProofingExtension';
import { collectTextblockRuns, resolveRunOffsets } from './writeViewText';
import {
  buildMonacoProofDecorations,
  findingIndexAtPosition,
  proofDecorationOptions,
} from './sourceViewDecorations';

const ATOM_PLACEHOLDER = String.fromCharCode(0);
const LINT_DEBOUNCE_MS = 450;
/** Dwell before the Write view explains a squiggle, matching Monaco's hover feel. */
const HOVER_DELAY_MS = 300;
/**
 * Grace period before a hover card closes once the pointer leaves the
 * squiggle. The card carries buttons, so the pointer has to be able to
 * cross the gap to reach them — every dismissal path is delayed by this
 * except the deliberate ones (a click in the text, a scroll).
 */
const HOVER_CLOSE_DELAY_MS = 260;

/**
 * Which document's ignore set an engine currently holds.
 *
 * Ignored findings are per-document, but an engine instance is often
 * shared — one warm provider across a host's shells, and across every
 * document opened in them. Rather than assume exclusivity, each pass
 * checks whether the engine's ignore set still belongs to the document
 * about to be linted and re-syncs only when it doesn't. With one shell
 * on one document (the common case) this costs a string comparison and
 * no engine calls.
 */
const engineIgnoreOwner = new WeakMap<ProofingProvider, string>();

/** Host preference for which finding tiers are surfaced. */
interface ProofingCategoryFilter {
  spelling: boolean;
  grammar: boolean;
}

/**
 * Whether a finding survives the host's category preferences. `style`
 * rides with `grammar`: both are "the words are spelled right, the
 * writing could be better", and no host has asked to split them.
 */
function categoryEnabled(finding: ProofFinding, filter: ProofingCategoryFilter): boolean {
  return finding.category === 'spelling' ? filter.spelling : filter.grammar;
}

export type ProofingStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProofingMenuAnchor {
  findingId: string;
  x: number;
  y: number;
}

/**
 * A hovered squiggle, anchored on the RECT of its rendered span rather
 * than the pointer — the tooltip should sit under the flagged word, not
 * wherever in it the cursor happened to stop.
 */
export interface ProofingHoverAnchor {
  findingId: string;
  left: number;
  top: number;
  bottom: number;
}

export interface ProofingState {
  status: ProofingStatus;
  errorMessage: string | null;
  /** Effective enable state (session ?? frontmatter ?? host default). */
  enabled: boolean;
  /** Flip the session override (View menu toggle). */
  setEnabled: (enabled: boolean) => void;
  panelVisible: boolean;
  setPanelVisible: (visible: boolean) => void;
  /** Findings of the most recent pass, in document order. */
  findings: ProofFinding[];
  /** Which view the findings belong to. */
  findingsView: EditorView;
  activeFindingId: string | null;
  /** Jump the editor to a finding and mark it active. */
  selectFinding: (findingId: string) => void;
  nextFinding: () => void;
  prevFinding: () => void;
  applySuggestion: (findingId: string, suggestionIndex: number) => void;
  ignoreFinding: (findingId: string) => void;
  /**
   * Accept the word app-wide — handed to the host's dictionary storage
   * via the provider. Writes nothing to the document.
   */
  addToAppDictionary: (findingId: string) => void;
  /**
   * Accept the word for THIS document only, by appending it to the
   * doc's `squisq-proof-dictionary` frontmatter. Kept separate from the
   * app dictionary so authors always know when a word is being tracked
   * inside the file itself.
   */
  addToDocWordList: (findingId: string) => void;
  /** False when the host wired no app-level dictionary storage. */
  canAddToAppDictionary: boolean;
  /** Open the suggestions menu at client coordinates. */
  openMenu: (anchor: ProofingMenuAnchor) => void;
  closeMenu: () => void;
  menuAnchor: ProofingMenuAnchor | null;
  /** The squiggle currently explained by the hover card, if any. */
  hoverAnchor: ProofingHoverAnchor | null;
  closeHover: () => void;
  /**
   * The pointer entered the hover card — cancel the close armed when it
   * left the squiggle. Without this pair the card could not be clicked:
   * reaching for a button would dismiss it.
   */
  holdHover: () => void;
  /** The pointer left the hover card — close it after the grace period. */
  releaseHover: () => void;
  /** Retry a failed engine load. */
  retrySetup: () => void;
}

/**
 * Null when the host injected no proofing capability — every proofing
 * surface renders nothing in that case.
 */
export function useProofing(): ProofingState | null {
  const {
    proofing,
    proofingDefaultEnabled,
    proofingSpellingEnabled,
    proofingGrammarEnabled,
    proofingIgnoreStore,
    articleId,
    fileName,
    markdownSource,
    setMarkdownSource,
    markdownDoc,
    activeView,
    editorMode,
    tiptapEditor,
    monacoEditor,
    versioning,
    saveVersion,
  } = useEditorContext();

  const [status, setStatus] = useState<ProofingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionEnabled, setSessionEnabled] = useState<boolean | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [findings, setFindings] = useState<ProofFinding[]>([]);
  const [findingsView, setFindingsView] = useState<EditorView>('wysiwyg');
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<ProofingMenuAnchor | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<ProofingHoverAnchor | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const providerRef = useRef<ProofingProvider | null>(null);
  const ownedRef = useRef(false);
  const statusRef = useRef<ProofingStatus>('idle');
  statusRef.current = status;

  const debounceRef = useRef<number | undefined>(undefined);
  const passIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const collectionRef = useRef<MonacoEditorNs.IEditorDecorationsCollection | null>(null);
  const sourceOrderRef = useRef<string[]>([]);
  const lastWriteDecorationsRef = useRef<TiptapProofDecoration[]>([]);

  // Hover-card lifecycle. Held at hook scope rather than inside the
  // tracking effect because the card itself steers it: entering the card
  // cancels the pending close, leaving it re-arms one.
  const hoverOpenTimerRef = useRef<number | undefined>(undefined);
  const hoverCloseTimerRef = useRef<number | undefined>(undefined);
  const hoveredFindingRef = useRef<string | null>(null);
  const hoverHeldRef = useRef(false);

  // ── Settings & effective enable ─────────────────────────────────────
  const settings = useMemo(() => readProofingSettings(markdownDoc?.frontmatter), [markdownDoc]);
  // Both categories off is the same as off: no engine loads, nothing is
  // linted. It is a host preference, so it sits outside the
  // session/frontmatter/host-default stack rather than inside it.
  const anyCategoryEnabled = proofingSpellingEnabled || proofingGrammarEnabled;
  const enabled =
    proofing != null &&
    editorMode === 'markdown' &&
    anyCategoryEnabled &&
    (sessionEnabled ?? settings.enabled ?? proofingDefaultEnabled);

  // A Document Settings save must not be masked by a stale session toggle.
  const frontmatterEnabled = settings.enabled;
  useEffect(() => {
    setSessionEnabled(null);
  }, [frontmatterEnabled]);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Read inside the pass (which holds no reactive deps of its own), so a
  // preference flip takes effect on the re-lint the effect below schedules.
  const categoriesRef = useRef<ProofingCategoryFilter>({
    spelling: proofingSpellingEnabled,
    grammar: proofingGrammarEnabled,
  });
  categoriesRef.current = { spelling: proofingSpellingEnabled, grammar: proofingGrammarEnabled };
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const tiptapRef = useRef(tiptapEditor);
  tiptapRef.current = tiptapEditor;
  const monacoRef = useRef(monacoEditor);
  monacoRef.current = monacoEditor;

  const resolveProvider = useCallback((): ProofingProvider | null => {
    if (!proofing) return null;
    if (!providerRef.current) {
      if (typeof proofing === 'function') {
        providerRef.current = proofing();
        ownedRef.current = true;
      } else {
        providerRef.current = proofing;
        ownedRef.current = false;
      }
    }
    return providerRef.current;
  }, [proofing]);

  // ── Document-scoped ignore state ────────────────────────────────────
  const documentRef = useMemo<ProofingDocumentRef>(
    () => ({ articleId, fileName }),
    [articleId, fileName],
  );
  const documentKey = `${articleId} ${fileName ?? ''}`;
  const documentRefRef = useRef(documentRef);
  documentRefRef.current = documentRef;
  const documentKeyRef = useRef(documentKey);
  documentKeyRef.current = documentKey;
  const ignoreStoreRef = useRef(proofingIgnoreStore);
  ignoreStoreRef.current = proofingIgnoreStore;

  /**
   * Make the engine's ignore set match the active document. A no-op
   * when it already does; otherwise clears whatever the previous
   * document left behind and loads this one's state from the host.
   */
  const syncIgnoredState = useCallback(async (): Promise<void> => {
    const provider = providerRef.current;
    if (!provider) return;
    const key = documentKeyRef.current;
    if (engineIgnoreOwner.get(provider) === key) return;
    // Claim ownership before awaiting so a concurrent pass doesn't
    // duplicate the work.
    engineIgnoreOwner.set(provider, key);
    try {
      await provider.clearIgnored();
      const saved = await ignoreStoreRef.current?.load(documentRefRef.current);
      if (saved) await provider.importIgnored(saved);
    } catch (err: unknown) {
      // A failed sync must not wedge the feature — findings simply
      // show up un-ignored. Drop ownership so the next pass retries.
      engineIgnoreOwner.delete(provider);
      console.warn(
        'squisq proofing: could not restore ignored findings',
        err instanceof Error ? err.message : err,
      );
    }
  }, []);
  const syncIgnoredStateRef = useRef(syncIgnoredState);
  syncIgnoredStateRef.current = syncIgnoredState;

  // ── Clearing ────────────────────────────────────────────────────────
  const clearDecorations = useCallback(() => {
    const editor = tiptapRef.current;
    if (editor && !editor.isDestroyed) clearTiptapProofingDecorations(editor);
    collectionRef.current?.clear();
    sourceOrderRef.current = [];
    lastWriteDecorationsRef.current = [];
  }, []);

  // ── The lint pass ───────────────────────────────────────────────────
  const runPass = useCallback(async (): Promise<void> => {
    const provider = providerRef.current;
    if (!provider || statusRef.current !== 'ready' || !enabledRef.current) return;
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    inFlightRef.current = true;
    const passId = ++passIdRef.current;

    try {
      // Cheap when the engine already holds this document's ignores.
      await syncIgnoredStateRef.current();
      if (passId !== passIdRef.current) return;
      const view = activeViewRef.current;
      if (view === 'wysiwyg') {
        const editor = tiptapRef.current;
        if (!editor || editor.isDestroyed) return;
        const docSnapshot = editor.state.doc;
        const runs = collectTextblockRuns(docSnapshot);
        const blankedRuns = runs.map((run) => blankProtectedSpans(run.text));
        const joined = buildJoinedText(blankedRuns.map((blanked) => blanked.text));
        const results = await provider.lint(joined.text, { language: 'plaintext' });
        if (passId !== passIdRef.current) return;
        if (editor.isDestroyed) return;
        if (editor.state.doc !== docSnapshot) {
          dirtyRef.current = true;
          return;
        }
        const decorated: TiptapProofDecoration[] = [];
        const kept: ProofFinding[] = [];
        for (const finding of results) {
          if (!categoryEnabled(finding, categoriesRef.current)) continue;
          const segment = mapJoinedSpanToSegment(joined, finding.start, finding.end);
          if (!segment) continue;
          const blanked = blankedRuns[segment.segmentIndex].blanked;
          if (blanked.some((r) => segment.start < r.end && segment.end > r.start)) continue;
          if (finding.originalText.includes(ATOM_PLACEHOLDER)) continue;
          const range = resolveRunOffsets(runs[segment.segmentIndex], segment.start, segment.end);
          if (!range) continue;
          decorated.push({
            findingId: finding.id,
            from: range.from,
            to: range.to,
            category: finding.category,
          });
          kept.push(finding);
        }
        lastWriteDecorationsRef.current = decorated;
        updateTiptapProofingDecorations(editor, decorated);
        setFindings(kept);
        setFindingsView('wysiwyg');
      } else if (view === 'raw') {
        const editor = monacoRef.current;
        const model = editor?.getModel();
        if (!editor || !model) return;
        const versionId = model.getVersionId();
        const source = model.getValue();
        const { text: blankedText, blanked } = blankProtectedSpans(source);
        const results = await provider.lint(blankedText, { language: 'markdown' });
        if (passId !== passIdRef.current) return;
        if (monacoRef.current !== editor || editor.getModel() !== model) return;
        if (model.getVersionId() !== versionId) {
          dirtyRef.current = true;
          return;
        }
        const kept = results.filter(
          (finding) =>
            categoryEnabled(finding, categoriesRef.current) &&
            !blanked.some((r) => finding.start < r.end && finding.end > r.start),
        );
        if (!collectionRef.current) {
          collectionRef.current = editor.createDecorationsCollection([]);
        }
        collectionRef.current.set(buildMonacoProofDecorations(model, kept));
        sourceOrderRef.current = kept.map((finding) => finding.id);
        setFindings(kept);
        setFindingsView('raw');
      }
    } catch (err: unknown) {
      if (passId === passIdRef.current) {
        console.warn('squisq proofing: lint pass failed', err instanceof Error ? err.message : err);
      }
    } finally {
      inFlightRef.current = false;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        window.setTimeout(() => void runPass(), 0);
      }
    }
  }, []);

  const schedule = useCallback(
    (mode: 'debounced' | 'immediate') => {
      window.clearTimeout(debounceRef.current);
      if (mode === 'immediate') {
        void runPass();
      } else {
        debounceRef.current = window.setTimeout(() => void runPass(), LINT_DEBOUNCE_MS);
      }
    },
    [runPass],
  );

  // ── Activation: load the engine once actually needed ────────────────
  // Gated on the parsed doc existing so the doc's own settings (a
  // `squisq-proofing: false` opt-out, dialect, dictionary) are KNOWN
  // before any engine bytes load — the initial parse runs on mount, so
  // this costs nothing for a real doc and correctly stays idle for an
  // empty composer.
  const settingsKnown = markdownDoc != null;
  useEffect(() => {
    if (!enabled || !settingsKnown) return;
    if (statusRef.current === 'ready') return;
    const provider = resolveProvider();
    if (!provider) return;
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);
    provider
      .setup()
      .then(async () => {
        if (cancelled) return;
        if (settings.dictionary.length > 0) await provider.addWords(settings.dictionary);
        if (settings.dialect) await provider.setDialect(settings.dialect);
        // Ignored findings come from the host store, keyed by document —
        // never from the doc itself. `syncIgnoredState` handles the load
        // (and the re-load when the engine is shared with another doc).
        await syncIgnoredStateRef.current();
        if (cancelled) return;
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // settings.* is deliberately not a dependency: the initial import uses
    // whatever the doc says at load time; later changes are synced by the
    // dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, settingsKnown, resolveProvider, retryNonce]);

  // First pass the moment the engine becomes ready.
  useEffect(() => {
    if (status === 'ready' && enabled) schedule('immediate');
  }, [status, enabled, schedule]);

  // A category preference flip re-lints from scratch: the previous pass's
  // squiggles belong to the old filter, so they go before the new pass runs.
  const categoryKey = `${proofingSpellingEnabled}:${proofingGrammarEnabled}`;
  const prevCategoryKeyRef = useRef(categoryKey);
  useEffect(() => {
    if (prevCategoryKeyRef.current === categoryKey) return;
    prevCategoryKeyRef.current = categoryKey;
    clearDecorations();
    setFindings([]);
    setActiveFindingId(null);
    if (status === 'ready' && enabled) schedule('immediate');
  }, [categoryKey, status, enabled, schedule, clearDecorations]);

  // ── Invalidation: source edits re-lint (both views write through
  // markdownSource synchronously), view switches re-lint immediately. ──
  const prevViewRef = useRef(activeView);
  useEffect(() => {
    if (status !== 'ready' || !enabled) return;
    const viewChanged = prevViewRef.current !== activeView;
    prevViewRef.current = activeView;
    if (activeView !== 'wysiwyg' && activeView !== 'raw') return;
    if (viewChanged) {
      clearDecorations();
      setFindings([]);
      setActiveFindingId(null);
      schedule('immediate');
    } else {
      schedule('debounced');
    }
  }, [markdownSource, activeView, status, enabled, schedule, clearDecorations]);

  // A fresh Monaco instance means the old decorations collection is gone.
  useEffect(() => {
    collectionRef.current = null;
    sourceOrderRef.current = [];
    if (status === 'ready' && enabled && activeView === 'raw' && monacoEditor) {
      schedule('immediate');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monacoEditor]);

  // ── Doc-settings sync while ready ───────────────────────────────────
  const dictionaryKey = settings.dictionary.join('\n');
  const syncedDictionaryRef = useRef(dictionaryKey);
  useEffect(() => {
    if (status !== 'ready' || dictionaryKey === syncedDictionaryRef.current) return;
    syncedDictionaryRef.current = dictionaryKey;
    const provider = providerRef.current;
    if (!provider || settings.dictionary.length === 0) return;
    void provider
      .addWords(settings.dictionary)
      .then(() => schedule('immediate'))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictionaryKey, status]);

  const syncedDialectRef = useRef<ProofDialect | undefined>(settings.dialect);
  useEffect(() => {
    if (status !== 'ready' || settings.dialect === syncedDialectRef.current) return;
    syncedDialectRef.current = settings.dialect;
    const provider = providerRef.current;
    if (!provider || !settings.dialect) return;
    void provider
      .setDialect(settings.dialect)
      .then(() => schedule('immediate'))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.dialect, status]);

  // ── Disable / teardown ──────────────────────────────────────────────
  useEffect(() => {
    if (enabled) return;
    window.clearTimeout(debounceRef.current);
    passIdRef.current += 1; // orphan any in-flight pass
    dirtyRef.current = false;
    clearDecorations();
    setFindings([]);
    setActiveFindingId(null);
    setMenuAnchor(null);
  }, [enabled, clearDecorations]);

  useEffect(
    () => () => {
      window.clearTimeout(debounceRef.current);
      passIdRef.current += 1;
      if (ownedRef.current) providerRef.current?.dispose();
    },
    [],
  );

  // ── Chrome's native spellcheck is redundant once ours is live ───────
  useEffect(() => {
    if (!tiptapEditor || tiptapEditor.isDestroyed) return;
    const dom = tiptapEditor.view.dom;
    if (enabled && status === 'ready') {
      dom.setAttribute('spellcheck', 'false');
      return () => dom.removeAttribute('spellcheck');
    }
    return undefined;
  }, [tiptapEditor, enabled, status]);

  // ── Context-menu triggering (right-click / menu key on a squiggle) ──
  const openMenuRef = useRef<(anchor: ProofingMenuAnchor) => void>(() => undefined);
  useEffect(() => {
    if (!enabled || status !== 'ready') return;
    const editor = tiptapEditor;
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const onContextMenu = (event: MouseEvent) => {
      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!pos) return;
      const hit = proofingDecorationAt(editor.state, pos.pos);
      if (!hit) return;
      event.preventDefault();
      openMenuRef.current({ findingId: hit.findingId, x: event.clientX, y: event.clientY });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const head = editor.state.selection.head;
      const hit = proofingDecorationAt(editor.state, head);
      if (!hit) return;
      event.preventDefault();
      const coords = editor.view.coordsAtPos(head);
      openMenuRef.current({ findingId: hit.findingId, x: coords.left, y: coords.bottom });
    };
    dom.addEventListener('contextmenu', onContextMenu);
    dom.addEventListener('keydown', onKeyDown);
    return () => {
      dom.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('keydown', onKeyDown);
    };
  }, [tiptapEditor, enabled, status]);

  // ── Hover card (Write view) ─────────────────────────────────────────
  // The Source view gets this from Monaco's own hover card (see
  // `proofDecorationOptions`); ProseMirror has no equivalent, so the
  // squiggle spans are tracked directly. Hit-testing reads the
  // decoration's `data-proof-id` attribute instead of `posAtCoords`,
  // which snaps to the NEAREST position and would pop a card for a word
  // the pointer is merely beside.
  //
  // The card is interactive, so leaving the squiggle only ARMS a close:
  // the pointer needs time to cross the gap, and `holdHover` (fired by
  // the card's own pointer-enter) cancels the pending close when it
  // lands. Only a click in the text or a scroll dismisses immediately.
  const cancelHoverTimers = useCallback(() => {
    if (hoverOpenTimerRef.current !== undefined) window.clearTimeout(hoverOpenTimerRef.current);
    if (hoverCloseTimerRef.current !== undefined) window.clearTimeout(hoverCloseTimerRef.current);
    hoverOpenTimerRef.current = undefined;
    hoverCloseTimerRef.current = undefined;
  }, []);

  const closeHover = useCallback(() => {
    cancelHoverTimers();
    hoveredFindingRef.current = null;
    hoverHeldRef.current = false;
    setHoverAnchor(null);
  }, [cancelHoverTimers]);

  const scheduleHoverClose = useCallback(() => {
    if (hoverOpenTimerRef.current !== undefined) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = undefined;
    }
    if (hoverCloseTimerRef.current !== undefined) window.clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = undefined;
      // The pointer reached the card during the grace period — it now
      // owns the lifecycle until `releaseHover`.
      if (hoverHeldRef.current) return;
      hoveredFindingRef.current = null;
      setHoverAnchor(null);
    }, HOVER_CLOSE_DELAY_MS);
  }, []);

  /** The pointer is over the card — keep it up. */
  const holdHover = useCallback(() => {
    hoverHeldRef.current = true;
    if (hoverCloseTimerRef.current !== undefined) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = undefined;
    }
  }, []);

  /** The pointer left the card — close it after the same grace period. */
  const releaseHover = useCallback(() => {
    hoverHeldRef.current = false;
    scheduleHoverClose();
  }, [scheduleHoverClose]);

  useEffect(() => {
    if (!enabled || status !== 'ready') return;
    const editor = tiptapEditor;
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;

    const onMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const span = target?.closest?.('[data-proof-id]') as HTMLElement | null;
      const findingId = span?.getAttribute('data-proof-id') ?? null;
      if (!span || !findingId) {
        if (hoveredFindingRef.current !== null) scheduleHoverClose();
        return;
      }
      // Same squiggle — the card (or its pending open) stays, and a
      // close armed by a brief excursion off the word is called off.
      if (findingId === hoveredFindingRef.current) {
        if (hoverCloseTimerRef.current !== undefined) {
          window.clearTimeout(hoverCloseTimerRef.current);
          hoverCloseTimerRef.current = undefined;
        }
        return;
      }
      cancelHoverTimers();
      hoverHeldRef.current = false;
      hoveredFindingRef.current = findingId;
      setHoverAnchor(null);
      hoverOpenTimerRef.current = window.setTimeout(() => {
        hoverOpenTimerRef.current = undefined;
        const rect = span.getBoundingClientRect();
        setHoverAnchor({ findingId, left: rect.left, top: rect.top, bottom: rect.bottom });
      }, HOVER_DELAY_MS);
    };

    // Leaving the editor is how the pointer REACHES a card sitting below
    // the text, so it arms the close rather than performing it.
    const onMouseLeave = () => {
      if (hoveredFindingRef.current !== null) scheduleHoverClose();
    };

    dom.addEventListener('mousemove', onMouseMove);
    dom.addEventListener('mouseleave', onMouseLeave);
    dom.addEventListener('mousedown', closeHover);
    window.addEventListener('scroll', closeHover, true);
    return () => {
      dom.removeEventListener('mousemove', onMouseMove);
      dom.removeEventListener('mouseleave', onMouseLeave);
      dom.removeEventListener('mousedown', closeHover);
      window.removeEventListener('scroll', closeHover, true);
      closeHover();
    };
  }, [tiptapEditor, enabled, status, cancelHoverTimers, closeHover, scheduleHoverClose]);

  useEffect(() => {
    if (!enabled || status !== 'ready') return;
    const editor = monacoEditor;
    const dom = editor?.getDomNode();
    if (!editor || !dom) return;
    const findingAt = (position: { lineNumber: number; column: number }): string | null => {
      const collection = collectionRef.current;
      if (!collection) return null;
      const index = findingIndexAtPosition(collection, sourceOrderRef.current.length, position);
      return index === null ? null : (sourceOrderRef.current[index] ?? null);
    };
    // Capture phase so we win against Monaco's own context-menu listener
    // when (and only when) the click lands on a squiggle.
    const onContextMenu = (event: MouseEvent) => {
      const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
      const position = target?.position;
      if (!position) return;
      const findingId = findingAt(position);
      if (!findingId) return;
      event.preventDefault();
      event.stopPropagation();
      openMenuRef.current({ findingId, x: event.clientX, y: event.clientY });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const position = editor.getPosition();
      if (!position) return;
      const findingId = findingAt(position);
      if (!findingId) return;
      event.preventDefault();
      event.stopPropagation();
      const visible = editor.getScrolledVisiblePosition(position);
      const rect = dom.getBoundingClientRect();
      openMenuRef.current({
        findingId,
        x: rect.left + (visible?.left ?? 0),
        y: rect.top + (visible?.top ?? 0) + (visible?.height ?? 16),
      });
    };
    dom.addEventListener('contextmenu', onContextMenu, true);
    dom.addEventListener('keydown', onKeyDown, true);
    return () => {
      dom.removeEventListener('contextmenu', onContextMenu, true);
      dom.removeEventListener('keydown', onKeyDown, true);
    };
  }, [monacoEditor, enabled, status]);

  // ── Actions ─────────────────────────────────────────────────────────
  const findingById = useCallback(
    (findingId: string) => findings.find((finding) => finding.id === findingId) ?? null,
    [findings],
  );

  const findingsRef = useRef<ProofFinding[]>([]);
  findingsRef.current = findings;

  const removeFindingLocally = useCallback((findingId: string) => {
    const remaining = findingsRef.current.filter((finding) => finding.id !== findingId);
    setFindings(remaining);
    setActiveFindingId((current) => (current === findingId ? null : current));
    setMenuAnchor((current) => (current?.findingId === findingId ? null : current));

    // Write view: drop just this squiggle, re-dispatching the survivors
    // at their CURRENT mapped positions (stale lint-time positions would
    // misplace them after edits).
    const editor = tiptapRef.current;
    if (
      editor &&
      !editor.isDestroyed &&
      lastWriteDecorationsRef.current.some((decoration) => decoration.findingId === findingId)
    ) {
      const survivors: TiptapProofDecoration[] = [];
      for (const decoration of lastWriteDecorationsRef.current) {
        if (decoration.findingId === findingId) continue;
        const live = proofingDecorationById(editor.state, decoration.findingId);
        if (live) {
          survivors.push({
            findingId: live.findingId,
            from: live.from,
            to: live.to,
            category: live.category,
          });
        }
      }
      lastWriteDecorationsRef.current = survivors;
      updateTiptapProofingDecorations(editor, survivors);
    }

    // Source view: rebuild the collection from its current (shifted)
    // ranges, minus the removed finding.
    const collection = collectionRef.current;
    const index = sourceOrderRef.current.indexOf(findingId);
    if (collection && index >= 0) {
      const byId = new Map(remaining.map((finding) => [finding.id, finding]));
      const entries: {
        finding: ProofFinding;
        range: MonacoEditorNs.IModelDeltaDecoration['range'];
      }[] = [];
      sourceOrderRef.current.forEach((id, i) => {
        const finding = byId.get(id);
        const range = collection.getRange(i);
        if (id !== findingId && finding && range) entries.push({ finding, range });
      });
      sourceOrderRef.current = entries.map((entry) => entry.finding.id);
      collection.set(
        entries.map((entry) => ({
          range: entry.range,
          options: proofDecorationOptions(entry.finding),
        })),
      );
    }
  }, []);

  const snapshotVersion = useCallback(() => {
    if (!versioning) return;
    saveVersion({ content: markdownSource }).catch(() => {
      // Snapshot is advisory — the edit itself stays undoable.
    });
  }, [versioning, saveVersion, markdownSource]);

  const applySuggestion = useCallback(
    (findingId: string, suggestionIndex: number) => {
      const finding = findingById(findingId);
      const suggestion = finding?.suggestions[suggestionIndex];
      if (!finding || !suggestion) return;
      snapshotVersion();

      if (findingsView === 'wysiwyg') {
        const editor = tiptapRef.current;
        if (!editor || editor.isDestroyed) return;
        const live = proofingDecorationById(editor.state, findingId);
        if (!live) {
          schedule('immediate');
          return;
        }
        const current = editor.state.doc.textBetween(
          live.from,
          live.to,
          ATOM_PLACEHOLDER,
          ATOM_PLACEHOLDER,
        );
        if (current !== finding.originalText) {
          schedule('immediate');
          return;
        }
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            if (suggestion.kind === 'remove') tr.delete(live.from, live.to);
            else if (suggestion.kind === 'insertAfter')
              tr.insertText(suggestion.text, live.to, live.to);
            else tr.insertText(suggestion.text, live.from, live.to);
            return true;
          })
          .run();
        removeFindingLocally(findingId);
      } else if (findingsView === 'raw') {
        const editor = monacoRef.current;
        const model = editor?.getModel();
        const collection = collectionRef.current;
        const index = sourceOrderRef.current.indexOf(findingId);
        if (!editor || !model || !collection || index < 0) return;
        const range = collection.getRange(index);
        if (!range) {
          schedule('immediate');
          return;
        }
        if (model.getValueInRange(range) !== finding.originalText) {
          schedule('immediate');
          return;
        }
        const edit =
          suggestion.kind === 'insertAfter'
            ? {
                range: {
                  startLineNumber: range.endLineNumber,
                  startColumn: range.endColumn,
                  endLineNumber: range.endLineNumber,
                  endColumn: range.endColumn,
                },
                text: suggestion.text,
              }
            : {
                range,
                text: suggestion.kind === 'remove' ? '' : suggestion.text,
              };
        editor.pushUndoStop();
        editor.executeEdits('squisq-proofing', [edit]);
        editor.pushUndoStop();
        editor.focus();
        removeFindingLocally(findingId);
      }
    },
    [findingById, findingsView, snapshotVersion, schedule, removeFindingLocally],
  );

  const ignoreFinding = useCallback(
    (findingId: string) => {
      const provider = providerRef.current;
      if (!provider || !findingById(findingId)) return;
      void provider
        .ignoreFinding(findingId)
        .then(() => provider.exportIgnored())
        .then(async (json) => {
          removeFindingLocally(findingId);
          // The engine now holds THIS document's ignore set — record
          // that so a later pass doesn't needlessly re-sync.
          engineIgnoreOwner.set(provider, documentKeyRef.current);
          // Nothing is written to the document: a dismissal is one
          // person's preference, so it goes to the host's storage
          // scoped by document ref, or nowhere at all.
          await ignoreStoreRef.current?.save(documentRefRef.current, json);
          schedule('immediate');
        })
        .catch((err: unknown) => {
          console.warn('squisq proofing: ignore failed', err instanceof Error ? err.message : err);
        });
    },
    [findingById, removeFindingLocally, schedule],
  );

  /** The trimmed word a finding covers, or null when it isn't one. */
  const findingWord = useCallback(
    (findingId: string): string | null => {
      const word = findingById(findingId)?.originalText.trim();
      return word ? word : null;
    },
    [findingById],
  );

  const addToAppDictionary = useCallback(
    (findingId: string) => {
      const provider = providerRef.current;
      const word = findingWord(findingId);
      if (!provider || !word) return;
      // `addWord` is the app-scoped door: it fires the host's
      // `onDictionaryWord`. Nothing is written to the document.
      void provider
        .addWord(word)
        .then(() => {
          removeFindingLocally(findingId);
          schedule('immediate');
        })
        .catch((err: unknown) => {
          console.warn(
            'squisq proofing: add-to-dictionary failed',
            err instanceof Error ? err.message : err,
          );
        });
    },
    [findingWord, removeFindingLocally, schedule],
  );

  const addToDocWordList = useCallback(
    (findingId: string) => {
      const provider = providerRef.current;
      const word = findingWord(findingId);
      if (!provider || !word) return;
      // `addWords` accepts the word for this session WITHOUT notifying
      // the host — the document's frontmatter is the store of record,
      // and the dictionary-sync effect re-imports it after the reparse.
      void provider
        .addWords([word])
        .then(() => {
          removeFindingLocally(findingId);
          setMarkdownSource(
            setFrontmatterValues(markdownSource, {
              [PROOF_FRONTMATTER_KEYS.dictionary.canonical]: formatProofDictionary([
                ...settings.dictionary,
                word,
              ]),
            }),
          );
          schedule('immediate');
        })
        .catch((err: unknown) => {
          console.warn(
            'squisq proofing: add-to-doc-word-list failed',
            err instanceof Error ? err.message : err,
          );
        });
    },
    [
      findingWord,
      removeFindingLocally,
      setMarkdownSource,
      markdownSource,
      settings.dictionary,
      schedule,
    ],
  );

  const selectFinding = useCallback(
    (findingId: string) => {
      setActiveFindingId(findingId);
      if (findingsView === 'wysiwyg') {
        const editor = tiptapRef.current;
        if (!editor || editor.isDestroyed) return;
        const live = proofingDecorationById(editor.state, findingId);
        if (!live) return;
        editor
          .chain()
          .focus()
          .setTextSelection({ from: live.from, to: live.to })
          .scrollIntoView()
          .run();
      } else if (findingsView === 'raw') {
        const editor = monacoRef.current;
        const collection = collectionRef.current;
        const index = sourceOrderRef.current.indexOf(findingId);
        if (!editor || !collection || index < 0) return;
        const range = collection.getRange(index);
        if (!range) return;
        editor.revealRangeInCenter(range);
        editor.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn });
        editor.focus();
      }
    },
    [findingsView],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (findings.length === 0) return;
      const currentIndex = findings.findIndex((finding) => finding.id === activeFindingId);
      const nextIndex =
        currentIndex < 0
          ? direction === 1
            ? 0
            : findings.length - 1
          : (currentIndex + direction + findings.length) % findings.length;
      selectFinding(findings[nextIndex].id);
    },
    [findings, activeFindingId, selectFinding],
  );

  const setEnabled = useCallback((next: boolean) => setSessionEnabled(next), []);
  const retrySetup = useCallback(() => {
    setStatus('idle');
    setRetryNonce((nonce) => nonce + 1);
  }, []);
  const openMenu = useCallback(
    (anchor: ProofingMenuAnchor) => {
      // The menu supersedes the hover card: it says everything the card
      // does, plus the actions that did not fit on it.
      closeHover();
      setMenuAnchor(anchor);
    },
    [closeHover],
  );
  openMenuRef.current = openMenu;
  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  // A factory capability has no instance until activation, so fall back
  // to the capability itself when it is already an instance and assume
  // "capable" otherwise — better to show the item and have it work than
  // to reveal it partway through loading. `status` drives the recompute.
  const capabilityInstance =
    providerRef.current ?? (typeof proofing === 'function' ? null : proofing);
  const canAddToAppDictionary = capabilityInstance?.hasAppDictionary !== false;

  return useMemo<ProofingState | null>(() => {
    // No capability, or every category switched off: the same absence.
    // The View-menu toggle, status segment and panel all key off this, so
    // returning state here would leave a toggle that cannot toggle.
    if (!proofing || !anyCategoryEnabled) return null;
    return {
      status,
      errorMessage,
      enabled,
      setEnabled,
      panelVisible,
      setPanelVisible,
      findings,
      findingsView,
      activeFindingId,
      selectFinding,
      nextFinding: () => step(1),
      prevFinding: () => step(-1),
      applySuggestion,
      ignoreFinding,
      addToAppDictionary,
      addToDocWordList,
      canAddToAppDictionary,
      openMenu,
      closeMenu,
      menuAnchor,
      hoverAnchor,
      closeHover,
      holdHover,
      releaseHover,
      retrySetup,
    };
  }, [
    proofing,
    anyCategoryEnabled,
    status,
    errorMessage,
    enabled,
    setEnabled,
    panelVisible,
    findings,
    findingsView,
    activeFindingId,
    selectFinding,
    step,
    applySuggestion,
    ignoreFinding,
    addToAppDictionary,
    addToDocWordList,
    canAddToAppDictionary,
    openMenu,
    closeMenu,
    menuAnchor,
    hoverAnchor,
    closeHover,
    holdHover,
    releaseHover,
    retrySetup,
  ]);
}
