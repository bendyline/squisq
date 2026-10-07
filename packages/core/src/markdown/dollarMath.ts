/**
 * Pandoc's dollar-math rules for single-`$` inline math.
 *
 * remark-math treats ANY pair of single dollars in a paragraph as TeX, so
 * prose such as `lawn care is $45 per visit and cleanup is $350` parsed as
 * inline math `45 per visit and cleanup is `: every non-Write view and every
 * export (DOCX, PDF, HTML, EPUB) then dropped both dollar signs and set the
 * span in a code font. A quote or price sheet is exactly the document where
 * that is unacceptable, and the Write view (whose bridge treats `$` as text)
 * gave no hint anything was wrong.
 *
 * Pandoc solves this with flanking rules, and this module applies them:
 *
 *  - the opening `$` must have a non-space character immediately after it;
 *  - the closing `$` must have a non-space character immediately before it,
 *    and must not be followed immediately by a digit.
 *
 * So `$20,000 and $30,000`, `$5-$10` and `$ x $` stay prose, while `$x^2$`
 * and `$E = mc^2$` are still math. `$$…$$` (inline or display) is untouched.
 *
 * Mechanics: rather than fork remark-math's tokenizer, a guard construct is
 * registered ahead of it for `$`. The guard looks ahead along the same span
 * remark-math would take (its closer is the first run of exactly one `$`),
 * and when Pandoc would reject that span it claims the opening `$` as plain
 * text, so remark-math never sees it. When the span is acceptable the guard
 * steps aside and remark-math tokenizes it exactly as before.
 */

import type { Processor } from 'unified';

// micromark character codes (see micromark-util-symbol). Line endings, tabs
// and virtual spaces are the negative codes; `null` is the end of the text.
const DOLLAR_SIGN = 36;
const DIGIT_ZERO = 48;
const DIGIT_NINE = 57;

type Code = number | null;
// micromark's State is a recursive function type; `undefined` ends a run.
type State = (code: Code) => State | undefined;

interface Effects {
  enter(type: string): unknown;
  exit(type: string): unknown;
  consume(code: Code): void;
  check(construct: Construct, ok: State, nok: State): State;
}

interface TokenizeContext {
  events: Array<[string, { type: string }, unknown]>;
}

interface Construct {
  name: string;
  add?: 'before' | 'after';
  partial?: boolean;
  previous?: (this: TokenizeContext, code: Code) => boolean;
  tokenize: (this: TokenizeContext, effects: Effects, ok: State, nok: State) => State;
}

function isWhitespace(code: Code): boolean {
  if (code === null) return false;
  // Tabs, virtual spaces and every line ending are negative codes.
  return code < 0 || /\s/u.test(String.fromCodePoint(code));
}

function isAsciiDigit(code: Code): boolean {
  return code !== null && code >= DIGIT_ZERO && code <= DIGIT_NINE;
}

/**
 * Lookahead: would Pandoc accept the math span starting at this `$`?
 *
 * Succeeds for an acceptable single-`$` span AND for a `$$` run, which is
 * remark-math's own business. Fails when Pandoc would read the `$` as text.
 * Run through `effects.check`, so nothing it consumes is kept.
 */
const dollarMathSpan: Construct = {
  name: 'squisqDollarMathSpan',
  partial: true,
  tokenize(effects, ok, nok) {
    let previousWasWhitespace = false;
    let closingRunLength = 0;

    return open;

    function open(code: Code): State | undefined {
      effects.enter('squisqDollarMathProbe');
      effects.consume(code);
      return afterOpen;
    }

    function afterOpen(code: Code): State | undefined {
      if (code === DOLLAR_SIGN) return succeed(code);
      if (code === null || isWhitespace(code)) return fail(code);
      return inside(code);
    }

    function inside(code: Code): State | undefined {
      if (code === null) return fail(code);
      if (code === DOLLAR_SIGN) {
        closingRunLength = 0;
        return closingRun(code);
      }
      previousWasWhitespace = isWhitespace(code);
      effects.consume(code);
      return inside;
    }

    function closingRun(code: Code): State | undefined {
      if (code === DOLLAR_SIGN) {
        closingRunLength++;
        effects.consume(code);
        return closingRun;
      }
      // remark-math reads a run of any other length as math data and keeps
      // looking, so the lookahead must too.
      if (closingRunLength !== 1) {
        previousWasWhitespace = false;
        return inside(code);
      }
      // This is the `$` remark-math would close on.
      if (previousWasWhitespace || isAsciiDigit(code)) return fail(code);
      return succeed(code);
    }

    function succeed(code: Code): State | undefined {
      effects.exit('squisqDollarMathProbe');
      return ok(code);
    }

    function fail(code: Code): State | undefined {
      effects.exit('squisqDollarMathProbe');
      return nok(code);
    }
  },
};

/** Mirrors remark-math: a `$` right after an unescaped `$` never opens math. */
function previousIsNotUnescapedDollar(this: TokenizeContext, code: Code): boolean {
  return (
    code !== DOLLAR_SIGN || this.events[this.events.length - 1]?.[1].type === 'characterEscape'
  );
}

const dollarTextGuard: Construct = {
  name: 'squisqDollarTextGuard',
  add: 'before',
  previous: previousIsNotUnescapedDollar,
  tokenize(effects, ok, nok) {
    return start;

    function start(code: Code): State | undefined {
      // An acceptable span is left to remark-math (this construct fails);
      // anything else is claimed as a literal `$`.
      return effects.check(dollarMathSpan, nok, literalDollar)(code);
    }

    function literalDollar(code: Code): State | undefined {
      effects.enter('data');
      effects.consume(code);
      effects.exit('data');
      return ok;
    }
  },
};

/**
 * unified plugin: apply Pandoc's dollar-math rules. Use it AFTER
 * `remark-math` in a parsing pipeline; it changes tokenizing only, so
 * stringifying is unaffected (remark-math already escapes a literal `$`).
 */
export function remarkDollarMathRules(this: Processor): undefined {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  const extensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  extensions.push({ text: { [DOLLAR_SIGN]: dollarTextGuard } });
}
