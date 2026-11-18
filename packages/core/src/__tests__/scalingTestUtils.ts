/**
 * Checks that code stays linear on hostile input.
 *
 * A wall-clock budget is the wrong signal for this. The suite runs ~740 files
 * in parallel on shared CI runners, and the same linear work measured 5–8×
 * slower there than on a laptop: enough to fail a 3 s budget that had 5×
 * headroom locally. What separates linear from quadratic is how the time grows
 * with the input, which does not depend on the machine. Four times the input
 * takes about 4× as long when the work is linear and about 16× when it is
 * quadratic.
 */

/** Below this growth on fourfold input, the work is linear: 4× is linear, 16× quadratic. */
export const LINEAR_GROWTH_LIMIT = 8;

/**
 * Timeout for a test that measures growth. Generous on purpose: the ratio is
 * the assertion, and a loaded runner should not fail the test on time alone.
 */
export const GROWTH_TEST_TIMEOUT_MS = 30_000;

/** Timed runs at each size. Each size keeps its fastest, so one stall cannot skew the ratio. */
const SAMPLES = 3;

function timed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

/**
 * How many times longer `run(4 * n)` takes than `run(n)`.
 *
 * Both sizes run once untimed to warm the JIT. The timed runs then alternate
 * between the sizes, so load that comes and goes on a shared runner lands on
 * both rather than on one.
 */
export function growthOnFourfoldInput(run: (n: number) => void, n: number): number {
  run(n);
  run(4 * n);
  let small = Infinity;
  let large = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    small = Math.min(
      small,
      timed(() => run(n)),
    );
    large = Math.min(
      large,
      timed(() => run(4 * n)),
    );
  }
  return large / small;
}
