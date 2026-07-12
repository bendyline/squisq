import { describe, expect, it } from 'vitest';
import {
  repairAsciiDiagram,
  isRepairableDiagram,
  detectAsciiDiagram,
  parseAsciiDiagram,
} from '../doc/asciiDiagram/index.js';
import { POSITIVE_FIXTURES } from './fixtures/asciiDiagrams.js';

/**
 * Broken box art: package-name labels overflow their boxes and collide with
 * neighbours, so the columns desync row-to-row. Conservative detection
 * declines it (`garbled-labels`) — the opt-in repair pass reconstructs it.
 * (A shorter second label line keeps a real `│` on one interior row, which is
 * how real "half-broken" art still gives the tracer border evidence.)
 */
const BROKEN = [
  '┌──────────┐   ┌──────────┐',
  '│ @scope/alpha-svc  │   │ @scope/beta-svc   │',
  '│ one      │   │ two      │',
  '└────┬─────┘   └────┬─────┘',
  '     │              │',
  '     ▼              ▼',
  '┌────────────────────────────┐',
  '│ @scope/gamma-store         │',
  '│ persists                   │',
  '└────────────────────────────┘',
].join('\n');

describe('isRepairableDiagram', () => {
  it('is true for broken box art that conservative detection declines', () => {
    expect(detectAsciiDiagram(BROKEN).isDiagram).toBe(false);
    expect(isRepairableDiagram(BROKEN)).toBe(true);
  });

  it('is false for a clean diagram (the canvas already handles it)', () => {
    expect(detectAsciiDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL).isDiagram).toBe(true);
    expect(isRepairableDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL)).toBe(false);
  });

  it('is false for non-box art (prose, file trees)', () => {
    expect(isRepairableDiagram('just some\nplain prose\nwith no boxes')).toBe(false);
    expect(isRepairableDiagram('src/\n├── index.ts\n└── utils/')).toBe(false);
  });
});

describe('repairAsciiDiagram', () => {
  it('recovers clean labels from overflowing/colliding boxes (band-segment matching)', () => {
    const r = repairAsciiDiagram(BROKEN);
    expect(r).not.toBeNull();
    const firstLines = r!.diagram.nodes.map((n) => n.label.split('\n')[0]);
    expect(firstLines).toEqual(['@scope/alpha-svc', '@scope/beta-svc', '@scope/gamma-store']);
    // Hyphens/slashes in labels survive (they're not box-drawing chars).
    expect(firstLines.every((l) => l.includes('/') && l.includes('-'))).toBe(true);
  });

  it('recovers the fan-in edges', () => {
    const r = repairAsciiDiagram(BROKEN)!;
    const edgeSet = new Set(r.diagram.edges.map((e) => `${e.source}->${e.target}`));
    expect(edgeSet.has('scope-alpha-svc->scope-gamma-store')).toBe(true);
    expect(edgeSet.has('scope-beta-svc->scope-gamma-store')).toBe(true);
    // No phantom edge between the two horizontally-adjacent source boxes.
    expect(edgeSet.has('scope-alpha-svc->scope-beta-svc')).toBe(false);
  });

  it('produces art that re-parses cleanly as a diagram (repair is a real fixpoint entry)', () => {
    const r = repairAsciiDiagram(BROKEN)!;
    const redetect = detectAsciiDiagram(r.art);
    expect(redetect.isDiagram).toBe(true);
    // Same box count, and labels are no longer garbled.
    const reparsed = parseAsciiDiagram(r.art);
    expect(reparsed.nodes.length).toBe(r.diagram.nodes.length);
    expect(redetect.reasons.join(' ')).not.toMatch(/garbled/);
  });

  it('returns null when fewer than two boxes can be recovered', () => {
    expect(repairAsciiDiagram('just prose\nno boxes here')).toBeNull();
    expect(repairAsciiDiagram('┌───┐\n│ A │\n└───┘')).toBeNull();
  });

  it('marks the diagram as repaired', () => {
    expect(repairAsciiDiagram(BROKEN)!.diagram.warnings).toContain('repaired');
  });
});
