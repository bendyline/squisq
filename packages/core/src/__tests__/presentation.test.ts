import { describe, expect, it } from 'vitest';
import {
  defaultPresentationHints,
  parsePresentationHints,
  serializePresentationHints,
  presentationSections,
  usesDynamicPresentation,
  DYNAMIC_PRESENTATION_STYLE,
  PRESENTATION_HINTS_KEY,
  presentationPassageKey,
  type PresentationHints,
} from '../transform/presentationHints.js';
import { parseMarkdown, setFrontmatterValues } from '../markdown/index.js';
import { flattenRenderableBlocks, markdownToDoc } from '../doc/markdownToDoc.js';
import { buildPreviewDoc, previewBlockTemplate } from '../doc/buildPreviewDoc.js';
import { resolveAudioMapping } from '../doc/audioMapping.js';
import { expandDocBlocks } from '../doc/templates/index.js';
import { buildNarrationScript } from '../narration/script.js';
import {
  EMPTY_ADVANCE_LOG,
  EMPTY_SLIDE_MARK_LOG,
  buildAdvanceTimingJson,
  recordSlideMark,
} from '../narration/advanceTiming.js';
import { MemoryContentContainer } from '../storage/ContentContainer.js';
import { applyTransform } from '../transform/applyTransform.js';
import { createPresentationPlan } from '../transform/presentationPlanner.js';
import { compilePresentationPlan } from '../transform/presentationCompiler.js';
import { collectPresentationMedia, presentationMediaNode } from '../transform/presentationMedia.js';
import {
  parsePresentationPlan,
  serializePresentationPlan,
  PRESENTATION_KEY,
  type PresentationBeatLayout,
} from '../transform/presentationPlan.js';
import { extractEmbeddedVideos } from '../doc/templateInputs.js';
import { resolveMediaSchedule } from '../schemas/Media.js';
import type { Doc } from '../schemas/Doc.js';

const source =
  '# Start with an idea\n\nWrite a few bullet points. Build a document with a clear story.\n\n## Make it visual\n\nFirst organize your points. Then add diagrams. Finally share your presentation.\n\n## Keep your voice\n\nNarration runs locally. Turn the same document into a narrated video.';
const parse = (text = source) => markdownToDoc(parseMarkdown(text));
async function narrated(text = source, times = [0, 20, 40, 60]) {
  const md = `{[audio src=audio/take.webm anchor=document]}\n\n${text}`;
  const doc = parse(md);
  const script = buildNarrationScript(doc);
  const container = new MemoryContentContainer();
  await container.writeFile('audio/take.webm', new Uint8Array([1]), 'audio/webm');
  await container.writeFile(
    'audio/take.webm.timing.json',
    new TextEncoder().encode(
      JSON.stringify({
        version: 3,
        sourceText: script.sourceText,
        duration: times[times.length - 1],
        blocks: script.blocks.map((block, index) => ({
          ...block,
          blockIndex: index,
          startSec: times[index],
          endSec: times[index + 1],
        })),
        bookmarks: script.tokens.map((token, index) => ({
          id: `word-${index}`,
          charOffset: token.charOffset,
          time:
            times[token.blockIndex]! + (index - script.blocks[token.blockIndex]!.tokenStart) * 0.2,
        })),
      }),
    ),
    'application/json',
  );
  return { doc: await resolveAudioMapping(doc, container), md, container };
}
describe('source-preserving presentations', () => {
  it('uses deterministic visual plans and retains parent prose and all source ranges', () => {
    const doc = parse();
    const plan = createPresentationPlan(doc);
    expect(plan).toEqual(createPresentationPlan(doc));
    expect(parsePresentationPlan(plan)).toEqual(plan);
    expect(plan.beats).toHaveLength(3);
    expect(plan.beats[1].layout).toBe('steps');
    expect(plan.sourceText.slice(plan.beats[0].sourceStart, plan.beats[0].sourceEnd)).toContain(
      'bullet points',
    );
    const before = JSON.stringify(doc);
    compilePresentationPlan(doc, plan);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('round-trips through Markdown and does not regenerate or change the script', () => {
    const plan = createPresentationPlan(parse());
    const reopened = parse(
      setFrontmatterValues(source, { [PRESENTATION_KEY]: serializePresentationPlan(plan) }),
    );
    expect(parsePresentationPlan(reopened.frontmatter?.[PRESENTATION_KEY])).toEqual(plan);
    expect(buildNarrationScript(reopened).sourceText).toBe(plan.sourceText);
    expect(buildPreviewDoc(reopened).blocks).toHaveLength(plan.beats.length);
  });
  it('fits every visual to exact word cues and never merges short beats or splits long ones', async () => {
    const { doc } = await narrated(source, [0, 1.5, 40, 60]);
    const plan = createPresentationPlan(doc);
    const projected = buildPreviewDoc({
      ...doc,
      frontmatter: { [PRESENTATION_KEY]: serializePresentationPlan(plan) },
    });
    expect(projected.duration).toBe(60);
    expect(projected.frontmatter?.['squisq-cover-slide']).toBe(false);
    expect(projected.blocks.map((block) => block.startTime)).toEqual([0, 1.5, 40]);
    expect(projected.documentMedia).toEqual(doc.documentMedia);
    const expanded = expandDocBlocks(projected.blocks, { audioSegments: projected.audio.segments });
    expect(expanded.map((block) => [block.startTime, block.duration])).toEqual([
      [0, 1.5],
      [1.5, 38.5],
      [40, 20],
    ]);
    const diagramBackground = expanded[1]!.layers?.[0];
    expect(diagramBackground?.id).toBe('diagram-bg');
    expect(diagramBackground?.position).toMatchObject({ width: '100%', height: '100%' });
    for (const style of ['minimal', 'documentary', 'narrative', 'magazine']) {
      const throughStyle = buildPreviewDoc(
        applyTransform({ ...doc, frontmatter: projected.frontmatter }, style).doc,
      );
      expect(
        throughStyle.blocks.map((block) => [block.id, block.startTime, block.duration]),
      ).toEqual(projected.blocks.map((block) => [block.id, block.startTime, block.duration]));
    }
  });
  it('refuses stale source, stale takes, missing timings, pins, and invented assets', async () => {
    const { doc } = await narrated();
    const plan = createPresentationPlan(doc);
    expect(() => compilePresentationPlan(parse(source + '\n\nChanged.'), plan)).toThrow(
      'text has changed',
    );
    expect(() =>
      compilePresentationPlan(
        {
          ...doc,
          presentationNarration: { ...doc.presentationNarration!, sourceText: 'old take' },
        },
        plan,
      ),
    ).toThrow('narration no longer matches');
    expect(() =>
      compilePresentationPlan({ ...doc, presentationNarration: undefined }, plan),
    ).toThrow('timings are unavailable');
    const pinned = await narrated(
      source.replace('## Make it visual', '## Make it visual {[duration=3]}'),
    );
    expect(() => compilePresentationPlan(pinned.doc, plan)).toThrow('manually pinned');
    const invented = {
      ...plan,
      beats: plan.beats.map((beat, i) =>
        i ? beat : { ...beat, layout: 'image', imageSrc: 'file:///secrets.png' },
      ),
    };
    expect(parsePresentationPlan(invented)).not.toBeNull();
    expect(() => compilePresentationPlan(doc, parsePresentationPlan(invented)!)).toThrow(
      'image is no longer',
    );
    const invalid = buildPreviewDoc({ ...doc, frontmatter: { [PRESENTATION_KEY]: '{}' } });
    expect(invalid.diagnostics?.some((item) => item.code === 'presentation-invalid')).toBe(true);
  });
  it('rejects unknown fields, gaps, overlaps, malformed shapes and oversized input', () => {
    const plan = createPresentationPlan(parse());
    for (const value of [
      { ...plan, seconds: 10 },
      { ...plan, version: 2 },
      { ...plan, sourceText: 'x'.repeat(40001) },
      { ...plan, beats: [] },
      { ...plan, beats: [{ ...plan.beats[0], sourceStart: 2 }, ...plan.beats.slice(1)] },
      { ...plan, beats: [{ ...plan.beats[0], layout: 'script' }, ...plan.beats.slice(1)] },
      { ...plan, beats: [{ ...plan.beats[0], points: [null] }, ...plan.beats.slice(1)] },
    ])
      expect(parsePresentationPlan(value)).toBeNull();
  });
  it('re-resolves saved plans after a retake instead of keeping old second values', async () => {
    const first = await narrated();
    const plan = createPresentationPlan(first.doc);
    const next = await narrated(source, [0, 10, 25, 35]);
    const resolved = compilePresentationPlan(next.doc, plan);
    expect(resolved.duration).toBe(35);
    expect(resolved.blocks.map((block) => block.startTime)).toEqual([0, 10, 25]);
  });
});

describe('dynamic slide summarization', () => {
  const sky = '# Weather\n\nThe sky is pink.\n\n## Other\n\nKeep this separate passage.';
  const dynamic = (text: string, hints = defaultPresentationHints()) =>
    parse(
      setFrontmatterValues(text, {
        'squisq-transform': DYNAMIC_PRESENTATION_STYLE,
        [PRESENTATION_HINTS_KEY]: serializePresentationHints(hints),
      }),
    );
  it('stores only preferences and regenerates current text, deterministically', () => {
    const doc = dynamic(sky);
    expect(JSON.stringify(doc.frontmatter)).not.toContain('pink');
    const a = buildPreviewDoc(doc);
    expect(a).toEqual(buildPreviewDoc(doc));
    const b = buildPreviewDoc(dynamic(sky.replace('pink', 'blue')));
    expect(b.diagnostics?.some((d) => d.code === 'presentation-invalid')).not.toBe(true);
    expect(JSON.stringify(b.blocks)).toContain('blue');
    expect(JSON.stringify(b.blocks)).not.toContain('pink');
    expect(a.blocks).not.toEqual(b.blocks);
  });
  it('reuses AI wording only for an unchanged passage, including after unrelated edits', () => {
    const doc = parse(sky);
    const plan = createPresentationPlan(doc);
    const hints = defaultPresentationHints();
    const section = presentationSections(doc)[0]!;
    hints.blocks.push({
      blockId: section.blockId,
      ai: [
        {
          source: plan.sourceText.slice(plan.beats[0].sourceStart, plan.beats[0].sourceEnd),
          layout: 'statement',
          headline: 'A pink sky',
          points: ['The sky is pink.'],
        },
      ],
    });
    expect(createPresentationPlan(doc, hints).beats[0].headline).toBe('A pink sky');
    expect(
      createPresentationPlan(parse(sky.replace('separate', 'unrelated')), hints).beats[0].headline,
    ).toBe('A pink sky');
    const changed = createPresentationPlan(parse(sky.replace('pink', 'blue')), hints);
    expect(changed.origin).toBe('automatic');
    expect(JSON.stringify(changed.beats)).not.toContain('pink');
    hints.blocks[0].wording = { source: section.text, headline: 'My headline' };
    expect(createPresentationPlan(doc, hints).beats[0].headline).toBe('My headline');
    expect(
      createPresentationPlan(parse(sky.replace('pink', 'blue')), hints).beats[0].headline,
    ).not.toBe('My headline');
  });
  it('inserts supporting visuals at word cues without lengthening the narration, and honors per-section opt-out', async () => {
    const text = source.replace(
      'First organize your points. Then add diagrams. Finally share your presentation.',
      'Good slides start from a plan you can follow. First organize all your ideas into a clear sequence of points. Then add diagrams to explain how the different pieces fit together. Finally share your presentation.',
    );
    const { doc } = await narrated(text);
    const hints = defaultPresentationHints();
    const plain = createPresentationPlan(doc, { ...hints, inbetweens: false });
    const plan = createPresentationPlan(doc, hints);
    expect(plan.beats.length).toBeGreaterThan(plain.beats.length);
    // The introduction leads in; the diagram then shows only the ordered steps.
    expect(plan.beats[1]).toMatchObject({
      layout: 'statement',
      headline: 'Make it visual',
      points: ['Good slides start from a plan you can follow.'],
    });
    expect(plan.beats[2]!.layout).toBe('steps');
    expect(plan.beats[2]!.points).toHaveLength(3);
    expect(plan.beats[2]!.points[0]).toMatch(/^First organize/);
    expect(plain.beats[1]!.layout).toBe('steps');
    const projected = compilePresentationPlan(doc, plan);
    expect(projected.duration).toBe(doc.presentationNarration!.duration);
    for (const [index, block] of projected.blocks.entries()) {
      const cue =
        index === 0
          ? 0
          : doc.presentationNarration!.bookmarks.find(
              (w) => w.charOffset >= plan.beats[index].sourceStart,
            )!.time;
      expect(block.startTime).toBe(cue);
    }
    hints.blocks.push({ blockId: presentationSections(doc)[1].blockId, inbetweens: false });
    expect(createPresentationPlan(doc, hints).beats.length).toBe(plain.beats.length);
  });
  it('makes exactly one slide per section, timed to its narration, when asked', async () => {
    const text = source.replace(
      'First organize your points. Then add diagrams. Finally share your presentation.',
      'Good slides start from a plan you can follow. First organize all your ideas into a clear sequence of points. Then add diagrams to explain how the different pieces fit together. Finally share your presentation. ' +
        'Each slide should carry one idea that the narration explains in more depth. '.repeat(4),
    );
    const { doc } = await narrated(text);
    const hints = { ...defaultPresentationHints(), density: 'section' as const };
    expect(parsePresentationHints(serializePresentationHints(hints))).toEqual(hints);
    expect(
      createPresentationPlan(doc, { ...hints, density: 'concise' }).beats.length,
    ).toBeGreaterThan(4);
    // Neither long passages nor a steps introduction split a section.
    const plan = createPresentationPlan(doc, hints);
    const sections = presentationSections(doc);
    expect(plan.beats.map((beat) => sectionAt(doc, beat.sourceStart))).toEqual(
      sections.map((section) => section.blockId),
    );
    for (const [index, beat] of plan.beats.entries())
      expect(plan.sourceText.slice(beat.sourceStart, beat.sourceEnd)).toBe(
        sections[index]!.text.trim(),
      );
    expect(plan.beats[1]!.layout).toBe('steps');
    expect(compilePresentationPlan(doc, plan).blocks.map((block) => block.startTime)).toEqual([
      0, 20, 40,
    ]);
  });
  it('never shows a headline again as its body, or the same slide twice in a row', () => {
    const doc = parse(
      [
        '# Northwind',
        '![Northwind logo](images/logo.png)',
        'Northwind builds careful software for people who plan their week. Our goal is simple and steady. ' +
          'One of our core beliefs is that private tools should run on the hardware you already own, and we design every feature around that idea. ' +
          'While many products depend on remote services that change without notice, Northwind ships tools that keep working offline for years. ' +
          'By relying on local storage and the steady growth of laptop processors, we think anyone can keep their planning private and fast.',
        '## Planner',
        'The planner is a multi-step workflow tool that breaks large projects into small daily tasks, and it keeps every task on your own machine without an account.',
        '## Editor',
        'The editor turns notes into documents, slides, and videos from one Markdown file. ' +
          'It keeps your words as plain text so they stay portable between apps. ' +
          'Fun fact: this overview was drafted in the editor itself on an ordinary laptop.',
        // A pasted, resized image is saved as raw HTML, not ![alt](url).
        '<img alt="Editor screenshot" src="images/editor.png" width="246" height="280">',
      ].join('\n\n'),
    );
    const plan = createPresentationPlan(doc);
    const sections = presentationSections(doc);
    // A section heading may title a sentence that names it; a sentence-length
    // headline must not reappear as the body underneath it.
    const stem = (text: string) => text.replace(/…$/u, '').toLowerCase();
    const echoes = (point: string, headline: string) =>
      stem(headline).length > 20 &&
      (stem(point).startsWith(stem(headline)) || stem(headline).startsWith(stem(point)));
    for (const beat of plan.beats)
      for (const point of beat.points) expect(echoes(point, beat.headline)).toBe(false);
    for (const [index, beat] of plan.beats.entries()) {
      const next = plan.beats[index + 1];
      if (next) expect([next.headline, next.points]).not.toEqual([beat.headline, beat.points]);
    }
    // A complete sentence that fits on a slide is not cut off mid-thought.
    expect(plan.beats.flatMap((beat) => beat.points)).toContain(
      'By relying on local storage and the steady growth of laptop processors, we think anyone can keep their planning private and fast.',
    );
    // "multi-step" is not a sequence of steps.
    expect(plan.beats.some((beat) => beat.layout === 'steps')).toBe(false);
    // Each image appears once, inside the section that contains it.
    const pictured = plan.beats.filter((beat) => beat.imageSrc);
    expect(pictured.map((beat) => beat.imageSrc)).toEqual(['images/logo.png', 'images/editor.png']);
    for (const beat of pictured) {
      const owner = sections.find(
        (section) =>
          beat.sourceStart >= section.sourceStart && beat.sourceStart < section.sourceEnd,
      )!;
      expect(beat.imageSrc).toBe(
        owner.heading === 'Northwind' ? 'images/logo.png' : 'images/editor.png',
      );
    }
    // The compiler accepts the HTML image as a document image.
    expect(compilePresentationPlan(doc, plan).blocks.map((block) => block.template)).toContain(
      'imageWithCaption',
    );
    const headless = createPresentationPlan(
      parse(
        'Plain notes can still become slides without any headings at all. They read best when each slide adds something new to the story.',
      ),
    );
    expect(headless.beats.length).toBeGreaterThan(0);
    for (const beat of headless.beats)
      for (const point of beat.points) expect(echoes(point, beat.headline)).toBe(false);
  });
  it('leaves dynamic mode when an explicit different transform is selected', () => {
    const doc = dynamic(sky);
    expect(
      usesDynamicPresentation({ ...doc, frontmatter: { 'transform-style': 'Dynamic slides' } }),
    ).toBe(true);
    expect(
      usesDynamicPresentation({
        ...doc,
        frontmatter: { 'squisq-transform': 'minimal', 'transform-style': 'dynamic-slides' },
      }),
    ).toBe(false);
    const transformed = applyTransform(doc, 'minimal').doc;
    expect(usesDynamicPresentation(transformed)).toBe(false);
    expect(buildPreviewDoc(transformed).presentationApplied).not.toBe(true);
    expect(
      usesDynamicPresentation(applyTransform(parse(sky), DYNAMIC_PRESENTATION_STYLE).doc),
    ).toBe(true);
  });
  it('still rejects narration from old source while deriving fresh summaries', async () => {
    const { doc } = await narrated();
    const projected = buildPreviewDoc({
      ...doc,
      frontmatter: { 'squisq-transform': DYNAMIC_PRESENTATION_STYLE },
      presentationNarration: { ...doc.presentationNarration!, sourceText: 'old prose' },
    });
    expect(
      projected.diagnostics?.find((d) => d.code === 'presentation-invalid')?.message,
    ).toContain('narration no longer matches');
  });
  it('validates durable hints without accepting generated plans or unbounded caches', () => {
    expect(parsePresentationHints(serializePresentationHints(defaultPresentationHints()))).toEqual(
      defaultPresentationHints(),
    );
    for (const patch of [
      { beats: [] },
      { density: 'unknown' },
      { version: 2 },
      { blocks: [{ blockId: 'x', inbetweens: 'false' }] },
      { blocks: [{ blockId: 'x' }, { blockId: 'x' }] },
      {
        blocks: [
          { blockId: 'x', ai: [{ source: 's', layout: 'steps', headline: 'h', points: [] }] },
        ],
      },
    ])
      expect(parsePresentationHints({ ...defaultPresentationHints(), ...patch })).toBeNull();
    expect(parsePresentationHints('x'.repeat(160001))).toBeNull();
  });
});

describe('dynamic slides with embedded videos and diagrams', () => {
  const demo = [
    '# Opening',
    '',
    'This deck opens with a short welcome.',
    '',
    '## Demo',
    '',
    'Watch the recording while I explain each part of the editor. ' +
      'First we open a document and type a few rough notes into it. ' +
      'Then we ask for a review and accept the suggestions we like. ' +
      'Next we switch to the slideshow view and pick a theme for it. ' +
      'Finally we export a narrated video and share it with the team.',
    '',
    '<video src="video/demo.mp4" controls data-squisq-video-clip-end="50"></video>',
    '',
    '{[audio src=audio/bed.mp3]}',
    '',
    '## How it fits',
    '',
    '```mermaid',
    'flowchart LR',
    '  a --> b',
    '```',
    '',
    'First organize your points. Then add diagrams. Finally share your presentation.',
  ].join('\n');
  const concise = { ...defaultPresentationHints(), density: 'concise' as const };

  it('shows each section video and diagram beside its slides instead of dropping them', async () => {
    const { doc } = await narrated(demo, [0, 10, 70, 90]);
    const plan = createPresentationPlan(doc, concise);
    const section = (id: string) =>
      plan.beats.filter((beat) => sectionAt(doc, beat.sourceStart) === id);
    const demoBeats = section('demo');
    expect(demoBeats.length).toBeGreaterThan(1);
    expect(demoBeats.every((beat) => beat.media?.join() === 'demo#0')).toBe(true);
    expect(plan.beats[0]!.media).toBeUndefined();
    // A steps diagram would leave the flowchart a small inset; a list pairs them.
    const fits = section('how-it-fits');
    expect(fits.map((beat) => [beat.layout, beat.media])).toEqual([['list', ['how-it-fits#0']]]);
    expect(parsePresentationPlan(serializePresentationPlan(plan))).toEqual(plan);

    const compiled = compilePresentationPlan(doc, plan);
    const expanded = expandDocBlocks(compiled.blocks, { audioSegments: compiled.audio.segments });
    const layers = (id: string, type: string) =>
      expanded
        .find((block) => block.id === id)!
        .layers!.filter((layer) => layer.type === type) as Array<{
        content: { clipStart: number; clipEnd: number };
      }>;
    expect(layers(fits[0]!.id, 'mermaid')).toHaveLength(1);
    // Summary points are bulleted, not numbered from 1 again on every slide.
    const markers = expanded
      .find((block) => block.id === fits[0]!.id)!
      .layers!.filter((layer) => layer.id?.endsWith('-marker'))
      .map((layer) => (layer.type === 'text' ? layer.content.text : ''));
    expect(markers.length).toBeGreaterThan(1);
    expect(new Set(markers)).toEqual(new Set(['•']));
    // The recording plays on across the section's slides rather than restarting.
    const timed = compiled.blocks.filter((block) => demoBeats.some((beat) => beat.id === block.id));
    expect(timed.map((block) => layers(block.id, 'video')[0]!.content.clipStart)).toEqual(
      timed.map((block) => block.startTime - timed[0]!.startTime),
    );
    expect(layers(timed[0]!.id, 'video')[0]!.content.clipEnd).toBe(50);
  });

  it('gives a hidden slide’s visuals to the shown slides and keeps its section’s audio bed', async () => {
    const { doc } = await narrated(demo, [0, 10, 70, 90]);
    const plan = createPresentationPlan(doc, concise);
    const demoBeats = plan.beats.filter((beat) => sectionAt(doc, beat.sourceStart) === 'demo');
    const hide = (beats: typeof demoBeats) => ({
      ...concise,
      blocks: [
        {
          blockId: 'demo',
          hidden: beats.map((beat) =>
            presentationPassageKey(plan.sourceText.slice(beat.sourceStart, beat.sourceEnd)),
          ),
        },
      ],
    });
    const fewer = createPresentationPlan(doc, hide(demoBeats.slice(0, 1)));
    const shownDemo = fewer.beats.filter(
      (beat) => sectionAt(doc, beat.sourceStart) === 'demo' && !beat.hidden,
    );
    expect(fewer.beats[1]).toMatchObject({ hidden: true });
    expect(fewer.beats[1]!.media).toBeUndefined();
    expect(shownDemo.every((beat) => beat.media?.join() === 'demo#0')).toBe(true);

    // With the whole section hidden, the opening slide stays up and the bed still plays.
    const none = compilePresentationPlan(doc, createPresentationPlan(doc, hide(demoBeats)));
    expect(none.blocks.filter((block) => block.sourceBlockId === 'demo')).toHaveLength(0);
    expect(none.blocks[0]).toMatchObject({ startTime: 0, duration: 70 });
    const bed = resolveMediaSchedule(none).filter((clip) => clip.src === 'audio/bed.mp3');
    expect(bed.map((clip) => [clip.absoluteStart, clip.absoluteEnd])).toEqual([[10, 70]]);
  });

  it('keeps a section audio bed playing until that section ends', async () => {
    const { doc } = await narrated(demo, [0, 10, 70, 90]);
    const compiled = compilePresentationPlan(doc, createPresentationPlan(doc, concise));
    const bed = resolveMediaSchedule(compiled).filter((clip) => clip.src === 'audio/bed.mp3');
    expect(bed.map((clip) => [clip.absoluteStart, clip.absoluteEnd])).toEqual([[10, 70]]);
  });

  it('resumes a video only within its authored clip and refuses stale visuals', async () => {
    const { doc } = await narrated(demo, [0, 10, 70, 90]);
    const item = collectPresentationMedia(doc, ['opening', 'demo', 'how-it-fits']).get('demo')![0]!;
    const attributes = (seconds: number) =>
      extractEmbeddedVideos([presentationMediaNode(item, seconds)!])[0];
    expect(attributes(12)).toMatchObject({ clipStart: 12, clipEnd: 50 });
    expect(presentationMediaNode(item, 50)).toBeNull();
    expect(extractEmbeddedVideos([item.node])[0]!.clipStart).toBeUndefined();

    // A saved plan whose visual was removed must be made again.
    const plan = createPresentationPlan(doc, concise);
    const withoutVideo = (await narrated(demo.replace(/<video[^\n]*/u, ''), [0, 10, 70, 90])).doc;
    expect(() => compilePresentationPlan(withoutVideo, plan)).toThrow('video or diagram');
  });
});

describe('authored sections and summary layouts', () => {
  const report = [
    '# Results',
    '',
    'Revenue grew 40% last year. Most of it came from new customers.',
    '',
    '## By region {[barChart]}',
    '',
    'North led every quarter.',
    '',
    '| Region | Sales |',
    '| --- | --- |',
    '| North | 40 |',
    '| South | 25 |',
    '',
    '## Terms',
    '',
    'A ledger records every sale. It never loses an entry.',
  ].join('\n');
  const prefer = (section: string, layout: PresentationBeatLayout) => {
    const hints = defaultPresentationHints();
    hints.blocks.push({ blockId: section, layout });
    return hints;
  };
  /** The section's first slide in `plan` and the block it compiles to. */
  const slide = (doc: Doc, hints: PresentationHints, section: string) => {
    const plan = createPresentationPlan(doc, hints);
    const beat = plan.beats.find((item) => sectionAt(doc, item.sourceStart) === section)!;
    const block = compilePresentationPlan(doc, plan).blocks.find((item) => item.id === beat.id)!;
    return { plan, beat, block };
  };

  it('shows an authored section as its own block for its whole narration', async () => {
    const { doc } = await narrated(report, [0, 20, 40, 60]);
    const { plan, beat, block } = slide(doc, prefer('by-region', 'authored'), 'by-region');
    expect(plan.beats.filter((item) => sectionAt(doc, item.sourceStart) === 'by-region')).toEqual([
      beat,
    ]);
    expect(beat).toMatchObject({ layout: 'authored', headline: 'By region', points: [] });
    const section = presentationSections(doc).find((item) => item.blockId === 'by-region')!;
    expect(plan.sourceText.slice(beat.sourceStart, beat.sourceEnd)).toBe(section.text.trim());
    expect(block).toMatchObject({ template: 'barChart', startTime: 20, duration: 20 });
    expect(block.sourceBlockId).toBe('by-region');
    expect(parsePresentationPlan(serializePresentationPlan(plan))).toEqual(plan);

    // The deck draws it with the template the author picked, from its own table.
    const authored = flattenRenderableBlocks(doc.blocks).find((item) => item.id === 'by-region')!;
    expect(previewBlockTemplate(authored, doc)).toBe('barChart');
    const deck = buildPreviewDoc({
      ...doc,
      frontmatter: {
        'squisq-transform': DYNAMIC_PRESENTATION_STYLE,
        [PRESENTATION_HINTS_KEY]: serializePresentationHints(prefer('by-region', 'authored')),
      },
    });
    expect(deck.diagnostics?.some((item) => item.code === 'presentation-invalid')).not.toBe(true);
    expect(deck.blocks.find((item) => item.id === beat.id)?.template).toBe('barChart');
    expect(JSON.stringify(deck.blocks.find((item) => item.id === beat.id))).toContain('South');
  });

  it('never repeats a nested section or takes AI wording on an authored slide', () => {
    const doc = parse(report);
    const hints = prefer('results', 'authored');
    const { plan, beat } = slide(doc, hints, 'results');
    hints.blocks[0]!.ai = [
      {
        source: plan.sourceText.slice(beat.sourceStart, beat.sourceEnd),
        layout: 'statement',
        headline: 'Revenue up',
        points: [],
      },
    ];
    const { block } = slide(doc, hints, 'results');
    expect(block.children).toBeUndefined();
    const deck = buildPreviewDoc(compilePresentationPlan(doc, createPresentationPlan(doc, hints)));
    expect(deck.blocks.find((item) => item.id === block.id)?.template).toBe('content');
    expect(deck.blocks.filter((item) => item.sourceBlockId === 'by-region')).toHaveLength(1);
    expect(JSON.stringify(deck.blocks)).not.toContain('Revenue up');
    // An un-annotated heading previews as content, not a bare section header.
    const results = flattenRenderableBlocks(doc.blocks)[0]!;
    expect(results.template).toBe('sectionHeader');
    expect(previewBlockTemplate(results)).toBe('content');
  });

  it('fills each additional summary layout from the passage', () => {
    const doc = parse(report);
    expect(slide(doc, prefer('results', 'stat'), 'results').block).toMatchObject({
      template: 'statHighlight',
      stat: '40%',
      description: 'Revenue grew 40% last year.',
      detail: 'Most of it came from new customers.',
    });
    expect(slide(doc, prefer('terms', 'quote'), 'terms').block).toMatchObject({
      template: 'fullBleedQuote',
      text: 'A ledger records every sale.',
    });
    expect(slide(doc, prefer('terms', 'emphasis'), 'terms').block).toMatchObject({
      template: 'bigText',
      title: 'Terms',
    });
    expect(slide(doc, prefer('terms', 'definition'), 'terms').block).toMatchObject({
      template: 'definitionCard',
      term: 'Terms',
      definition: 'A ledger records every sale.\n\nIt never loses an entry.',
    });
    expect(slide(doc, prefer('terms', 'divider'), 'terms').block).toMatchObject({
      template: 'sectionHeader',
      title: 'Terms',
    });
    // A layout the passage cannot fill keeps the automatic choice.
    expect(slide(doc, prefer('terms', 'stat'), 'terms').beat.layout).not.toBe('stat');
    // A pull quote shows only the document's own words.
    const reworded = prefer('terms', 'quote');
    const terms = presentationSections(doc).find((item) => item.blockId === 'terms')!;
    reworded.blocks[0]!.wording = { source: terms.text, headline: 'Ledgers are forever' };
    expect(slide(doc, reworded, 'terms').beat).toMatchObject({
      layout: 'statement',
      headline: 'Ledgers are forever',
    });
  });

  it('validates layout content and authored choices in hints and saved plans', () => {
    const quote = (headline: string, layout = 'quote') => ({
      ...defaultPresentationHints(),
      blocks: [
        {
          blockId: 'terms',
          ai: [{ source: 'A ledger records every sale.', layout, headline, points: [] }],
        },
      ],
    });
    expect(parsePresentationHints(quote('A ledger records every sale.'))).not.toBeNull();
    expect(parsePresentationHints(quote('Ledgers never forget'))).toBeNull();
    expect(parsePresentationHints(quote('A ledger', 'authored'))).toBeNull();
    expect(parsePresentationHints(quote('A ledger', 'stat'))).toBeNull();
    expect(
      parsePresentationHints({
        ...defaultPresentationHints(),
        blocks: [{ blockId: 'terms', layout: 'authored' }],
      }),
    ).not.toBeNull();
    const plan = createPresentationPlan(parse(report));
    const first = plan.beats[0]!;
    expect(
      parsePresentationPlan({
        ...plan,
        beats: [{ ...first, layout: 'authored' }, ...plan.beats.slice(1)],
      }),
    ).toBeNull();
    expect(
      parsePresentationPlan({
        ...plan,
        beats: [{ ...first, layout: 'authored', points: [] }, ...plan.beats.slice(1)],
      }),
    ).not.toBeNull();
  });
});

describe('hidden slides', () => {
  const keyOf = (plan: ReturnType<typeof createPresentationPlan>, index: number) =>
    presentationPassageKey(
      plan.sourceText.slice(plan.beats[index]!.sourceStart, plan.beats[index]!.sourceEnd),
    );
  const hiding = (doc: Doc, entries: Array<[number, string[]]>): PresentationHints => ({
    ...defaultPresentationHints(),
    blocks: entries.map(([section, hidden]) => ({
      blockId: presentationSections(doc)[section]!.blockId,
      hidden,
    })),
  });

  it('leaves a hidden slide out while the shown slide before it covers its narration', async () => {
    const { doc } = await narrated(source, [0, 20, 40, 60]);
    const plan = createPresentationPlan(doc);
    const hidden = createPresentationPlan(doc, hiding(doc, [[1, [keyOf(plan, 1)]]]));
    expect(hidden.beats.map((beat) => beat.hidden)).toEqual([undefined, true, undefined]);
    expect(parsePresentationPlan(serializePresentationPlan(hidden))).toEqual(hidden);
    const deck = compilePresentationPlan(doc, hidden);
    expect(deck.duration).toBe(60);
    expect(deck.blocks.map((block) => [block.id, block.startTime, block.duration])).toEqual([
      [plan.beats[0]!.id, 0, 40],
      [plan.beats[2]!.id, 40, 20],
    ]);
    // Without the opener, the next shown slide opens the deck.
    const opener = compilePresentationPlan(
      doc,
      createPresentationPlan(doc, hiding(doc, [[0, [keyOf(plan, 0)]]])),
    );
    expect(opener.blocks.map((block) => [block.id, block.startTime, block.duration])).toEqual([
      [plan.beats[1]!.id, 0, 40],
      [plan.beats[2]!.id, 40, 20],
    ]);
    const all = createPresentationPlan(
      doc,
      hiding(
        doc,
        plan.beats.map((_, index) => [index, [keyOf(plan, index)]]),
      ),
    );
    expect(() => compilePresentationPlan(doc, all)).toThrow('Every slide is hidden');
  });

  it('shows a slide again once its passage changes, and validates saved keys', () => {
    const doc = parse(source);
    const plan = createPresentationPlan(doc);
    const hints = hiding(doc, [[2, [keyOf(plan, 2)]]]);
    expect(parsePresentationHints(serializePresentationHints(hints))).toEqual(hints);
    expect(createPresentationPlan(doc, hints).beats[2]!.hidden).toBe(true);
    const edited = parse(source.replace('runs locally', 'runs on your computer'));
    expect(createPresentationPlan(edited, hints).beats[2]!.hidden).toBeUndefined();
    for (const hidden of [[], ['Narration runs locally.'], ['ab-1', 'ab-1'], [7]])
      expect(
        parsePresentationHints({
          ...defaultPresentationHints(),
          blocks: [{ blockId: 'x', hidden }],
        }),
      ).toBeNull();
  });
});

/** The narrated section a plan offset falls in. */
function sectionAt(doc: Doc, offset: number): string | undefined {
  return buildNarrationScript(doc).blocks.find(
    (block) => offset >= block.charStart && offset < block.charEnd,
  )?.blockId;
}

describe('presentation slides timed by the presenter', () => {
  const text = source.replace(
    'First organize your points. Then add diagrams. Finally share your presentation.',
    'Good slides start from a plan you can follow. First organize all your ideas into a clear sequence of points. Then add diagrams to explain how the different pieces fit together. Finally share your presentation.',
  );
  /** A dynamic-slides doc whose presenter-advance take showed each slide at `times`. */
  async function presented(times: Array<number | undefined>) {
    const md = setFrontmatterValues(`{[audio src=audio/take.webm anchor=document]}\n\n${text}`, {
      'squisq-transform': DYNAMIC_PRESENTATION_STYLE,
    });
    const doc = parse(md);
    const plan = createPresentationPlan(doc, defaultPresentationHints());
    let marks = EMPTY_SLIDE_MARK_LOG;
    plan.beats.forEach((beat, index) => {
      const time = times[index];
      if (time !== undefined) marks = recordSlideMark(marks, beat.sourceStart, time * 1000);
    });
    const timing = buildAdvanceTimingJson(doc, EMPTY_ADVANCE_LOG, 60, { slides: marks });
    const container = new MemoryContentContainer();
    await container.writeFile('audio/take.webm', new Uint8Array([1]), 'audio/webm');
    await container.writeFile(
      'audio/take.webm.timing.json',
      new TextEncoder().encode(JSON.stringify(timing)),
      'application/json',
    );
    return { plan, deck: buildPreviewDoc(await resolveAudioMapping(doc, container)) };
  }

  it('starts each summarized slide where the presenter first showed it', async () => {
    const { plan, deck } = await presented([0, 7, 19, 33]);
    expect(plan.beats).toHaveLength(4);
    expect(deck.presentationApplied).toBe(true);
    expect(deck.blocks.map((block) => block.startTime)).toEqual([0, 7, 19, 33]);
    const last = deck.blocks[deck.blocks.length - 1]!;
    expect(last.startTime + last.duration).toBe(60);
  });

  it('places a slide the take did not mark between the marks around it', async () => {
    const { deck } = await presented([0, undefined, 19, 33]);
    const [, unmarked, next] = deck.blocks.map((block) => block.startTime);
    expect(unmarked).toBeGreaterThan(0);
    expect(unmarked).toBeLessThan(19);
    expect(next).toBe(19);
  });
});
