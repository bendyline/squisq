/** Printable renditions for every Use mode. */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  BlockRenderer,
  FlashcardFaceView,
  LinearDocView,
  useDocPlayback,
  useMediaProvider,
  type DisplayMode,
} from '@bendyline/squisq-react';
import {
  createTemplateContext,
  type Doc,
  type Theme,
  type ViewportConfig,
} from '@bendyline/squisq/schemas';
import { expandCoverBlock, materializeFlashcards } from '@bendyline/squisq/doc';
import { resolveTransformStyle } from '@bendyline/squisq/transform';
import type { Block } from '@bendyline/squisq/schemas';
import { PlainHtmlPreview } from '../PlainHtmlPreview';
import { usePrintMode } from './PrintMode';

export interface PrintPreviewProps {
  displayMode: DisplayMode;
  previewDoc: Doc | null;
  contentDoc: Doc | null;
  documentMarkdown: string;
  basePath: string;
  viewport: ViewportConfig;
  theme: Theme;
  showCover: boolean;
  transformStyle: string;
  mediaRevision: number;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

export function PrintPreview({
  displayMode,
  previewDoc,
  contentDoc,
  documentMarkdown,
  basePath,
  viewport,
  theme,
  showCover,
  transformStyle,
  mediaRevision,
}: PrintPreviewProps) {
  const { slidesPerPage, registerPrintHandler } = usePrintMode();
  const mediaProvider = useMediaProvider();
  const documentFrameRef = useRef<HTMLIFrameElement | null>(null);
  const setDocumentFrame = useCallback((frame: HTMLIFrameElement | null) => {
    documentFrameRef.current = frame;
  }, []);

  // Materialize through the same hook used by DocPlayer so custom templates,
  // persistent layers, responsive templates, and theme transitions resolve in
  // exactly the same way. Motion is disabled when each block is rendered.
  const { blocks } = useDocPlayback(previewDoc, 0, { viewport, theme });
  const coverBlock = useMemo<Block | null>(() => {
    if (!showCover || !previewDoc?.startBlock) return null;
    const context = createTemplateContext(theme, 0, 1, viewport);
    return {
      id: 'cover-block',
      startTime: -1,
      duration: 0,
      audioSegment: -1,
      layers: expandCoverBlock(previewDoc.startBlock, context),
    };
  }, [previewDoc?.startBlock, showCover, theme, viewport]);
  const flashcardDeck = useMemo(
    () => (contentDoc ? materializeFlashcards(contentDoc) : null),
    [contentDoc],
  );

  const isTextDocument = displayMode === 'page' || displayMode === 'narrate';
  useEffect(() => {
    if (!isTextDocument) return registerPrintHandler(null);
    return registerPrintHandler(() => {
      const frameWindow = documentFrameRef.current?.contentWindow;
      if (!frameWindow) return;
      frameWindow.print();
    });
  }, [isTextDocument, registerPrintHandler]);

  const title =
    (contentDoc?.frontmatter?.title as string | undefined) ??
    contentDoc?.startBlock?.title ??
    undefined;

  if (isTextDocument) {
    return (
      <div className="squisq-print-preview squisq-print-preview--document">
        <div className="squisq-print-document-paper">
          <PlainHtmlPreview
            markdown={documentMarkdown}
            title={title}
            mediaProvider={mediaProvider}
            mediaRevision={mediaRevision}
            theme={theme}
            onFrameChange={setDocumentFrame}
          />
        </div>
      </div>
    );
  }

  if (displayMode === 'linear') {
    return (
      <div className="squisq-print-preview squisq-print-preview--page">
        <style>{'@page { margin: 0; }'}</style>
        <div className="squisq-print-page-paper">
          <LinearDocView
            className="squisq-print-linear"
            doc={contentDoc ?? undefined}
            basePath={basePath}
            viewport={viewport}
            theme={theme}
            animationsEnabled={false}
            showCover={showCover}
            transformPage={transformStyle ? resolveTransformStyle(transformStyle).page : undefined}
          />
        </div>
      </div>
    );
  }

  if (displayMode === 'flashcards') {
    const faceProps = {
      theme,
      basePath,
      showCodeCopyButton: false,
      viewport,
      customTemplates: contentDoc?.customTemplates,
    };
    return (
      <div
        className="squisq-print-preview squisq-print-preview--flashcards"
        style={
          {
            '--squisq-print-flashcard-text': theme.colors.text,
            '--squisq-print-flashcard-muted': theme.colors.textMuted,
            '--squisq-print-flashcard-accent': theme.colors.primary,
            '--squisq-print-flashcard-bg': theme.colors.background,
            '--squisq-print-flashcard-surface': theme.colors.backgroundLight,
          } as CSSProperties
        }
      >
        <style>{'@page { size: landscape; margin: 0; }'}</style>
        {flashcardDeck?.cards.map((card, index) => (
          <article key={card.id} className="squisq-print-flashcard-sheet">
            <header>
              <span>
                Card {index + 1} of {flashcardDeck.cards.length}
              </span>
              {card.label && <strong>{card.label}</strong>}
            </header>
            <div className="squisq-print-flashcard-pair">
              <section className="squisq-print-flashcard-face" aria-label="Question side">
                <small>Front</small>
                <FlashcardFaceView {...faceProps} face={card.front} />
                {card.kind === 'multiple-choice' && (
                  <ol className="squisq-print-flashcard-choices">
                    {card.choices?.map((choice) => (
                      <li key={choice.id}>
                        <FlashcardFaceView {...faceProps} face={choice.content} />
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section className="squisq-print-flashcard-face" aria-label="Answer side">
                <small>Back</small>
                <FlashcardFaceView {...faceProps} face={card.back} />
                {card.explanation && (
                  <div className="squisq-print-flashcard-explanation">
                    <small>Explanation</small>
                    <FlashcardFaceView {...faceProps} face={card.explanation} />
                  </div>
                )}
              </section>
            </div>
          </article>
        ))}
        {(!flashcardDeck || flashcardDeck.cards.length === 0) && (
          <p className="squisq-print-empty">Nothing to print.</p>
        )}
      </div>
    );
  }

  const slides = coverBlock ? [coverBlock, ...blocks] : blocks;
  const density = displayMode === 'slideshow' ? slidesPerPage : 1;
  const sheets = chunk(slides, density);
  const orientation = viewport.width >= viewport.height ? 'landscape' : 'portrait';
  const previewStyle = {
    '--squisq-print-paper-ratio': `${orientation === 'landscape' ? '11 / 8.5' : '8.5 / 11'}`,
    '--squisq-print-slide-bg': theme.colors.background,
  } as CSSProperties;

  return (
    <div
      className="squisq-print-preview squisq-print-preview--slides"
      data-slides-per-page={density}
      style={previewStyle}
    >
      <style>{`@page { size: ${orientation}; margin: 0; }`}</style>
      {sheets.map((sheet, pageIndex) => (
        <div
          key={`${density}-${pageIndex}`}
          className="squisq-print-sheet"
          data-slides-per-page={density}
          aria-label={`Print page ${pageIndex + 1}`}
        >
          {sheet.map((block) => (
            <div key={block.id} className="squisq-print-slide-cell">
              <div className="squisq-print-slide-frame">
                <BlockRenderer
                  block={block}
                  blockTime={Math.max(0, block.duration)}
                  basePath={basePath}
                  viewport={viewport}
                  animationsEnabled={false}
                  theme={theme}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
      {sheets.length === 0 && <p className="squisq-print-empty">Nothing to print.</p>}
    </div>
  );
}
