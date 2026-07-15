/**
 * Keep version snapshots out of Git when a ContentContainer is persisted
 * as a real folder (typically a `<basename>_files/` sidecar).
 */

import type { ContentContainer } from '../storage/ContentContainer.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const GITIGNORE_PATH = '.gitignore';
const VERSIONS_IGNORE_RULE = '.versions/';
const EQUIVALENT_VERSIONS_RULE = /^(!?)\/?\.versions\/?$/;

/**
 * Ensure the container-root `.gitignore` ignores its `.versions/` folder.
 * Existing rules and newline style are preserved.
 *
 * A user's explicit `!.versions/` un-ignore is HONORED, not overwritten:
 * committing history is a legitimate deliberate choice, and appending our
 * rule after their negation would silently win under Git's last-match-wins
 * semantics and revert that choice. Absence of any rule is the only signal
 * that we may add one; an existing rule of either polarity means the file
 * already says what the user wants.
 */
export async function ensureVersionsGitIgnored(container: ContentContainer): Promise<void> {
  const data = await container.readFile(GITIGNORE_PATH);
  const existing = data ? decoder.decode(data) : '';

  for (const line of existing.split(/\r?\n/)) {
    if (EQUIVALENT_VERSIONS_RULE.test(line.trim())) return;
  }

  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const separator = existing.length > 0 && !existing.endsWith('\n') ? newline : '';
  const next = `${existing}${separator}${VERSIONS_IGNORE_RULE}${newline}`;
  await container.writeFile(GITIGNORE_PATH, encoder.encode(next), 'text/plain');
}
