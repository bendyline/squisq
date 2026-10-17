import type { SvgIslandDiagnostic } from '@bendyline/squisq/markdown';

/** "script, onload attribute, 2 style rules" — what sanitizing removed. */
export function describeSvgIslandRemovals(diagnostics: readonly SvgIslandDiagnostic[]): string {
  return diagnostics
    .map(({ kind, name, count }) => {
      const label =
        kind === 'element' ? `<${name}>` : kind === 'attribute' ? `${name} attribute` : name;
      return count > 1 ? `${count}× ${label}` : label;
    })
    .join(', ');
}
