import { describe, expect, it } from 'vitest';
import { normalizeDocfxMarkdown } from '../markdown/docfxMarkdown.js';

describe('normalizeDocfxMarkdown', () => {
  it('normalizes images, zones, layout, and admonitions while retaining content', () => {
    const input =
      '::: zone pivot="python"\n> [!NOTE]\n> Keep this.\n:::image type="content" source="x.png" alt-text="A diagram" :::\n:::zone-end\n';
    expect(normalizeDocfxMarkdown(input, { images: 'omit' })).toBe(
      '**Applies to: python**\n\n> **Note:**\n> Keep this.\nA diagram\n\n',
    );
    expect(normalizeDocfxMarkdown(':::image source="x.png" alt-text="A diagram":::')).toBe(
      '![A diagram](x.png)',
    );
  });
  it('preserves frontmatter and fenced examples and refuses unknown directives', () => {
    const source = '---\ntitle: Example\n---\n\n```md\n:::image source="x.png"::: \n```\n';
    expect(normalizeDocfxMarkdown(source, { images: 'omit' })).toBe(source);
    expect(() => normalizeDocfxMarkdown(':::code source="missing.cs":::')).toThrow(
      'Unsupported DocFX',
    );
  });
  it('handles images inside table cells while leaving comments intact', () => {
    const source =
      '| Item | :::image source="x.png" alt-text="Diagram"::: |\n\n<!-- :::image source="unused.png"::: -->\n';
    expect(normalizeDocfxMarkdown(source, { images: 'omit' })).toBe(
      '| Item | Diagram |\n\n<!-- :::image source="unused.png"::: -->\n',
    );
  });
});
