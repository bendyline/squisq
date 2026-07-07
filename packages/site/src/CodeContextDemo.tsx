/**
 * CodeContextDemo
 *
 * Sample harness for `EditorShell.codeContext` — a TypeScript file rendered
 * in code mode with host-supplied context sections (a file-top summary and
 * per-symbol strips). Includes buttons that exercise the dynamic paths:
 * streaming in a section body after a delay, and re-anchoring section lines.
 * Link clicks land in a visible log so e2e can assert interception without
 * navigation.
 */

import { useCallback, useMemo, useState } from 'react';
import { EditorShell, type CodeContext } from '@bendyline/squisq-editor-react';

const SAMPLE = `import { resolve } from './resolver';
import { fetchUser } from './api';

export function loadProfile(id: string) {
  const user = fetchUser(id);
  return resolve(user);
}

export function formatProfile(profile: { name: string }) {
  return profile.name.toUpperCase();
}

export function unusedHelper() {
  return 42;
}
`;

export function CodeContextDemo() {
  const [linkLog, setLinkLog] = useState<string[]>([]);
  const [streamed, setStreamed] = useState(false);
  const [shifted, setShifted] = useState(false);

  const handleLinkClick = useCallback((href: string) => {
    setLinkLog((prev) => [...prev, href]);
    return undefined; // handled — suppress navigation
  }, []);

  const codeContext = useMemo<CodeContext>(
    () => ({
      fileTop: {
        id: 'file',
        summaryMarkdown:
          '`profile.ts` — Profile loading and formatting helpers · ↓3 imported-by · ↑2 imports',
        markdown: [
          'Loads user profiles from the API and formats them for display.',
          '',
          '**Imports (2)**',
          '- [`src/resolver.ts`](gezel-nav:src%2Fresolver.ts)',
          '- [`src/api.ts`](gezel-nav:src%2Fapi.ts)',
        ].join('\n'),
        defaultExpanded: true,
      },
      sections: [
        {
          id: 'loadProfile@4',
          line: shifted ? 5 : 4,
          summaryMarkdown: '**loadProfile** — loads a user profile · ↓3 imported-by · ↑2 uses',
          markdown: streamed
            ? [
                'Loads one profile by id and resolves its references.',
                '',
                '**Imported by (3)**',
                '- [`src/pages/home.ts`](gezel-nav:src%2Fpages%2Fhome.ts)',
                '- [`src/pages/settings.ts`](gezel-nav:src%2Fpages%2Fsettings.ts)',
                '',
                '**Used in this file by (1)**',
                '- [`formatProfile`](#L9) — line 9',
              ].join('\n')
            : undefined,
        },
        {
          id: 'formatProfile@9',
          line: shifted ? 10 : 9,
          summaryMarkdown: '**formatProfile** — function · ↓1 imported-by',
          markdown: '**Imported by (1)**\n- [`src/pages/home.ts`](gezel-nav:src%2Fpages%2Fhome.ts)',
        },
        {
          id: 'unusedHelper@13',
          line: shifted ? 14 : 13,
          summaryMarkdown: '**unusedHelper** — function',
          markdown: 'No inbound or outbound dependencies.',
        },
      ],
      linkSchemes: ['gezel-nav'],
      onLinkClick: handleLinkClick,
    }),
    [handleLinkClick, streamed, shifted],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" data-testid="ccx-stream" onClick={() => setStreamed(true)}>
          Stream in loadProfile body
        </button>
        <button type="button" data-testid="ccx-shift" onClick={() => setShifted((p) => !p)}>
          Re-anchor sections (+1 line)
        </button>
        <span data-testid="link-log" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {linkLog.join(' | ')}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <EditorShell
          initialMarkdown={SAMPLE}
          fileName="src/profile.ts"
          height="100%"
          readOnly
          showStatusBar={false}
          showPlayTab={false}
          codeContext={codeContext}
        />
      </div>
    </div>
  );
}
