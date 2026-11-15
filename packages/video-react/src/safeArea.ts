/**
 * Padding for a modal overlay that keeps its panel `margin` pixels inside the
 * device's safe areas — clear of a notch, the status bar and the home
 * indicator. A host that lays its page under the system bars publishes the
 * insets as `--squisq-safe-area-*`; otherwise the browser's own apply.
 *
 * The same contract as squisq-editor-react's dialogLayout.ts, which this
 * package cannot import.
 */
export function safeAreaPadding(margin: number): string {
  return (['top', 'right', 'bottom', 'left'] as const)
    .map(
      (side) =>
        `calc(var(--squisq-safe-area-${side}, env(safe-area-inset-${side}, 0px)) + ${margin}px)`,
    )
    .join(' ');
}
