import type { ReactNode } from 'react';
import type { MermaidDiagramPreview } from './mermaidDiagramTypes';

/** Small authored SVG cues; these avoid spinning up Mermaid for every gallery tile. */
export function MermaidDiagramTypeThumbnail({ preview }: { preview: MermaidDiagramPreview }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const;

  let art: ReactNode;
  switch (preview) {
    case 'sequence':
      art = (
        <>
          <rect x="14" y="8" width="28" height="12" rx="2" />
          <rect x="78" y="8" width="28" height="12" rx="2" />
          <path d="M28 20v36M92 20v36M30 30h58l-6-4m6 4-6 4M90 45H32l6-4m-6 4 6 4" />
        </>
      );
      break;
    case 'state':
      art = (
        <>
          <circle cx="13" cy="32" r="5" fill="currentColor" />
          <rect x="32" y="20" width="34" height="24" rx="10" />
          <circle cx="101" cy="32" r="8" />
          <circle cx="101" cy="32" r="4" fill="currentColor" />
          <path d="M18 32h14m34 0h27m-5-4 5 4-5 4" />
        </>
      );
      break;
    case 'class':
    case 'requirement':
      art = (
        <>
          <rect x="10" y="10" width="40" height="44" rx="2" />
          <path d="M10 23h40M10 37h40M24 29h18M18 44h24" />
          <rect x="75" y="18" width="35" height="30" rx="2" />
          <path d="M50 32h25m-6-4 6 4-6 4M82 28h20M82 38h14" />
        </>
      );
      break;
    case 'er':
      art = (
        <>
          <rect x="8" y="17" width="35" height="30" rx="2" />
          <rect x="78" y="17" width="35" height="30" rx="2" />
          <path d="M43 32h35M50 26v12m21-12v12M55 32l6-6v12z" />
        </>
      );
      break;
    case 'mindmap':
      art = (
        <>
          <ellipse cx="60" cy="32" rx="20" ry="10" />
          <path d="M40 29L18 16m22 19L18 49m62-20 22-13M80 35l22 14" />
          <circle cx="15" cy="14" r="5" />
          <circle cx="15" cy="50" r="5" />
          <circle cx="105" cy="14" r="5" />
          <circle cx="105" cy="50" r="5" />
        </>
      );
      break;
    case 'c4':
    case 'architecture':
      art = (
        <>
          <rect x="6" y="7" width="108" height="50" rx="5" strokeDasharray="4 3" />
          <rect x="14" y="21" width="25" height="20" rx="3" />
          <rect x="48" y="21" width="25" height="20" rx="3" />
          <ellipse cx="99" cy="31" rx="12" ry="10" />
          <path d="M39 31h9m25 0h14m-5-4 5 4-5 4" />
        </>
      );
      break;
    case 'gantt':
      art = (
        <>
          <path d="M20 8v48M20 16h94M20 30h94M20 44h94M40 8v48M65 8v48M90 8v48" opacity=".35" />
          <rect x="28" y="19" width="30" height="7" rx="2" fill="currentColor" />
          <rect x="52" y="33" width="42" height="7" rx="2" fill="currentColor" />
          <path d="M94 47l5 5 5-5-5-5z" fill="currentColor" />
        </>
      );
      break;
    case 'timeline':
    case 'journey':
      art = (
        <>
          <path d="M8 38h104M18 38V20M58 38V12M99 38V24" />
          <circle cx="18" cy="38" r="5" fill="currentColor" />
          <circle cx="58" cy="38" r="5" fill="currentColor" />
          <circle cx="99" cy="38" r="5" fill="currentColor" />
          <path d="M12 17h22M48 9h25M88 21h25" />
        </>
      );
      break;
    case 'kanban':
      art = (
        <>
          <rect x="7" y="8" width="31" height="48" rx="3" />
          <rect x="44" y="8" width="31" height="48" rx="3" />
          <rect x="81" y="8" width="31" height="48" rx="3" />
          <path d="M13 17h19M50 17h19M87 17h19" />
          <rect x="12" y="24" width="21" height="10" rx="2" fill="currentColor" opacity=".55" />
          <rect x="49" y="24" width="21" height="17" rx="2" fill="currentColor" opacity=".55" />
          <rect x="86" y="24" width="21" height="10" rx="2" fill="currentColor" opacity=".55" />
        </>
      );
      break;
    case 'git':
      art = (
        <>
          <path d="M13 16h94M34 16c10 0 8 32 22 32h40" />
          {[13, 34, 68, 96].map((x) => (
            <circle key={x} cx={x} cy="16" r="5" fill="currentColor" />
          ))}
          <circle cx="56" cy="48" r="5" fill="currentColor" />
          <circle cx="96" cy="48" r="5" fill="currentColor" />
        </>
      );
      break;
    case 'pie':
      art = (
        <>
          <circle cx="60" cy="32" r="24" />
          <path d="M60 32V8a24 24 0 0 1 20.8 36z" fill="currentColor" opacity=".65" />
          <path d="M60 32l20.8 12A24 24 0 0 1 38 48z" fill="currentColor" opacity=".32" />
        </>
      );
      break;
    case 'quadrant':
      art = (
        <>
          <path d="M12 54h98M12 54V8M61 8v46M12 31h98" opacity=".55" />
          <circle cx="35" cy="20" r="5" fill="currentColor" />
          <circle cx="85" cy="17" r="5" fill="currentColor" opacity=".7" />
          <circle cx="73" cy="42" r="5" fill="currentColor" opacity=".45" />
        </>
      );
      break;
    case 'sankey':
      art = (
        <>
          <rect x="7" y="12" width="9" height="40" rx="2" fill="currentColor" />
          <rect x="55" y="8" width="9" height="48" rx="2" fill="currentColor" opacity=".65" />
          <rect x="104" y="10" width="9" height="18" rx="2" fill="currentColor" />
          <rect x="104" y="38" width="9" height="14" rx="2" fill="currentColor" opacity=".5" />
          <path
            d="M16 20C35 20 37 17 55 17M16 44c20 0 21 3 39 3M64 18c20 0 21 0 40 0M64 45c20 0 20 0 40 0"
            strokeWidth="8"
            opacity=".35"
          />
        </>
      );
      break;
    case 'xy':
      art = (
        <>
          <path d="M15 8v46h96" />
          <rect x="27" y="35" width="10" height="19" fill="currentColor" opacity=".35" />
          <rect x="51" y="25" width="10" height="29" fill="currentColor" opacity=".35" />
          <rect x="75" y="16" width="10" height="38" fill="currentColor" opacity=".35" />
          <path d="M20 43l24-12 24 5 33-22" strokeWidth="3" />
          <circle cx="44" cy="31" r="3" fill="currentColor" />
          <circle cx="68" cy="36" r="3" fill="currentColor" />
          <circle cx="101" cy="14" r="3" fill="currentColor" />
        </>
      );
      break;
    default:
      art = (
        <>
          <rect x="8" y="18" width="35" height="28" rx="3" />
          <path d="M43 32h33m-6-5 6 5-6 5" />
          <rect x="77" y="18" width="35" height="28" rx="3" />
        </>
      );
  }

  return (
    <svg viewBox="0 0 120 64" aria-hidden="true" focusable="false" {...common}>
      {art}
    </svg>
  );
}
