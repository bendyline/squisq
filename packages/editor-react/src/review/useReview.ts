/**
 * Review orchestration — the one place that coordinates the providers, the two
 * editor surfaces, and the document.
 *
 * The scheduling itself lives in {@link ReviewRunner}, deliberately outside
 * React so it can be tested against a fake clock. This hook owns only what is
 * genuinely React's: turning the current document into a request, pushing the
 * resulting findings at whichever surface is mounted, and tearing both down.
 *
 * Findings index the markdown SOURCE. That is exactly what Monaco shows, so
 * the Source view draws them directly; the Write view has no published mapping
 * from a source offset back to a ProseMirror position and anchors on the
 * finding's own text instead — see `decorations.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import type { ReviewBlockInput, ReviewFinding } from '@bendyline/squisq/review';
import { useEditorContext } from '../EditorContext';
import { buildReviewRequest, changedBlockKeys } from './buildRequest.js';
import { buildSourceViewDecorations, buildWriteViewDecorations } from './decorations.js';
import { clearReviewDecorations, updateReviewDecorations } from './ReviewExtension.js';
import { ReviewRunner, type ReviewSnapshot } from './runner.js';
import {
  DEFAULT_REVIEW_HUE,
  resolveReviewProvider,
  type ReviewCapability,
  type ReviewHue,
  type ReviewProvider,
} from './types.js';

export interface ReviewState extends ReviewSnapshot {
  /** Run every provider now, skipping the debounce. */
  reviewNow: () => void;
  /** Remove a finding from view without re-running anything. */
  dismissFinding: (findingId: string) => void;
  /** Move the caret to a finding, switching views when it can only be shown there. */
  goToFinding: (findingId: string) => void;
}

const EMPTY: readonly ReviewCapability[] = [];
const EMPTY_FINDINGS: readonly ReviewFinding[] = [];

export function useReview(capabilities: readonly ReviewCapability[] = EMPTY): ReviewState | null {
  const {
    markdownSource,
    activeView,
    tiptapEditor,
    monacoEditor,
    fileName,
    articleId,
    goToBlockByLine,
  } = useEditorContext();

  // Resolve factories once. A provider rebuilt on every render would lose its
  // warm engine and re-run setup continuously.
  const providers = useMemo<ReviewProvider[]>(
    () => capabilities.map(resolveReviewProvider),
    [capabilities],
  );

  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const sourceRef = useRef(markdownSource);
  const revisionRef = useRef(0);
  const blocksRef = useRef<readonly ReviewBlockInput[]>([]);
  const runnerRef = useRef<ReviewRunner | null>(null);

  sourceRef.current = markdownSource;

  const hueFor = useMemo(() => {
    const hues = new Map<string, ReviewHue>(
      providers.map((provider) => [provider.id, provider.hue ?? DEFAULT_REVIEW_HUE]),
    );
    return (source: string): ReviewHue => hues.get(source) ?? DEFAULT_REVIEW_HUE;
  }, [providers]);

  useEffect(() => {
    if (providers.length === 0) {
      setSnapshot(null);
      return;
    }
    const runner = new ReviewRunner({
      providers,
      revision: () => revisionRef.current,
      buildRequest: () => {
        const request = buildReviewRequest({
          source: sourceRef.current,
          documentRef: { articleId, ...(fileName ? { fileName } : {}) },
          language: 'markdown',
        });
        // Diff against the previous pass before recording this one, so a
        // provider can review only what moved.
        const changed = changedBlockKeys(blocksRef.current, request.blocks);
        blocksRef.current = request.blocks;
        return { ...request, changedBlockKeys: changed };
      },
      onChange: setSnapshot,
    });
    runnerRef.current = runner;
    setSnapshot(runner.snapshot());
    return () => {
      runner.dispose();
      runnerRef.current = null;
    };
  }, [providers, articleId, fileName]);

  // Every edit invalidates any pass in flight and schedules the next one.
  useEffect(() => {
    revisionRef.current += 1;
    runnerRef.current?.schedule();
  }, [markdownSource]);

  // Memoized because the `?? []` fallback would otherwise be a fresh array on
  // every render, re-running both decoration effects continuously.
  const findings = useMemo(() => snapshot?.findings ?? EMPTY_FINDINGS, [snapshot]);

  // Write view: anchor on the finding's own text, and only when unambiguous.
  useEffect(() => {
    if (!tiptapEditor || activeView !== 'wysiwyg') return;
    if (findings.length === 0) {
      clearReviewDecorations(tiptapEditor);
      return;
    }
    updateReviewDecorations(
      tiptapEditor,
      buildWriteViewDecorations(tiptapEditor.state.doc, findings, hueFor),
    );
  }, [tiptapEditor, activeView, findings, hueFor]);

  // Source view: offsets map straight through.
  const collectionRef = useRef<MonacoEditorNs.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    if (!monacoEditor || activeView !== 'raw') return;
    const model = monacoEditor.getModel();
    if (!model) return;
    collectionRef.current ??= monacoEditor.createDecorationsCollection([]);
    collectionRef.current.set(buildSourceViewDecorations(model, findings, hueFor));
    return () => {
      collectionRef.current?.clear();
    };
  }, [monacoEditor, activeView, findings, hueFor]);

  const goToFinding = useCallback(
    (findingId: string) => {
      const finding = findings.find((candidate) => candidate.id === findingId);
      if (!finding) return;
      if (finding.blockKey !== undefined) {
        const block = blocksRef.current.find((candidate) => candidate.key === finding.blockKey);
        if (block) goToBlockByLine(block.startLine);
      }
    },
    [findings, goToBlockByLine],
  );

  const reviewNow = useCallback(() => runnerRef.current?.runNow(), []);
  const dismissFinding = useCallback((findingId: string) => {
    runnerRef.current?.removeFinding(findingId);
  }, []);

  return useMemo(
    () => (snapshot ? { ...snapshot, reviewNow, dismissFinding, goToFinding } : null),
    [snapshot, reviewNow, dismissFinding, goToFinding],
  );
}
