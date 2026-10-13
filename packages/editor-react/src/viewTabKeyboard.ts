import type { KeyboardEvent } from 'react';

/** Horizontal tablists use a single tab stop and arrow/Home/End navigation. */
export function navigateViewTabs(event: KeyboardEvent<HTMLButtonElement>): number | null {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return null;
  const tabs = [
    ...(event.currentTarget
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []),
  ];
  if (!tabs.length) return null;
  event.preventDefault();
  const current = tabs.indexOf(event.currentTarget);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  return next;
}
