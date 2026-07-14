import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import {
  DEFAULT_MERMAID_DIAGRAM_TYPE,
  MERMAID_DIAGRAM_TYPES,
  mermaidDiagramMarkdown,
} from '../mermaidDiagramTypes';

describe('Mermaid diagram type gallery', () => {
  it('offers distinct starter grammars across structure, planning, and data', () => {
    expect(MERMAID_DIAGRAM_TYPES).toHaveLength(18);
    expect(new Set(MERMAID_DIAGRAM_TYPES.map((entry) => entry.id)).size).toBe(18);
    expect(new Set(MERMAID_DIAGRAM_TYPES.map((entry) => entry.category))).toEqual(
      new Set(['Structure', 'Planning', 'Data']),
    );
    expect(DEFAULT_MERMAID_DIAGRAM_TYPE.id).toBe('flowchart');
    for (const entry of MERMAID_DIAGRAM_TYPES) {
      expect(entry.starter.trim()).not.toBe('');
      expect(entry.starter).not.toContain('```');
    }
  });

  it('wraps a starter in an authoritative Mermaid fence', () => {
    expect(mermaidDiagramMarkdown('gantt\n  title Plan')).toBe(
      '\n```mermaid\ngantt\n  title Plan\n```\n',
    );
  });

  it('ships starters accepted by the pinned Mermaid parser', async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    for (const entry of MERMAID_DIAGRAM_TYPES) {
      await expect(mermaid.parse(entry.starter), entry.label).resolves.toBeTruthy();
    }
  });
});
