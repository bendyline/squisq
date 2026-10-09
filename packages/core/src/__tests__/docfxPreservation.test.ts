import { describe, expect, it } from 'vitest';
import { normalizeDocfxMarkdown } from '../markdown/docfxMarkdown.js';
describe('DocFX preservation profile', () => {
  it('converts references through the host without changing literal examples', () => {
    const calls: string[] = [];
    const source =
      '[!code-csharp [Example](sample.cs?name=region)]\n<xref:System.String>\n:::code source="other.cs" range="1-3" :::\n\n`<xref:Literal>`\n\n```md\n[!code-csharp[](literal.cs)]\n```\n';
    const result = normalizeDocfxMarkdown(source, {
      reference: (kind, target) => {
        calls.push(`${kind}:${target}`);
        return `[Preserved](${target})`;
      },
    });
    expect(calls.sort()).toEqual([
      'code:other.cs',
      'code:sample.cs?name=region',
      'xref:System.String',
    ]);
    expect(normalizeDocfxMarkdown('Inline :::no-loc text="C#"::: term.')).toBe('Inline C# term.');
    expect(result).toContain('`<xref:Literal>`');
    expect(result).toContain('[!code-csharp[](literal.cs)]');
  });
  it('preserves malformed references without losing source text or changing literal examples', () => {
    const reported: string[] = [];
    const output = normalizeDocfxMarkdown(
      'See <xref:System.String?displayProperty=fullName:\n[!code-sql[Example]~/sample.sql)]\n',
      {
        unknownDirectives: 'preserve',
        onPreservedReference: (value) => reported.push(value),
      },
    );
    expect(reported).toEqual([
      '<xref:System.String?displayProperty=fullName:',
      '[!code-sql[Example]~/sample.sql)]',
    ]);
    expect(output).toContain(
      String.fromCharCode(96) +
        ' <xref:System.String?displayProperty=fullName: ' +
        String.fromCharCode(96),
    );
    expect(output).toContain('[!code-sql[Example]~/sample.sql)]');
  });
  it('retains source metadata, version conditions, and unknown presentation markers', () => {
    const result = normalizeDocfxMarkdown(
      '---\naliases:\n - %\n---\n\n# Page\n:::moniker range=">=net-8.0"\nBody.\n:::moniker-end\n:::future value="retain me"\n',
      { frontmatterAsCode: true, unknownDirectives: 'preserve' },
    );
    expect(result).toContain('**Applies to: \\>=net-8.0**');
    expect(result).toContain('Body.');
    expect(result).toContain('`:::future value="retain me"`');
    expect(result).toContain('```text\n---\naliases:\n - %\n---\n```');
    expect(result.startsWith('---')).toBe(false);
  });
});

it('handles many sibling DocFX moniker blocks without treating them as nested Markdown directives', () => {
  const input = Array.from(
    { length: 160 },
    (_, i) => ':::moniker range="version-' + i + '"\nText ' + i + '.\n:::moniker-end\n',
  ).join('\n');
  const result = normalizeDocfxMarkdown(input, { unknownDirectives: 'preserve' });
  expect(result).toContain('**Applies to: version-159**');
  expect(result).toContain('Text 159.');
  expect(result).not.toContain(':::moniker');
});

it('flattens indented DocFX columns without losing prose or changing fenced examples', () => {
  const input =
    ':::row:::\n    :::column span="2":::\n        Step one.\n\n        ```text\n        :::column-end:::\n        ```\n\n        Paragraph after code.\n    :::column-end:::\n:::row-end:::\n\n<!-- :::row::: -->\n';
  const result = normalizeDocfxMarkdown(input, { unknownDirectives: 'preserve' });
  expect(result).toContain('Step one.');
  expect(result).toContain('\nParagraph after code.\n');
  expect(result).toContain('```text\n:::column-end:::\n```');
  expect(result).not.toContain('    :::column-end:::');
  expect(result).toContain('<!-- :::row::: -->');
  const literal = '    :::row:::\n    Literal example.\n    :::row-end:::\n';
  expect(normalizeDocfxMarkdown(literal)).toBe(literal);
});

it('resolves code directives exposed by removing adjacent version sections', () => {
  const input =
    '::: zone pivot="a,b"\n1. Prepare.\n\n    ```bash\n    install sample\n    ```\n    ---\n\n::: zone-end\n::: zone pivot="a"\n2. Create a file.\n\n    ### [First](#tab/first)\n\n    :::code language="javascript" source="sample.js":::\n\n    ---\n\n3. Continue.\n::: zone-end\n';
  const options = {
    unknownDirectives: 'preserve' as const,
    reference: () => '[Complete source](sample.js.md)',
  };
  const result = normalizeDocfxMarkdown(input, options);
  expect(result).toContain('[Complete source](sample.js.md)');
  expect(result).not.toContain(':::code');
  expect(normalizeDocfxMarkdown(result, options)).toBe(result);
  expect(() => normalizeDocfxMarkdown(':::row:::\n'.repeat(129))).toThrow(/128-level/);
});

it('preserves malformed include references and unterminated comments without discarding article text', () => {
  const references: string[] = [];
  const input = 'Article body. [!INCLUDE public preview disclaimer]\n\n<!--::: zone-end\n';
  const output = normalizeDocfxMarkdown(input, {
    unknownDirectives: 'preserve',
    onPreservedReference: (value) => references.push(value),
  });
  expect(references).toEqual(['[!INCLUDE public preview disclaimer]']);
  expect(output).toContain('Article body.');
  expect(output).toContain(
    String.fromCharCode(96) + ' [!INCLUDE public preview disclaimer] ' + String.fromCharCode(96),
  );
  expect(output).toContain('<!--::: zone-end');
});
