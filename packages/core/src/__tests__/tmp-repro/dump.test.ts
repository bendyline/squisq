import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { parseMarkdown } from '../../markdown/index';
import { extractPlainText } from '../../markdown/utils';

it('dump', () => {
  const parsed = parseMarkdown('<video src="a b.mp4" controls width="480"></video>\n\nSee <video src="c.mp4"></video> here\n\n<video src="d.mp4" controls>\n</video>\n\n<audio src="e.mp3" controls></audio>\n');
  writeFileSync('C:/Users/party/AppData/Local/Temp/claude/d--gh-docblocks/060f0646-dcca-45c6-b5da-ce187d25abc3/scratchpad/dump.json', JSON.stringify(parsed.children.map((c) => ({ node: { ...c, position: undefined }, plain: extractPlainText(c) })), null, 1));
});
