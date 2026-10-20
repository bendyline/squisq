import { wikiLinkPath, type WikiLinkSuggestion } from '@bendyline/squisq/markdown';

/** Match an unfinished target at the caret; aliases and code never complete. */
export function wikiQueryAt(text: string): { from: number; query: string } | null {
  const match = /\[\[([^\u005b\]\n|]*)$/.exec(text);
  if (!match || match[1].length > 2048) return null;
  let escapes = 0;
  for (let i = match.index - 1; i >= 0 && text[i] === '\\'; i--) escapes++;
  if (escapes % 2) return null;
  let code = 0;
  for (const tick of text.slice(0, match.index).matchAll(/`+/g)) {
    if (tick.index > 0 && text[tick.index - 1] === '\\') continue;
    if (!code) code = tick[0].length;
    else if (code === tick[0].length) code = 0;
  }
  if (code || (match[1] && !wikiLinkPath(`${match[1].trimEnd()}x`))) return null;
  return { from: match.index, query: match[1] };
}

export function validWikiSuggestions(items: readonly WikiLinkSuggestion[]): WikiLinkSuggestion[] {
  return items
    .filter(
      (item) =>
        item.target.length <= 2048 &&
        item.label.length > 0 &&
        item.label.length <= 2048 &&
        (item.kind === 'article'
          ? !!wikiLinkPath(item.target)
          : item.kind === 'folder' &&
            item.target.endsWith('/') &&
            !!wikiLinkPath(item.target.slice(0, -1))),
    )
    .slice(0, 20);
}
