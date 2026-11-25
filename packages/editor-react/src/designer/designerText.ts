/** Text helpers shared by the designers' section lists. */

/** Text cut at a word to about `characters`, for a label in a list. */
export function gist(text: string, characters: number): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (clean.length <= characters) return clean;
  const cut = clean.slice(0, characters);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), characters / 2)).trim()}…`;
}

/** A section as a list names it: its heading, else the start of its text. */
export function sectionName(section: { heading?: string; text?: string } | undefined): string {
  return section?.heading?.trim() || gist(section?.text ?? '', 60) || 'Untitled section';
}
