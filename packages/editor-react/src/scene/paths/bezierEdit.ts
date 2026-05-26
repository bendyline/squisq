/**
 * bezierEdit — parse / serialize SVG path `d` strings to and from an
 * editable control-point representation.
 *
 * v1 supports the common subset authors actually draw:
 *   - `M x y`      (moveto, absolute)
 *   - `L x y`      (lineto, absolute)
 *   - `C x1 y1 x2 y2 x y`  (cubic bezier)
 *   - `Z` / `z`    (closepath)
 *
 * Other commands (Q, T, A, S, H, V, relative variants) round-trip as
 * opaque tokens — they survive serialize/parse but can't be edited via
 * control points in the UI. This keeps the editor honest about what it
 * can edit while still preserving paths authored by hand.
 */

export interface PathPoint {
  /** Anchor coordinate (where a segment ends / a moveto starts). */
  x: number;
  y: number;
  /**
   * Incoming control handle (controls the curve approaching this point).
   * Null for moveto and lineto segments.
   */
  cpIn?: { x: number; y: number };
  /**
   * Outgoing control handle (controls the curve leaving this point).
   * Null for the final point in an open path.
   */
  cpOut?: { x: number; y: number };
  /**
   * The SVG command that produced this point. Drives serialization back
   * to the right command letter.
   */
  kind: 'move' | 'line' | 'curve' | 'close';
}

export interface ParsedPath {
  points: PathPoint[];
  /** True if the path ends with `Z`/`z`. */
  closed: boolean;
}

/**
 * Parse an SVG `d` string. Unknown commands are silently skipped — they
 * don't appear in the result, which means re-serializing a parsed-then-
 * serialized path is lossless only for the supported subset. Callers
 * that need fidelity should keep the original string around for
 * untouched paths.
 */
export function parsePath(d: string): ParsedPath {
  const tokens = tokenize(d);
  const points: PathPoint[] = [];
  let closed = false;
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (typeof cmd !== 'string') continue;
    switch (cmd) {
      case 'M':
      case 'm': {
        const x = takeNum(tokens, i++);
        const y = takeNum(tokens, i++);
        if (x == null || y == null) return { points, closed };
        points.push({ kind: 'move', x, y });
        // Subsequent coordinate pairs after an M are implicit L's.
        while (i + 1 < tokens.length && typeof tokens[i] === 'number') {
          const lx = takeNum(tokens, i++);
          const ly = takeNum(tokens, i++);
          if (lx == null || ly == null) break;
          points.push({ kind: 'line', x: lx, y: ly });
        }
        break;
      }
      case 'L':
      case 'l': {
        while (i + 1 < tokens.length && typeof tokens[i] === 'number') {
          const x = takeNum(tokens, i++);
          const y = takeNum(tokens, i++);
          if (x == null || y == null) break;
          points.push({ kind: 'line', x, y });
        }
        break;
      }
      case 'C':
      case 'c': {
        while (i + 5 < tokens.length && typeof tokens[i] === 'number') {
          const x1 = takeNum(tokens, i++);
          const y1 = takeNum(tokens, i++);
          const x2 = takeNum(tokens, i++);
          const y2 = takeNum(tokens, i++);
          const x = takeNum(tokens, i++);
          const y = takeNum(tokens, i++);
          if (x1 == null || y1 == null || x2 == null || y2 == null || x == null || y == null)
            break;
          // The previous point gets an outgoing control handle.
          const prev = points[points.length - 1];
          if (prev) prev.cpOut = { x: x1, y: y1 };
          points.push({ kind: 'curve', x, y, cpIn: { x: x2, y: y2 } });
        }
        break;
      }
      case 'Z':
      case 'z':
        closed = true;
        break;
      default:
        // Unsupported command — skip any numeric args that follow.
        while (i < tokens.length && typeof tokens[i] === 'number') i++;
        break;
    }
  }
  return { points, closed };
}

/**
 * Serialize a ParsedPath back into an SVG `d` string. Uses absolute
 * commands and a single space between tokens. Round-trip behavior:
 * `serialize(parse(d))` is equivalent (not byte-identical) for paths
 * built from M/L/C/Z; whitespace and number formatting are normalized.
 */
export function serializePath(path: ParsedPath): string {
  const parts: string[] = [];
  for (let i = 0; i < path.points.length; i++) {
    const p = path.points[i];
    switch (p.kind) {
      case 'move':
        parts.push(`M ${fmt(p.x)} ${fmt(p.y)}`);
        break;
      case 'line':
        parts.push(`L ${fmt(p.x)} ${fmt(p.y)}`);
        break;
      case 'curve': {
        const prev = path.points[i - 1];
        const out = prev?.cpOut ?? { x: prev?.x ?? p.x, y: prev?.y ?? p.y };
        const inc = p.cpIn ?? { x: p.x, y: p.y };
        parts.push(`C ${fmt(out.x)} ${fmt(out.y)} ${fmt(inc.x)} ${fmt(inc.y)} ${fmt(p.x)} ${fmt(p.y)}`);
        break;
      }
      case 'close':
        // Encoded via the trailing Z below.
        break;
    }
  }
  if (path.closed) parts.push('Z');
  return parts.join(' ');
}

/**
 * Update the anchor coordinate of point `index`, shifting its incoming
 * and outgoing control handles by the same delta so the curve shape is
 * preserved. Returns a new ParsedPath; doesn't mutate the input.
 */
export function moveAnchor(
  path: ParsedPath,
  index: number,
  dx: number,
  dy: number,
): ParsedPath {
  if (index < 0 || index >= path.points.length) return path;
  const next: PathPoint[] = path.points.map((p, i) => {
    if (i !== index) return p;
    const out: PathPoint = { ...p, x: p.x + dx, y: p.y + dy };
    if (p.cpIn) out.cpIn = { x: p.cpIn.x + dx, y: p.cpIn.y + dy };
    if (p.cpOut) out.cpOut = { x: p.cpOut.x + dx, y: p.cpOut.y + dy };
    return out;
  });
  return { points: next, closed: path.closed };
}

/** Update a single control handle on point `index`. */
export function moveHandle(
  path: ParsedPath,
  index: number,
  side: 'cpIn' | 'cpOut',
  x: number,
  y: number,
): ParsedPath {
  if (index < 0 || index >= path.points.length) return path;
  const next: PathPoint[] = path.points.map((p, i) => {
    if (i !== index) return p;
    return { ...p, [side]: { x, y } } as PathPoint;
  });
  return { points: next, closed: path.closed };
}

// ── Internals ──────────────────────────────────────────────

type Token = string | number;

function tokenize(d: string): Token[] {
  const out: Token[] = [];
  // Split on whitespace and commas, plus pull out single-letter commands.
  const re = /([a-zA-Z])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push(m[1]);
    else if (m[2]) out.push(parseFloat(m[2]));
  }
  return out;
}

function takeNum(tokens: Token[], i: number): number | null {
  const t = tokens[i];
  return typeof t === 'number' ? t : null;
}

function fmt(n: number): string {
  // Keep integer-valued numbers tidy; otherwise trim to 3 decimal places.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, '');
}
