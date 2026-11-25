/**
 * How to write study cards, for a prompt or an agent's authoring guide (the
 * DocBlocks MCP server teaches it from here). Kept beside the reader, so the
 * example is checked against it.
 */

/** A section with one card of each kind, exactly as the reader expects them. */
export const STUDY_CARD_EXAMPLE = [
  '## Photosynthesis',
  '',
  'Plants turn light into sugar in their leaves.',
  '',
  '### What do plants make from light? {[flashcard]}',
  '',
  'Sugar, which stores the energy.',
  '',
  '### Where does photosynthesis happen? {[quiz]}',
  '',
  '- [ ] In the roots',
  '- [x] In the leaves',
  '- [ ] In the flowers',
  '',
  'The leaves hold the chlorophyll that catches light.',
].join('\n');

/** The rules for writing study cards, one per line. */
export function studyCardGuide(): string[] {
  return [
    'A study card is a heading tagged {[flashcard]} or {[quiz]} under the section it is about, after that section’s own text and before its first sub-section, one level below the section heading.',
    'Flashcard: the heading is the question; everything under it, up to the next heading, is the answer.',
    'Quiz question: the heading is the question; the first list is the choices, written as a checklist with exactly one ticked — "- [x] The right answer", "- [ ] A wrong answer" — at least two choices; any paragraph after the list explains the right answer.',
    'A card is flat: never put a heading inside a card, and never end a question with {…}.',
    'Text written after a section’s last card belongs to that card, so cards always come after the section’s text.',
    'Cards are never slides, narration or exported text; they are studied in the Flashcards view. Deliver them in Markdown (or a DocBlocks bundle) — other formats leave them out.',
    'Do not add origin= or passage= settings to cards you write: those mark cards a model wrote inside the app, so they can be checked when the section changes.',
  ];
}
