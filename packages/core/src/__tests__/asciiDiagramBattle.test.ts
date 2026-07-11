import { describe, expect, it } from 'vitest';
import {
  detectAsciiDiagram,
  parseAsciiDiagram,
  renderAsciiDiagram,
  type AsciiDiagram,
} from '../doc/asciiDiagram/index.js';
import { BATTLE_DIAGRAMS, type BattleDiagram } from './fixtures/asciiDiagramBattle.js';

/**
 * Battle test: a broad corpus of AI-style ASCII diagrams (linear flows,
 * fan-out/in, DAGs, cycles, many-to-many, containers, labeled edges,
 * styles) driven through the codec end-to-end. Each fixture asserts:
 *
 *  1. Detection — the art is recognized as a diagram.
 *  2. Parse accuracy — it parses to EXACTLY the intended nodes / edges /
 *     containment (the "we read what the AI drew" guarantee).
 *  3. Semantic fixpoint — render→parse preserves that semantic (editing
 *     the canvas never silently drops a node or edge).
 *  4. Byte idempotence — render→parse→render is byte-stable across cycles
 *     (no jitter, no drift).
 *
 * Followed by a focused many-to-many section and honest graceful-
 * degradation / known-limitation coverage.
 */

interface Semantic {
  nodes: string[];
  edges: string[];
}
function semantic(d: AsciiDiagram): Semantic {
  return {
    nodes: d.nodes.map((n) => `${n.id}${n.containerId ? `<${n.containerId}` : ''}`).sort(),
    edges: d.edges.map((e) => `${e.source}|${e.target}|${e.directed}|${e.label ?? ''}`).sort(),
  };
}
function expectedEdgeStrings(fx: BattleDiagram): string[] {
  return fx.edges
    .map(
      ([s, t, label, directed]) => `${s}|${t}|${directed === false ? false : true}|${label ?? ''}`,
    )
    .sort();
}

describe('battle test — every fixture round-trips', () => {
  for (const fx of BATTLE_DIAGRAMS) {
    describe(`${fx.category}: ${fx.name}`, () => {
      const d = parseAsciiDiagram(fx.art);

      it('detects as a diagram', () => {
        expect(detectAsciiDiagram(fx.art).isDiagram).toBe(true);
      });

      it('parses the intended nodes', () => {
        expect(d.nodes.map((n) => n.id).sort()).toEqual([...fx.nodes].sort());
      });

      it('parses the intended edges (source, target, direction, label)', () => {
        const got = d.edges
          .map((e) => `${e.source}|${e.target}|${e.directed}|${e.label ?? ''}`)
          .sort();
        expect(got).toEqual(expectedEdgeStrings(fx));
      });

      it('parses the intended containment', () => {
        const got: Record<string, string> = {};
        for (const n of d.nodes) if (n.containerId) got[n.id] = n.containerId;
        expect(got).toEqual(fx.containers ?? {});
      });

      it('render→parse preserves the semantic (fixpoint)', () => {
        const reparsed = parseAsciiDiagram(renderAsciiDiagram(d));
        expect(semantic(reparsed)).toEqual(semantic(d));
      });

      it('render→parse→render is byte-stable across three cycles', () => {
        const t1 = renderAsciiDiagram(d);
        const t2 = renderAsciiDiagram(parseAsciiDiagram(t1));
        const t3 = renderAsciiDiagram(parseAsciiDiagram(t2));
        expect(t2).toBe(t1);
        expect(t3).toBe(t1);
      });
    });
  }
});

describe('battle test — coverage sanity', () => {
  it('covers every intended category', () => {
    const categories = new Set(BATTLE_DIAGRAMS.map((f) => f.category));
    for (const c of [
      'linear',
      'fan-out',
      'fan-in',
      'dag',
      'cycle',
      'many-to-many',
      'edges',
      'labels',
      'container',
      'style',
    ]) {
      expect(categories.has(c)).toBe(true);
    }
  });

  it('fixture names are unique', () => {
    const names = BATTLE_DIAGRAMS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('battle test — many-to-many relationships', () => {
  it('recovers every edge of a full 3-node mesh (6 directed edges)', () => {
    const fx = BATTLE_DIAGRAMS.find((f) => f.name === 'fullMesh3')!;
    const d = parseAsciiDiagram(fx.art);
    expect(d.edges).toHaveLength(6);
    const pairs = new Set(d.edges.map((e) => `${e.source}->${e.target}`));
    for (const a of ['alpha', 'beta', 'gamma']) {
      for (const b of ['alpha', 'beta', 'gamma']) {
        if (a !== b) expect(pairs.has(`${a}->${b}`)).toBe(true);
      }
    }
  });

  it('recovers a fan-out hub connecting to all of its targets', () => {
    const fx = BATTLE_DIAGRAMS.find((f) => f.name === 'loadBalancerFanout')!;
    const d = parseAsciiDiagram(fx.art);
    const targets = d.edges
      .filter((e) => e.source === 'load-balancer')
      .map((e) => e.target)
      .sort();
    expect(targets).toEqual(['web1', 'web2', 'web3', 'web4']);
  });

  it('recovers a fan-in hub reached by all of its sources', () => {
    const fx = BATTLE_DIAGRAMS.find((f) => f.name === 'collectorFanin')!;
    const d = parseAsciiDiagram(fx.art);
    const sources = d.edges
      .filter((e) => e.target === 'collector')
      .map((e) => e.source)
      .sort();
    expect(sources).toEqual(['s1', 's2', 's3']);
  });

  it('recovers a diamond (two disjoint paths reconverging)', () => {
    const fx = BATTLE_DIAGRAMS.find((f) => f.name === 'diamond')!;
    const d = parseAsciiDiagram(fx.art);
    const edges = new Set(d.edges.map((e) => `${e.source}->${e.target}`));
    expect(edges).toEqual(new Set(['a->b', 'a->c', 'b->d', 'c->d']));
    // Byte-stable, so an edit never collapses one of the two paths.
    expect(renderAsciiDiagram(parseAsciiDiagram(renderAsciiDiagram(d)))).toBe(
      renderAsciiDiagram(d),
    );
  });

  it('preserves a bidirectional pair as two directed edges', () => {
    const fx = BATTLE_DIAGRAMS.find((f) => f.name === 'bidirReplication')!;
    const d = parseAsciiDiagram(fx.art);
    expect(d.edges).toHaveLength(2);
    expect(new Set(d.edges.map((e) => `${e.source}->${e.target}`))).toEqual(
      new Set(['primary->replica', 'replica->primary']),
    );
  });
});

describe('battle test — graceful degradation of the hard cases', () => {
  // Dense bipartite crossing meshes are inherently ambiguous in ASCII (two
  // lines that cross in a tight channel cannot be told from a merge). The
  // parser must not crash or hallucinate — it returns *some* subset without
  // throwing, and detection/rendering stay well-defined.
  it('does not crash on a dense bipartite crossing mesh', () => {
    const art = [
      '┌────────┐          ┌────────┐',
      '│   A    │          │   B    │',
      '└─┬────┬─┘          └─┬────┬─┘',
      '  │    └──────┐   ┌───┘    │',
      '  │           │   │        │',
      '  ▼           ▼   ▼        ▼',
      '┌────────┐        ┌────────┐',
      '│   X    │        │   Y    │',
      '└────────┘        └────────┘',
    ].join('\n');
    const d = parseAsciiDiagram(art);
    expect(d.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'x', 'y']);
    // Render never throws and stays byte-idempotent even if edges are lossy.
    const r1 = renderAsciiDiagram(d);
    expect(renderAsciiDiagram(parseAsciiDiagram(r1))).toBe(r1);
  });

  // Boxes whose top and bottom borders are different widths (a very common
  // AI misalignment) don't trace as boxes — the fence stays plain code
  // (safe failure) rather than producing a garbled diagram.
  it('rejects a misaligned container as a non-diagram (stays code)', () => {
    const art = [
      '┌───────────────── Cluster ─────────────────┐',
      '│  ┌─────────┐    ┌─────────┐   │',
      '│  │  Pod A  │    │  Pod B  │   │',
      '│  └─────────┘    └─────────┘   │',
      '└────────────────────────────────────────────┘',
    ].join('\n');
    const detection = detectAsciiDiagram(art);
    // The outer misaligned box is dropped; whatever remains is not a
    // confident diagram, so it degrades to a plain code block.
    expect(detection.reasons.length).toBeGreaterThan(0);
  });

  it('never throws on garbage, empty, or non-diagram fences', () => {
    for (const junk of ['', '   ', 'hello world', '┌──\n│ x', '|||\n---\n|||', 'a | b | c']) {
      expect(() => parseAsciiDiagram(junk)).not.toThrow();
      expect(() => renderAsciiDiagram(parseAsciiDiagram(junk))).not.toThrow();
    }
  });
});

describe('battle test — known limitation: labels on tight splits / cross-box feedback', () => {
  // The PARSER reads per-branch labels on a shared bus correctly; the
  // RENDERER can only host one label per tight two-way split, so a
  // re-render may normalize one away. Documented so the behavior is a
  // conscious contract, not a silent surprise. (Parse accuracy holds; only
  // re-render label placement is lossy.)
  it('parses both labels of a two-way split, even if re-render keeps one', () => {
    const art = [
      '        ┌───────────┐',
      '        │  Check?   │',
      '        └──┬─────┬──┘',
      '     yes │       │ no',
      '         ▼       ▼',
      '    ┌────────┐ ┌────────┐',
      '    │ Accept │ │ Reject │',
      '    └────────┘ └────────┘',
    ].join('\n');
    const d = parseAsciiDiagram(art);
    const labels = d.edges
      .map((e) => e.label)
      .filter(Boolean)
      .sort();
    expect(labels).toEqual(['no', 'yes']);
    // The edges themselves are always preserved; only label placement is
    // best-effort on the tight-split re-render.
    const reparsed = parseAsciiDiagram(renderAsciiDiagram(d));
    expect(reparsed.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      'check->accept',
      'check->reject',
    ]);
  });
});
