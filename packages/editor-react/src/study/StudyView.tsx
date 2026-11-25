/**
 * Write › Study cards: the flashcards and quiz questions kept with each
 * section, made and edited beside the section they are about. Studying them
 * is Use › Flashcards.
 *
 * The shell keeps this view mounted, hidden, while Use is open, as it keeps
 * Summaries, so a run of AI cards goes on while the person studies.
 */
import { lazy, Suspense } from 'react';
import { useEditorContext } from '../EditorContext';
import { usePreviewSettingsOptional } from '../PreviewControls';
import type { StudyAssistant } from './studyAssistant';

export type { StudyAssistant } from './studyAssistant';

// Loaded the first time the view opens.
const StudyCardManager = lazy(() =>
  import('./StudyCardManager').then((module) => ({ default: module.StudyCardManager })),
);

export interface StudyViewProps {
  /** The host's AI, for Generate. Without one the view has no AI. */
  assistant?: StudyAssistant;
  readOnly: boolean;
  /** Hidden (but mounted) while the Use view is open. */
  hidden: boolean;
}

export function StudyView({ assistant, readOnly, hidden }: StudyViewProps) {
  const { setActiveView } = useEditorContext();
  const preview = usePreviewSettingsOptional();
  const study = () => {
    preview?.setSelectedDisplayMode('flashcards');
    setActiveView('preview');
  };
  return (
    <section
      className="squisq-study"
      aria-label="Study cards"
      hidden={hidden}
      style={hidden ? { display: 'none' } : undefined}
    >
      <div className="squisq-study-inner">
        <header className="squisq-study-header">
          <h2 className="squisq-study-title">Study cards</h2>
          <p className="squisq-study-intro">
            Flashcards and quiz questions kept with each section of your document. They are never
            slides, narration or exported text. Study them in Use › Flashcards.
          </p>
        </header>
        <Suspense
          fallback={
            <p className="squisq-study-empty" role="status">
              Reading the cards…
            </p>
          }
        >
          <StudyCardManager
            assistant={assistant}
            readOnly={readOnly}
            onStudy={preview ? study : undefined}
          />
        </Suspense>
      </div>
    </section>
  );
}
