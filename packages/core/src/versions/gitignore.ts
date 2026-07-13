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
 */
export async function ensureVersionsGitIgnored(container: ContentContainer): Promise<void> {
  const data = await container.readFile(GITIGNORE_PATH);
  const existing = data ? decoder.decode(data) : '';

  let alreadyIgnored = false;
  for (const line of existing.split(/\r?\n/)) {
    const match = EQUIVALENT_VERSIONS_RULE.exec(line.trim());
    if (match) alreadyIgnored = match[1] !== '!';
  }
  if (alreadyIgnored) return;

  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const separator = existing.length > 0 && !existing.endsWith('\n') ? newline : '';
  const next = `${existing}${separator}${VERSIONS_IGNORE_RULE}${newline}`;
  await container.writeFile(GITIGNORE_PATH, encoder.encode(next), 'text/plain');
}
