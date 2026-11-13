/** Transport glyphs shared by the media-edit panels. */

export function PlayIcon() {
  return (
    <svg
      className="squisq-media-edit-icon"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 1 9 5 2 9Z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg
      className="squisq-media-edit-icon"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
      <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg
      className="squisq-media-edit-icon"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
    </svg>
  );
}
