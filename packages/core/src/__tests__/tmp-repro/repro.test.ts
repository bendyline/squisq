import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { markdownToDoc, materializeBlockLayers } from '../../doc/index';
import { buildPreviewDoc } from '../../doc/buildPreviewDoc';
import { parseMarkdown } from '../../markdown/index';

const OUT =
  'C:/Users/party/AppData/Local/Temp/claude/d--gh-docblocks/060f0646-dcca-45c6-b5da-ce187d25abc3/scratchpad/repro.txt';
const log = (...parts: unknown[]) => appendFileSync(OUT, parts.join(' ') + '\n');

const md = `### How it looks {[content]}

Here is the recording

The process is as follows:

1. Start
2. First time: Download a model
   (I had Qwen)
6. Now, go into Slideshow view

<video src="combine_files/Screen Recording 2026-10-22 150905.mp4" controls width="480"></video>
`;
const md2 = md.replace('Screen Recording 2026-10-22 150905.mp4', 'rec.mp4');

for (const [name, src] of [
  ['spaces', md],
  ['nospaces', md2],
] as const) {
  it(name, () => {
    const parsed = parseMarkdown(src);
    log(
      name,
      JSON.stringify(
        parsed.children.map((c) => ({ type: c.type, value: (c as { value?: string }).value })),
      ),
    );
    const doc = markdownToDoc(parsed, { articleId: 'x', generateCoverBlock: false });
    const slide = buildPreviewDoc(doc).blocks[0]!;
    const { layers } = materializeBlockLayers(slide, { persistentLayers: false });
    log(
      name,
      slide.template,
      JSON.stringify(
        layers.map((l) => ({ id: l.id, type: l.type, c: JSON.stringify(l.content).slice(0, 600) })),
        null,
        1,
      ),
    );
  });
}
