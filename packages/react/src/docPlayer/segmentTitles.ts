import { isTemplateBlock, type Doc, type DocBlock } from '@bendyline/squisq/schemas';

const SMALL_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'for',
  'nor',
  'on',
  'at',
  'to',
  'in',
  'of',
  'by',
  'is',
]);

/** Build audio-segment labels from section headings and readable source-name fallbacks. */
export function buildSegmentTitleMap(doc: Doc): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of doc.blocks as DocBlock[]) {
    if (isTemplateBlock(block) && block.template === 'sectionHeader' && 'title' in block) {
      const segmentIndex = block.audioSegment;
      if (!map.has(segmentIndex)) map.set(segmentIndex, (block as { title: string }).title);
    }
  }

  for (let index = 0; index < doc.audio.segments.length; index++) {
    if (map.has(index)) continue;
    const name = doc.audio.segments[index].name;
    if (name.includes('intro')) {
      map.set(index, 'Introduction');
    } else if (name.includes('flight-context')) {
      map.set(index, 'Flight Context');
    } else {
      const title = name
        .split('-')
        .map((word, wordIndex) =>
          wordIndex === 0 || !SMALL_WORDS.has(word)
            ? word.charAt(0).toUpperCase() + word.slice(1)
            : word,
        )
        .join(' ');
      map.set(index, title);
    }
  }
  return map;
}
