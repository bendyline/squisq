import type { ReactNode } from 'react';
import type { ChartTypePreview } from './chartTypes';

/** Small authored SVG cues for the chart-type gallery tiles. */
export function ChartTypeThumbnail({ preview }: { preview: ChartTypePreview }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const;

  let art: ReactNode;
  switch (preview) {
    case 'bar':
      art = (
        <>
          <path d="M14 8v48" />
          <rect x="14" y="12" width="80" height="9" fill="currentColor" opacity=".55" />
          <rect x="14" y="27" width="52" height="9" fill="currentColor" opacity=".35" />
          <rect x="14" y="42" width="66" height="9" fill="currentColor" opacity=".45" />
        </>
      );
      break;
    case 'column':
      art = (
        <>
          <path d="M10 54h100" />
          <rect x="22" y="26" width="14" height="28" fill="currentColor" opacity=".45" />
          <rect x="44" y="14" width="14" height="40" fill="currentColor" opacity=".55" />
          <rect x="66" y="22" width="14" height="32" fill="currentColor" opacity=".4" />
          <rect x="88" y="34" width="14" height="20" fill="currentColor" opacity=".35" />
        </>
      );
      break;
    case 'pie':
      art = (
        <>
          <circle cx="60" cy="32" r="24" />
          <path d="M60 32V8a24 24 0 0 1 22.6 31.9Z" fill="currentColor" opacity=".45" />
          <path d="M60 32 82.6 39.9A24 24 0 0 1 46 53.4Z" fill="currentColor" opacity=".25" />
        </>
      );
      break;
    case 'donut':
      art = (
        <>
          <circle cx="60" cy="32" r="24" />
          <circle cx="60" cy="32" r="11" />
          <path
            d="M60 8a24 24 0 0 1 22.6 31.9l-12.4-4.3A11 11 0 0 0 60 21Z"
            fill="currentColor"
            opacity=".45"
          />
        </>
      );
      break;
    case 'line':
      art = (
        <>
          <path d="M10 54h100M10 8v46" opacity=".4" />
          <path d="M16 46l24-16 24 8 24-20 20 6" strokeWidth="3" />
          <circle cx="40" cy="30" r="3" fill="currentColor" />
          <circle cx="64" cy="38" r="3" fill="currentColor" />
          <circle cx="88" cy="18" r="3" fill="currentColor" />
        </>
      );
      break;
    case 'area':
      art = (
        <>
          <path d="M10 54h100" opacity=".4" />
          <path
            d="M16 46l24-16 24 8 24-20 20 6v30H16Z"
            fill="currentColor"
            opacity=".3"
            stroke="none"
          />
          <path d="M16 46l24-16 24 8 24-20 20 6" strokeWidth="3" />
        </>
      );
      break;
    case 'scatter':
      art = (
        <>
          <path d="M14 8v46h92" opacity=".4" />
          <circle cx="30" cy="42" r="3.5" fill="currentColor" opacity=".5" />
          <circle cx="42" cy="30" r="3.5" fill="currentColor" />
          <circle cx="56" cy="36" r="3.5" fill="currentColor" opacity=".5" />
          <circle cx="70" cy="22" r="3.5" fill="currentColor" />
          <circle cx="84" cy="27" r="3.5" fill="currentColor" opacity=".5" />
          <circle cx="98" cy="14" r="3.5" fill="currentColor" />
        </>
      );
      break;
  }

  return (
    <svg viewBox="0 0 120 64" aria-hidden="true" focusable="false" {...common}>
      {art}
    </svg>
  );
}
