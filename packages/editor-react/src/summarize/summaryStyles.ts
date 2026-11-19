/**
 * The choices offered in Write › Summarize. Each is a `squisq-transform` value:
 * `''` (None) shows every section as written, a built-in style re-cuts the
 * document in its own way, and Custom is core's `dynamic-slides` style — the
 * one whose slides an author can adjust one by one.
 */
import {
  DYNAMIC_PRESENTATION_STYLE,
  getTransformStyleSummaries,
} from '@bendyline/squisq/transform';

export interface SummaryStyleOption {
  /** The `squisq-transform` value; `''` removes the key. */
  id: string;
  name: string;
  description: string;
}

/** The `squisq-transform` value of the Custom style. */
export const CUSTOM_SUMMARY_STYLE = DYNAMIC_PRESENTATION_STYLE;

const BUILT_IN = getTransformStyleSummaries().map(({ id, name, description }) => ({
  id,
  name,
  description,
}));

/** None first, the built-in styles in registry order, and Custom last. */
export const SUMMARY_STYLE_OPTIONS: readonly SummaryStyleOption[] = [
  { id: '', name: 'None', description: 'Each section is one slide, shown as you wrote it' },
  ...BUILT_IN.filter((option) => option.id !== CUSTOM_SUMMARY_STYLE),
  ...BUILT_IN.filter((option) => option.id === CUSTOM_SUMMARY_STYLE),
];
