import type { Processor } from 'unified';
import { parseWikiLink } from './wikiLinks.js';

type Code = number | null;
type State = (code: Code) => State | undefined;
interface Token {
  type: string;
}
interface Effects {
  enter(type: string): unknown;
  exit(type: string): unknown;
  consume(code: Code): void;
}
interface CompileContext {
  enter(node: { type: string; value: string }, token: Token): void;
  exit(token: Token): void;
  sliceSerialize(token: Token): string;
}

/** A micromark construct, so escapes, code fences and inline code retain
 * their normal precedence. No regexp rewriting of whole documents. */
export function remarkWikiLinks(this: Processor): undefined {
  const data = this.data() as {
    micromarkExtensions?: unknown[];
    fromMarkdownExtensions?: unknown[];
    toMarkdownExtensions?: unknown[];
  };
  (data.micromarkExtensions ??= []).push({
    text: {
      91: {
        name: 'wikiLink',
        tokenize(effects: Effects, ok: State, nok: State): State {
          let target = '';
          return start;
          function start(code: Code): State | undefined {
            effects.enter('wikiLink');
            effects.consume(code);
            return second;
          }
          function second(code: Code): State | undefined {
            if (code !== 91) return nok(code);
            effects.consume(code);
            return inside;
          }
          function inside(code: Code): State | undefined {
            if (code === 93) {
              effects.consume(code);
              return close;
            }
            if (code === null || code < 0 || code === 91 || target.length >= 4097) return nok(code);
            target += String.fromCodePoint(code);
            effects.consume(code);
            return inside;
          }
          function close(code: Code): State | undefined {
            if (code !== 93 || !parseWikiLink(target.replace(/\\\|/g, '|'))) return nok(code);
            effects.consume(code);
            effects.exit('wikiLink');
            return ok;
          }
        },
      },
    },
  });
  (data.fromMarkdownExtensions ??= []).push({
    enter: {
      wikiLink(this: CompileContext, token: Token) {
        this.enter(
          {
            type: 'wikiLink',
            value: this.sliceSerialize(token).slice(2, -2).replace(/\\\|/g, '|'),
          },
          token,
        );
      },
    },
    exit: {
      wikiLink(this: CompileContext, token: Token) {
        this.exit(token);
      },
    },
  });
  (data.toMarkdownExtensions ??= []).push({
    handlers: {
      wikiLink(node: { value: string }, _parent: unknown, state: { stack: string[] }) {
        const value = state.stack.includes('tableCell')
          ? node.value.replace(/\|/g, '\\|')
          : node.value;
        return `[[${value}]]`;
      },
    },
  });
}
