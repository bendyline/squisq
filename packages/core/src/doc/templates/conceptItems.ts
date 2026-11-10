/**
 * Concept items — how the text of one idea is read.
 *
 * Every concept template (`cards`, `process`, `cycle`, `layers`, `stats`,
 * `pyramid`, `funnel`, `hub`, `venn`, `matrix`) takes its ideas as plain
 * strings, so a Markdown list, an AI author and a host's own script all feed
 * them the same way. This module is the one place those strings are parsed:
 * `Label: detail` for an idea, `Figure: what it measures` for a key number,
 * and the item of a Venn diagram that names what its sets share.
 *
 * Pure text in, plain data out: the templates draw from it, and
 * `conceptBuildStepTexts` names build steps from it, so the two agree.
 *
 * Related: `conceptBlocks.ts`, `conceptShapes.ts`, `recommend/listShape.ts`.
 */

/** One idea: an optional bold label and the words beneath it. */
export interface ConceptItem {
  label: string;
  detail: string;
}

const LABEL_WORDS = 7;

/** Split `Label: detail` or `Label — detail`; anything else is all detail. */
export function splitConceptItem(text: string): ConceptItem {
  const clean = text.replace(/\s+/gu, ' ').trim();
  const match = clean.match(/^(.{1,64}?)(:\s|\s[—–-]\s)(.+)$/u);
  // A dash between numbers is a range ("1.1 – 1.3 degrees"), not a label; a
  // date before a colon is ("July 16, 1969: launch").
  const range = !!match && !match[2]!.startsWith(':') && /\d$/u.test(match[1]!);
  // A label is a phrase, never the end of a sentence and the start of another.
  if (match && !range && !/[.!?]\s/u.test(match[1]!) && match[1]!.split(' ').length <= LABEL_WORDS)
    return { label: match[1]!.trim(), detail: match[3]!.trim() };
  return { label: '', detail: clean };
}

/** One key number: the figure, and the words that say what it measures. */
export interface StatItem {
  /** The figure as written ("57 million", "95%", "$3.2B"); empty when the item has none. */
  figure: string;
  caption: string;
}

/**
 * A figure as an author writes one: an optional sign or currency, digits,
 * and an optional scale ("%", "×", "M", "million"). "1 in 5" and "3 of 4"
 * are figures too.
 */
const FIGURE =
  /^[~≈<>±+−-]?\s?[$€£¥]?\s?\d[\d.,]*(?:\s?(?:%|‰|°[CF]?|[x×](?![a-z])|[KMB](?![a-z])|(?:thousand|million|billion|trillion|percent)\b)|\s(?:in|of|out of)\s\d[\d.,]*)?/iu;

/**
 * A version, address or dotted date ("2.1.0", "192.168.1.1", "12.05.2024")
 * is a name, not a quantity. Dots that group thousands ("1.234.567") are.
 */
function isDottedIdentifier(figure: string): boolean {
  const digits = figure.match(/\d[\d.,]*/u)?.[0] ?? '';
  return /\d\.\d+\.\d/u.test(digits) && !/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/u.test(digits);
}

/** Whether `text` is nothing but a figure and, at most, a short unit ("2,400 km"). */
export function isFigureText(text: string): boolean {
  const clean = text.trim();
  if (!clean || clean.length > 18) return false;
  const match = clean.match(FIGURE);
  if (!match || !match[0].trim() || isDottedIdentifier(match[0])) return false;
  const rest = clean.slice(match[0].length).trim();
  // What follows the number may only be a unit: one or two short words.
  return rest === '' || /^[\p{L}°/%²³.]{1,10}(?:\s[\p{L}/²³.]{1,8})?$/u.test(rest);
}

/**
 * Read one item of a `stats` block. The figure may be the label
 * ("57 million: deaths prevented"), the detail ("Coverage: 95%") or the
 * item's opening words ("57 million deaths prevented"); an item without a
 * figure is all caption.
 */
export function splitStatItem(text: string): StatItem {
  const { label, detail } = splitConceptItem(text);
  if (label && isFigureText(label)) return { figure: label, caption: detail };
  if (label && isFigureText(detail)) return { figure: detail, caption: label };
  const clean = label ? `${label}: ${detail}` : detail;
  const lead = clean.match(FIGURE)?.[0] ?? '';
  // A leading figure ends at a space or a comma: "10:30 standup" opens with a
  // time and "2024-05-01" with a date, and neither is a quantity.
  const after = clean.slice(lead.length);
  const figure = /^(?:\s|,\s|$)/u.test(after) && !isDottedIdentifier(lead) ? lead.trim() : '';
  const rest = figure ? after.replace(/^[\s,;:—–-]+/u, '') : '';
  if (figure && rest) return { figure: figure.replace(/[.,]+$/u, ''), caption: rest };
  return { figure: '', caption: clean };
}

/** Labels that mark the item of a Venn diagram naming what its sets share. */
const OVERLAP_LABEL =
  /^(?:both|shared?|overlap|in common|common|common ground|together|all|all three|each|either)$/iu;

/** The item that names what a Venn diagram's sets share, or -1. */
export function vennOverlapIndex(items: readonly ConceptItem[]): number {
  return items.findIndex((item) => OVERLAP_LABEL.test(item.label.trim()));
}

/** One dated stage: when it happened, then what. */
export interface DatedItem extends ConceptItem {
  when: string;
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+';
/** A leading date: a year ("1859", "1990s", "300 BC"), optionally after a month and day. */
const LEADING_DATE = new RegExp(
  `^((?:${MONTH}(?:\\d{1,2},?\\s+)?)?(?:\\d{4}s?|\\d{1,4}\\s?(?:BCE?|AD|CE))(?![.,]?\\d))[\\s,:;—–-]*(.*)$`,
  'u',
);

/**
 * The stages of a process as a timeline's stations, when every one opens with
 * a date and the dates run forward; otherwise undefined.
 */
export function timelineItems(items: readonly ConceptItem[]): DatedItem[] | undefined {
  if (items.length < 2) return undefined;
  let last = -Infinity;
  const dated: DatedItem[] = [];
  for (const item of items) {
    const match = (item.label || item.detail).match(LEADING_DATE);
    if (!match) return undefined;
    const when = match[1]!;
    const year = Number(when.match(/\d{1,4}(?=s?\s?(?:BCE?|AD|CE)?$)/u)?.[0] ?? NaN);
    const signed = /BCE?$/u.test(when) ? -year : year;
    if (!Number.isFinite(signed) || signed < last) return undefined;
    last = signed;
    const rest = match[2]!.trim();
    dated.push(
      item.label ? { when, label: rest, detail: item.detail } : { when, label: '', detail: rest },
    );
  }
  return dated;
}

/** A matrix read from its four items: what its axes measure, and the items in reading order. */
export interface MatrixReading {
  /** What grows from left to right. */
  xAxis: string;
  /** What grows from bottom to top. */
  yAxis: string;
  /** The items top left, top right, bottom left, bottom right. */
  items: string[];
  /** Whether the items had to be moved to sit where their own words put them. */
  reordered: boolean;
}

/** "low effort", "a lot of effort", "high impact": a level and what it is a level of. */
const LEVEL =
  /\b(low|little|small|less|minimal|few|high|a lot of|lots of|much|more|big|large|great|major|significant)\s+([\p{L}][\p{L}-]*)/giu;
const LOW_LEVELS: ReadonlySet<string> = new Set([
  'low',
  'little',
  'small',
  'less',
  'minimal',
  'few',
]);

/**
 * Read a matrix's axes out of its own items. Four ideas that each say where
 * they stand on the same two measures ("Quick wins: low effort, high impact")
 * name the axes themselves, and say which panel each belongs in: low on the
 * horizontal axis is left, high on the vertical axis is top. The items are
 * returned in that order, so a panel is never drawn where its words say it
 * is not. `undefined` when the items do not place themselves: other than
 * four, no two shared measures, or two items claiming the same corner.
 */
export function readMatrixItems(items: readonly string[]): MatrixReading | undefined {
  if (items.length !== 4) return undefined;
  const read = items.map((item) => {
    const levels = new Map<string, boolean>();
    for (const match of item.matchAll(LEVEL))
      levels.set(match[2]!.toLowerCase(), !LOW_LEVELS.has(match[1]!.toLowerCase()));
    return levels;
  });
  const measures = [...read[0]!.keys()].filter((measure) =>
    read.every((levels) => levels.has(measure)),
  );
  if (measures.length !== 2) return undefined;
  const name = (measure: string) => `${measure[0]!.toUpperCase()}${measure.slice(1)}`;
  /** 0 top left, 1 top right, 2 bottom left, 3 bottom right. */
  const corner = (levels: Map<string, boolean>, x: string, y: string) =>
    (levels.get(y) ? 0 : 2) + (levels.get(x) ? 1 : 0);
  const [first, second] = measures as [string, string];
  for (const [x, y] of [
    [first, second],
    [second, first],
  ] as const) {
    const corners = read.map((levels) => corner(levels, x, y));
    if (new Set(corners).size !== 4) return undefined;
    // Written in reading order for these axes: nothing to move.
    if (corners.every((at, index) => at === index))
      return { xAxis: name(x), yAxis: name(y), items: [...items], reordered: false };
  }
  // Written in some other order: the measure named first runs along the foot.
  const placed: string[] = [];
  read.forEach((levels, index) => {
    placed[corner(levels, first, second)] = items[index]!;
  });
  return { xAxis: name(first), yAxis: name(second), items: placed, reordered: true };
}
