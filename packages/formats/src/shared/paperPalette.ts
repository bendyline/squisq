/**
 * Theme colours for the formats people read on paper: Word and PDF.
 *
 * A theme's palette is made for a screen. A light theme keeps its page tint
 * and its inks. A dark theme cannot be printed as it is: Word does not print
 * page colour unless the reader turns that on, so its light text lands on
 * white paper and nearly vanishes, and a PDF has no page colour at all. On
 * paper a dark theme therefore turns over: its own dark background becomes
 * the ink, and its accent stays for headings and links wherever it is
 * legible. Every ink returned is at least 4.5:1 against the page it sits on.
 */

import { contrastRatio } from '@bendyline/squisq/schemas';
import { normalizeOoxmlHex } from './ooxmlColor.js';

const PAPER = '#FFFFFF';
const LEGIBLE = 4.5;

/** The theme colours this reads; every one optional and possibly malformed. */
export interface PaperThemeColors {
  background?: string;
  text?: string;
  textMuted?: string;
  primary?: string;
  secondary?: string;
  highlight?: string;
}

/** `#RRGGBB` colours for a paper format; undefined means the format's default. */
export interface PaperPalette {
  /** The page colour to paint: a light theme's tint, else undefined for white. */
  page: string | undefined;
  text: string | undefined;
  heading: string | undefined;
  muted: string | undefined;
  link: string | undefined;
  /** Whether a dark theme was turned over onto white paper. */
  turned: boolean;
}

export interface PaperPaletteOptions {
  /** Paint a light theme's page tint (Word can; PDF stays white). */
  paintPage?: boolean;
  /** Other surfaces the inks must also be legible on (a table header shade). */
  alsoLegibleOn?: readonly string[];
}

function hex(value: string | undefined): string | undefined {
  const normalized = value ? normalizeOoxmlHex(value) : undefined;
  return normalized ? `#${normalized}` : undefined;
}

export function paperPalette(
  colors: PaperThemeColors | undefined,
  options: PaperPaletteOptions = {},
): PaperPalette {
  const background = hex(colors?.background);
  const dark =
    background !== undefined &&
    contrastRatio(background, '#000000') < contrastRatio(background, PAPER);
  const page = background && !dark && options.paintPage ? background : PAPER;
  const surfaces = [page, ...(options.alsoLegibleOn ?? [])];
  const legible = (color: string | undefined): color is string =>
    color !== undefined && surfaces.every((surface) => contrastRatio(color, surface) >= LEGIBLE);
  const first = (...candidates: Array<string | undefined>) => candidates.map(hex).find(legible);
  // On a turned-over dark theme, its background is the ink of last resort.
  const ink = dark ? colors?.background : undefined;

  const text = first(colors?.text, ink);
  return {
    page: page === PAPER ? undefined : page,
    text,
    heading: first(colors?.primary, colors?.text, ink),
    muted: first(colors?.textMuted, colors?.text, ink),
    link: first(colors?.highlight, colors?.secondary, colors?.primary),
    turned: dark,
  };
}
