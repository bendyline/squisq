/** The motivating timeline from the feature request, byte-for-byte inside its fence. */
export const TICK_INTERPOLATION_TIMELINE = ` kernel ticks (30 Hz):     T28        T29        T30        T31
 ─────────────────────●──────────●──────────●──────────●──────────► sim time
 deltas sent:         └─Δ28──────└─Δ29──────└─Δ30──────└─Δ31

 client frames (e.g. 120 Hz):  f f f f f f f f f f f f f f f f
 estimated kernel clock:                        ▲ estTick ≈ 30.4
 render position:                   ▲ renderTick = estTick − 1.5 ≈ 28.9
                                    └─ interpolate between snapshot T28 and T29 at t=0.9`;

/** Two independently labelled tracks plus an explicit cross-track branch. */
export const MULTI_TRACK_BRANCH_TIMELINE = [
  'Kernel: ● T28 :: snapshot {#t28} ──────────● T29 :: snapshot {#t29} ──────────►',
  'Client: ● F28 :: snapshot {#f28} ──────────● F29 :: snapshot {#f29} ──────────►',
  'branch: t29 -> f29 : interpolation path',
].join('\n');

/** Sparse ASCII form: only an explicit `timeline` fence should claim it. */
export const SINGLE_POINT_ASCII_TIMELINE = 'Release: *---- Alpha {#alpha} ---->';
