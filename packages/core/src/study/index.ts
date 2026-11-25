/**
 * `@bendyline/squisq/study` — study cards kept with each section: reading,
 * writing and making them with a model.
 *
 * A separate entry so the code a card manager or an AI run needs loads only
 * with them: an app's startup imports `@bendyline/squisq/doc`, which keeps
 * just the card reader the Flashcards view uses (`readStudyCards`).
 */

// Reading cards (also exported from `@bendyline/squisq/doc`).
export {
  STUDY_CARD_KINDS,
  hasStudyCards,
  isStudyCardKind,
  readStudyCards,
  studyCardKey,
  studyCardTextKey,
  type StudyCard,
  type StudyCardChoice,
  type StudyCardIssue,
  type StudyCardIssueCode,
  type StudyCardKind,
  type StudyCardsRead,
} from '../doc/flashcards/studyCards.js';
export {
  isPassageKey,
  passageKey,
  sectionPassage,
  sectionPassages,
  sectionPassageText,
  type SectionPassage,
} from '../doc/sectionPassages.js';

// Writing cards, on the shared accessory block writer.
export {
  writeStudyCards,
  studyCardDraftFromText,
  studyCardDraftFromMarkdown,
  studyCardDraftOf,
  studyCardDraftProblem,
  type StudyCardChange,
  type StudyCardDraft,
  type StudyCardRejection,
  type StudyCardsWrite,
  type StudyCardText,
} from '../doc/flashcards/studyCardsSource.js';
export {
  openAccessoryBlockSource,
  accessoryBlockMarkdown,
  removeAccessoryBlocks,
  type AccessoryBlockSource,
  type AccessoryBlockZone,
} from '../doc/accessoryBlockSource.js';
export { STUDY_CARD_EXAMPLE, studyCardGuide } from '../doc/flashcards/studyCardGuide.js';

// Making cards with a model.
export * from '../transform/lenientJson.js';
export * from '../transform/studyAuthor.js';
export * from '../transform/studyGeneration.js';
export {
  askAuthorModel,
  type AuthorModel,
  type AuthorModelFormat,
  type AuthorModelReply,
  type AuthorModelRequest,
} from '../transform/authorModel.js';
