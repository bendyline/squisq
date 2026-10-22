/**
 * The viewer's stylesheet, rendered with each viewer so it needs no CSS
 * import. Every color is a custom property with a light fallback; a host
 * themes the viewer by setting them on an ancestor.
 */

const TONES: Record<string, string> = {
  accent: '#2563eb',
  positive: '#15803d',
  notice: '#a16207',
  warning: '#c2410c',
  danger: '#dc2626',
  muted: '#94a3b8',
};

const toneRules = Object.entries(TONES)
  .map(
    ([tone, color]) =>
      `.squisq-graph-view .gv-node[data-tone="${tone}"]>.gv-box{stroke:var(--squisq-graph-tone-${tone},${color})}` +
      `.squisq-graph-view .gv-edge[data-tone="${tone}"]>.gv-line{stroke:var(--squisq-graph-tone-${tone},${color})}` +
      `.squisq-graph-view .gv-arrow-${tone}{fill:var(--squisq-graph-tone-${tone},${color})}`,
  )
  .join('');

export const GRAPH_TONE_NAMES = ['neutral', ...Object.keys(TONES)] as const;

export const GRAPH_VIEW_CSS =
  '.squisq-graph-view{position:relative;overflow:hidden;outline:none;touch-action:none;user-select:none;' +
  '-webkit-user-select:none;background:var(--squisq-graph-bg,transparent);font-family:inherit}' +
  '.squisq-graph-view:focus-visible{box-shadow:inset 0 0 0 2px var(--squisq-graph-focus,#2563eb)}' +
  '.squisq-graph-view>svg{display:block;width:100%;height:100%;cursor:grab}' +
  '.squisq-graph-view[data-panning]>svg{cursor:grabbing}' +
  '.squisq-graph-view .gv-frame{fill:var(--squisq-graph-container-bg,rgba(100,116,139,.07));' +
  'stroke:var(--squisq-graph-container-border,rgba(100,116,139,.4));stroke-width:1px;vector-effect:non-scaling-stroke}' +
  '.squisq-graph-view .gv-container-label{font-size:12px;font-weight:600;fill:var(--squisq-graph-muted,#475569)}' +
  '.squisq-graph-view .gv-box{fill:var(--squisq-graph-node-bg,#fff);stroke:var(--squisq-graph-node-border,#94a3b8);' +
  'stroke-width:1px;vector-effect:non-scaling-stroke}' +
  '.squisq-graph-view .gv-node[data-collapsed]>.gv-box{stroke-dasharray:none;stroke-width:1.5px}' +
  '.squisq-graph-view .gv-stack{fill:var(--squisq-graph-node-bg,#fff);stroke:var(--squisq-graph-node-border,#94a3b8);' +
  'stroke-width:1px;vector-effect:non-scaling-stroke}' +
  '.squisq-graph-view .gv-node{cursor:pointer}' +
  '.squisq-graph-view .gv-label{font-size:12px;fill:var(--squisq-graph-text,#1f2937);pointer-events:none}' +
  '.squisq-graph-view .gv-detail{font-size:10px;fill:var(--squisq-graph-muted,#64748b);pointer-events:none}' +
  '.squisq-graph-view .gv-badge>rect{fill:var(--squisq-graph-badge-bg,rgba(100,116,139,.15))}' +
  '.squisq-graph-view .gv-badge>text{font-size:10px;font-weight:600;fill:var(--squisq-graph-text,#1f2937)}' +
  '.squisq-graph-view .gv-toggle{cursor:pointer}' +
  '.squisq-graph-view .gv-toggle>path{fill:none;stroke:var(--squisq-graph-muted,#64748b);stroke-width:1.5px;' +
  'vector-effect:non-scaling-stroke}' +
  '.squisq-graph-view .gv-toggle>rect{fill:transparent}' +
  '.squisq-graph-view .gv-line{fill:none;stroke:var(--squisq-graph-edge,#64748b);stroke-opacity:.85;' +
  'vector-effect:non-scaling-stroke}' +
  '.squisq-graph-view .gv-edge[data-dashed]>.gv-line{stroke-dasharray:5 4}' +
  '.squisq-graph-view .gv-hit{fill:none;stroke:transparent;stroke-width:10px;vector-effect:non-scaling-stroke;' +
  'pointer-events:stroke;cursor:pointer}' +
  '.squisq-graph-view .gv-arrow-neutral{fill:var(--squisq-graph-edge,#64748b)}' +
  toneRules +
  '.squisq-graph-view .gv-node,.squisq-graph-view .gv-edge{transition:opacity 120ms}' +
  '.squisq-graph-view[data-dim] .gv-node,.squisq-graph-view[data-dim] .gv-edge{opacity:.15}' +
  '.squisq-graph-view.gv-lod-0 .gv-label,.squisq-graph-view.gv-lod-0 .gv-detail,' +
  '.squisq-graph-view.gv-lod-0 .gv-badge,.squisq-graph-view.gv-lod-0 .gv-container-label,' +
  '.squisq-graph-view.gv-lod-0 .gv-toggle{display:none}' +
  '.squisq-graph-view.gv-lod-1 .gv-detail,.squisq-graph-view.gv-lod-1 .gv-badge{display:none}' +
  '.squisq-graph-view .gv-controls{position:absolute;right:8px;bottom:8px;display:flex;align-items:center;gap:2px;' +
  'padding:2px;border-radius:6px;background:var(--squisq-graph-controls-bg,rgba(255,255,255,.92));' +
  'border:1px solid var(--squisq-graph-container-border,rgba(100,116,139,.4))}' +
  '.squisq-graph-view .gv-controls>button{min-width:28px;height:26px;padding:0 6px;border:0;border-radius:4px;' +
  'background:transparent;color:var(--squisq-graph-text,#1f2937);font:inherit;font-size:13px;cursor:pointer}' +
  '.squisq-graph-view .gv-controls>button:hover{background:var(--squisq-graph-badge-bg,rgba(100,116,139,.15))}' +
  '.squisq-graph-view .gv-controls>output{min-width:40px;text-align:center;font-size:12px;' +
  'color:var(--squisq-graph-muted,#64748b)}' +
  '.squisq-graph-view .gv-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);' +
  'white-space:nowrap}' +
  '@media (prefers-reduced-motion:reduce){.squisq-graph-view .gv-node,.squisq-graph-view .gv-edge{transition:none}}';
