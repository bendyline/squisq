import { describe, it, expect } from 'vitest';
import {
  tokenizeAttrTokens,
  splitKeyValueToken,
  unquoteAttrValue,
  needsQuoting,
  quoteAttrValue,
  matchTrailingTemplateAnnotation,
  matchTrailingPandocAttr,
} from '../markdown/attrTokens.js';

describe('tokenizeAttrTokens', () => {
  it('splits bare tokens on whitespace', () => {
    expect(tokenizeAttrTokens('chart colorScheme=blue size=large')).toEqual([
      'chart',
      'colorScheme=blue',
      'size=large',
    ]);
  });

  it('keeps a double-quoted value as one token', () => {
    expect(tokenizeAttrTokens('caption="Beach at sunset" columns=3')).toEqual([
      'caption="Beach at sunset"',
      'columns=3',
    ]);
  });

  it('keeps a single-quoted value as one token', () => {
    expect(tokenizeAttrTokens("caption='Beach at sunset'")).toEqual(["caption='Beach at sunset'"]);
  });

  it('treats a quote mid-value as a literal character', () => {
    // The quote in O'Brien is not at a value start, so it must not open a
    // quoted run and swallow the following token.
    expect(tokenizeAttrTokens("attribution=O'Brien x=4")).toEqual(["attribution=O'Brien", 'x=4']);
  });

  it('preserves escape pairs inside a quoted run', () => {
    expect(tokenizeAttrTokens('label="he said \\"hi\\""')).toEqual(['label="he said \\"hi\\""']);
  });

  it('tolerates an unbalanced opening quote (run extends to end of input)', () => {
    expect(tokenizeAttrTokens('caption="oops trailing')).toEqual(['caption="oops trailing']);
  });

  it('keeps a bare quoted token verbatim', () => {
    expect(tokenizeAttrTokens('"just a string"')).toEqual(['"just a string"']);
  });
});

describe('splitKeyValueToken / unquoteAttrValue', () => {
  it('splits on the first =', () => {
    expect(splitKeyValueToken('a=b=c')).toEqual({ key: 'a', value: 'b=c' });
  });

  it('returns null for tokens without = past the first character', () => {
    expect(splitKeyValueToken('chart')).toBeNull();
    expect(splitKeyValueToken('#id')).toBeNull();
    expect(splitKeyValueToken('=leading')).toBeNull();
  });

  it('strips matching double quotes and unescapes', () => {
    expect(splitKeyValueToken('label="he said \\"hi\\""')).toEqual({
      key: 'label',
      value: 'he said "hi"',
    });
  });

  it('strips matching single quotes and unescapes', () => {
    expect(splitKeyValueToken("label='it\\'s here'")).toEqual({ key: 'label', value: "it's here" });
  });

  it('leaves unmatched quotes verbatim', () => {
    expect(unquoteAttrValue('"unbalanced')).toBe('"unbalanced');
    expect(unquoteAttrValue('"')).toBe('"');
  });

  it('leaves backslashes before other characters alone', () => {
    expect(unquoteAttrValue('"C:\\temp"')).toBe('C:\\temp');
  });
});

describe('needsQuoting / quoteAttrValue', () => {
  it('passes simple values through bare', () => {
    expect(quoteAttrValue('blue')).toBe('blue');
    expect(quoteAttrValue('a,b,c')).toBe('a,b,c');
    expect(quoteAttrValue('foo:flow')).toBe('foo:flow');
  });

  it('double-quotes values with spaces', () => {
    expect(quoteAttrValue('Beach at sunset')).toBe('"Beach at sunset"');
  });

  it('quotes empty values', () => {
    expect(quoteAttrValue('')).toBe('""');
  });

  it('quotes values containing brackets or braces', () => {
    expect(needsQuoting('a]b')).toBe(true);
    expect(quoteAttrValue('a]b')).toBe('"a]b"');
    expect(quoteAttrValue('a}b')).toBe('"a}b"');
  });

  it('switches to single quotes when the value contains a double quote', () => {
    expect(quoteAttrValue('She said "hi"')).toBe('\'She said "hi"\'');
  });

  it('falls back to double quotes with escapes when both quote chars appear', () => {
    expect(quoteAttrValue('it\'s a "thing"')).toBe('"it\'s a \\"thing\\""');
  });

  it('round-trips through tokenize + split', () => {
    const values = ['Beach at sunset', 'a ] b', 'She said "hi"', "it's fine", 'C:\\temp', ''];
    for (const value of values) {
      const tokens = tokenizeAttrTokens(`key=${quoteAttrValue(value)}`);
      expect(tokens).toHaveLength(1);
      expect(splitKeyValueToken(tokens[0])).toEqual({ key: 'key', value });
    }
  });
});

describe('matchTrailingTemplateAnnotation', () => {
  it('matches an empty trailing annotation', () => {
    const m = matchTrailingTemplateAnnotation('Heading {[]}');
    expect(m?.inner).toBe('');
  });

  it('matches a simple trailing annotation', () => {
    const m = matchTrailingTemplateAnnotation('Getting Started {[comparisonBar]}');
    expect(m?.inner).toBe('comparisonBar');
  });

  it('allows ] inside a quoted value', () => {
    const m = matchTrailingTemplateAnnotation('X {[quote text="a ] b"]}');
    expect(m?.inner).toBe('quote text="a ] b"');
  });

  it('falls back to the legacy grammar for unbalanced quotes', () => {
    const m = matchTrailingTemplateAnnotation('X {[quote text="oops]}');
    expect(m?.inner).toBe('quote text="oops');
  });

  it('still tolerates an accidentally doubled trailing ]}', () => {
    const m = matchTrailingTemplateAnnotation('X {[comparisonBar]}]}');
    expect(m?.inner).toBe('comparisonBar');
  });

  it('rejects non-trailing annotations', () => {
    expect(matchTrailingTemplateAnnotation('The {[chart]} section')).toBeNull();
  });
});

describe('matchTrailingPandocAttr', () => {
  it('matches a simple trailing block', () => {
    const m = matchTrailingPandocAttr('Section {#intro .wide x=4}');
    expect(m?.inner).toBe('#intro .wide x=4');
  });

  it('allows } inside a quoted value', () => {
    const m = matchTrailingPandocAttr('X {caption="a } b"}');
    expect(m?.inner).toBe('caption="a } b"');
  });

  it('does not match the {[…]} template form', () => {
    expect(matchTrailingPandocAttr('X {[chart]}')).toBeNull();
  });
});
