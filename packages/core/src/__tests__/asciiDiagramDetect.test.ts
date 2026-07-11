import { describe, expect, it } from 'vitest';
import {
  detectAsciiDiagram,
  isAsciiDiagramFence,
  isEligibleAsciiFenceLang,
  isExplicitDiagramLang,
} from '../doc/asciiDiagram/index.js';
import type { MarkdownCodeBlock } from '../markdown/types.js';
import { NEGATIVE_FIXTURES, POSITIVE_FIXTURES } from './fixtures/asciiDiagrams.js';

/**
 * The negative corpus is the CONTRACT for detection tuning: every entry
 * must stay rejected. False positives hide real code behind a diagram
 * canvas; false negatives merely leave a code block alone.
 */

const EXPECTED_REJECT_REASONS: Record<string, RegExp> = {
  NEG_MARKDOWN_TABLE: /markdown-table|too-few-corner-candidates/,
  NEG_PSQL_TABLE: /table-lattice/,
  NEG_MYSQL_TABLE: /table-lattice/,
  NEG_SHELL_PIPES: /too-few-corner-candidates|too-few-lines|too-few-boxes/,
  NEG_TS_UNION: /too-few-corner-candidates|too-few-boxes/,
  NEG_SQL_DDL: /too-few-corner-candidates|too-few-boxes/,
  NEG_FILE_TREE: /too-few-corner-candidates|too-few-boxes/,
  NEG_YAML: /too-few-corner-candidates|too-few-boxes/,
  NEG_LOG_COLUMNS: /too-few-corner-candidates|too-few-boxes/,
  NEG_PROSE_HEAVY: /loose-ratio/,
  SINGLE_BOX: /too-few-boxes|too-few-corner-candidates/,
};

describe('detectAsciiDiagram — negative corpus (must all reject)', () => {
  for (const [name, fixture] of Object.entries(NEGATIVE_FIXTURES)) {
    it(`rejects ${name}`, () => {
      const detection = detectAsciiDiagram(fixture);
      expect(detection.isDiagram).toBe(false);
      const expected = EXPECTED_REJECT_REASONS[name];
      expect(detection.reasons.join(' ')).toMatch(expected);
    });
  }

  it('rejects oversized fences without parsing', () => {
    const huge = Array.from({ length: 500 }, () => '┌──┐').join('\n');
    const detection = detectAsciiDiagram(huge);
    expect(detection.isDiagram).toBe(false);
    expect(detection.reasons.join(' ')).toMatch(/too-many-lines/);
  });

  it('rejects tiny fragments', () => {
    expect(detectAsciiDiagram('┌┐\n└┘').isDiagram).toBe(false);
  });
});

describe('detectAsciiDiagram — positive fixtures (must all accept)', () => {
  for (const [name, fixture] of Object.entries(POSITIVE_FIXTURES)) {
    it(`accepts ${name}`, () => {
      const detection = detectAsciiDiagram(fixture);
      expect(detection.isDiagram).toBe(true);
      expect(detection.diagram).toBeDefined();
      expect(detection.diagram?.nodes.length).toBeGreaterThanOrEqual(2);
    });
  }
});

describe('explicit `diagram` tag (lenient detection)', () => {
  const ONE_BOX = ['┌────────┐', '│ Solo   │', '└────────┘'].join('\n');

  it('isExplicitDiagramLang matches only the `diagram` tag', () => {
    for (const lang of ['diagram', ' Diagram ', 'DIAGRAM'])
      expect(isExplicitDiagramLang(lang)).toBe(true);
    for (const lang of [undefined, null, '', 'text', 'ascii', 'tree', 'js'])
      expect(isExplicitDiagramLang(lang)).toBe(false);
  });

  it('a single-box diagram is rejected untagged but accepted when explicit', () => {
    expect(detectAsciiDiagram(ONE_BOX).isDiagram).toBe(false);
    const explicit = detectAsciiDiagram(ONE_BOX, { explicit: true });
    expect(explicit.isDiagram).toBe(true);
    expect(explicit.diagram?.nodes).toHaveLength(1);
  });

  it('still rejects a markdown table even when explicitly tagged', () => {
    expect(
      detectAsciiDiagram(NEGATIVE_FIXTURES.NEG_MARKDOWN_TABLE, { explicit: true }).isDiagram,
    ).toBe(false);
  });

  it('`diagram` is an eligible fence lang and isAsciiDiagramFence accepts a tagged single box', () => {
    expect(isEligibleAsciiFenceLang('diagram')).toBe(true);
    const fence: MarkdownCodeBlock = { type: 'code', lang: 'diagram', value: ONE_BOX };
    expect(isAsciiDiagramFence(fence)).toBe(true);
    // The same content in a bare fence is not auto-detected.
    expect(isAsciiDiagramFence({ type: 'code', value: ONE_BOX })).toBe(false);
  });
});

describe('fence language gate', () => {
  it('allows no language, empty, and the inert allowlist', () => {
    expect(isEligibleAsciiFenceLang(undefined)).toBe(true);
    expect(isEligibleAsciiFenceLang(null)).toBe(true);
    expect(isEligibleAsciiFenceLang('')).toBe(true);
    expect(isEligibleAsciiFenceLang('text')).toBe(true);
    expect(isEligibleAsciiFenceLang('TXT')).toBe(true);
    expect(isEligibleAsciiFenceLang('plaintext')).toBe(true);
    expect(isEligibleAsciiFenceLang('plain')).toBe(true);
    expect(isEligibleAsciiFenceLang('ascii')).toBe(true);
  });

  it('rejects real programming languages', () => {
    for (const lang of ['js', 'ts', 'python', 'sql', 'mermaid', 'json', 'yaml', 'bash']) {
      expect(isEligibleAsciiFenceLang(lang)).toBe(false);
    }
  });

  it('isAsciiDiagramFence combines the lang gate with content detection', () => {
    const art = POSITIVE_FIXTURES.TWO_BOX_VERTICAL;
    const fence = (lang?: string): MarkdownCodeBlock => ({
      type: 'code',
      ...(lang !== undefined ? { lang } : {}),
      value: art,
    });
    expect(isAsciiDiagramFence(fence())).toBe(true);
    expect(isAsciiDiagramFence(fence('text'))).toBe(true);
    expect(isAsciiDiagramFence(fence('js'))).toBe(false);
    expect(isAsciiDiagramFence({ type: 'code', value: NEGATIVE_FIXTURES.NEG_PSQL_TABLE })).toBe(
      false,
    );
  });
});
