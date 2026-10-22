/**
 * A uniform-grid index over boxes, for asking which nodes and edges a part of
 * the drawing holds. Built once per layout; a query visits only the cells the
 * rectangle overlaps.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class GridIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly cellSize: number;
  private readonly boxes: readonly Box[];
  private stamp: Uint32Array;
  private round = 0;

  constructor(boxes: readonly Box[], cellSize: number) {
    this.boxes = boxes;
    this.cellSize = Math.max(1, cellSize);
    this.stamp = new Uint32Array(boxes.length);
    boxes.forEach((b, i) => {
      const [c0, r0, c1, r1] = this.span(b.x, b.y, b.x + b.width, b.y + b.height);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const key = this.key(c, r);
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    });
  }

  /** Indices of every box overlapping the rectangle, in ascending order. */
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    if (++this.round === 0xffffffff) {
      this.stamp = new Uint32Array(this.boxes.length);
      this.round = 1;
    }
    const out: number[] = [];
    const [c0, r0, c1, r1] = this.span(x0, y0, x1, y1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const i of this.cells.get(this.key(c, r)) ?? []) {
          if (this.stamp[i] === this.round) continue;
          this.stamp[i] = this.round;
          const b = this.boxes[i]!;
          if (b.x <= x1 && b.x + b.width >= x0 && b.y <= y1 && b.y + b.height >= y0) out.push(i);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }

  private span(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    const s = this.cellSize;
    return [Math.floor(x0 / s), Math.floor(y0 / s), Math.floor(x1 / s), Math.floor(y1 / s)];
  }

  private key(c: number, r: number): number {
    // Cells stay within ±2^20 of the origin for any drawing a screen can show.
    return (c + 0x100000) * 0x200000 + (r + 0x100000);
  }
}
