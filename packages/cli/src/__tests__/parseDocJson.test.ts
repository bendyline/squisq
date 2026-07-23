import { describe, it } from 'mocha';
import { expect } from 'chai';

import { parseDocJson } from '../util/readInput.js';

/**
 * The CLI accepts `doc.json` (standalone) and `doc.json` / `story.json` inside
 * containers. These used to be `JSON.parse(content) as Doc` with zero checking,
 * so a malformed file surfaced far downstream as
 * `Cannot read properties of undefined (reading 'blocks')`, and a NaN duration
 * silently poisoned the audio timeline (reaching ffmpeg as `adelay=NaN`).
 */
describe('parseDocJson', () => {
  const valid = JSON.stringify({
    articleId: 'a',
    duration: 5,
    blocks: [{ id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] }],
    audio: { segments: [{ src: 'audio/a.mp3', name: 'a', duration: 5, startTime: 0 }] },
  });

  it('accepts a well-formed Doc', () => {
    const doc = parseDocJson(valid, 'doc.json');
    expect(doc.blocks).to.have.length(1);
    expect(doc.audio.segments).to.have.length(1);
  });

  it('rejects a missing required audio track at the JSON boundary', () => {
    const parse = () =>
      parseDocJson(JSON.stringify({ articleId: 'a', duration: 0, blocks: [] }), 'doc.json');
    expect(parse).to.throw(/"audio" must be an object \(field is missing\)/);
  });

  it('names the file and the JSON error for unparseable input', () => {
    expect(() => parseDocJson('{ not json', 'my-doc.json')).to.throw(
      /my-doc\.json is not valid JSON/,
    );
  });

  it('rejects a non-object payload', () => {
    expect(() => parseDocJson('[]', 'doc.json')).to.throw(/expected a JSON object, got an array/);
    expect(() => parseDocJson('"hi"', 'doc.json')).to.throw(/expected a JSON object/);
    expect(() => parseDocJson('null', 'doc.json')).to.throw(/expected a JSON object/);
  });

  it('rejects a missing blocks array with an actionable message', () => {
    expect(() =>
      parseDocJson(
        JSON.stringify({ articleId: 'a', duration: 0, audio: { segments: [] } }),
        'doc.json',
      ),
    ).to.throw(/"blocks" must be an array \(field is missing\)/);
  });

  it('rejects a non-array blocks field', () => {
    expect(() =>
      parseDocJson(
        JSON.stringify({ articleId: 'a', duration: 0, blocks: {}, audio: { segments: [] } }),
        'doc.json',
      ),
    ).to.throw(/"blocks" must be an array/);
  });

  it('rejects a non-object block entry', () => {
    expect(() =>
      parseDocJson(
        JSON.stringify({
          articleId: 'a',
          duration: 0,
          blocks: ['nope'],
          audio: { segments: [] },
        }),
        'doc.json',
      ),
    ).to.throw(/"blocks\[0\]" must be an object/);
  });

  it('rejects malformed required block fields and nested children', () => {
    const malformed = JSON.stringify({
      articleId: 'a',
      duration: 1,
      blocks: [{ id: 42, startTime: 0, duration: 'forever', audioSegment: 0, children: 'x' }],
      audio: { segments: [] },
    });
    const parse = () => parseDocJson(malformed, 'doc.json');
    expect(parse).to.throw(/"blocks\[0\]\.id" must be a string/);
    expect(parse).to.throw(/"blocks\[0\]\.duration" must be a finite number/);
    expect(parse).to.throw(/"blocks\[0\]\.children" must be an array/);
  });

  it('rejects a NaN duration (JSON null round-trip of NaN)', () => {
    // JSON.stringify(NaN) emits `null`, which is exactly how a NaN duration
    // reaches disk in practice.
    expect(() =>
      parseDocJson(
        JSON.stringify({ articleId: 'a', blocks: [], duration: NaN, audio: { segments: [] } }),
        'doc.json',
      ),
    ).to.throw(/"duration" must be a finite number \(got null\)/);
  });

  it('rejects a string duration', () => {
    expect(() =>
      parseDocJson(
        JSON.stringify({ articleId: 'a', blocks: [], duration: '5', audio: { segments: [] } }),
        'doc.json',
      ),
    ).to.throw(/"duration" must be a finite number \(got "5"\)/);
  });

  it('rejects a non-finite audio segment duration — the adelay=NaN source', () => {
    const bad = JSON.stringify({
      articleId: 'a',
      duration: 0,
      blocks: [],
      audio: { segments: [{ src: 'a.mp3', name: 'a', duration: NaN, startTime: 0 }] },
    });
    expect(() => parseDocJson(bad, 'doc.json')).to.throw(
      /"audio\.segments\[0\]\.duration" must be a finite number/,
    );
  });

  it('reports the index of the offending segment', () => {
    const bad = JSON.stringify({
      articleId: 'a',
      duration: 0,
      blocks: [],
      audio: {
        segments: [
          { src: 'a.mp3', name: 'a', duration: 1, startTime: 0 },
          { src: 'b.mp3', name: 'b', duration: 'x', startTime: 1 },
        ],
      },
    });
    expect(() => parseDocJson(bad, 'doc.json')).to.throw(/"audio\.segments\[1\]\.duration"/);
  });

  it('rejects a malformed audio track', () => {
    expect(() =>
      parseDocJson(
        JSON.stringify({ articleId: 'a', duration: 0, blocks: [], audio: [] }),
        'doc.json',
      ),
    ).to.throw(/"audio" must be an object/);
    expect(() =>
      parseDocJson(
        JSON.stringify({ articleId: 'a', duration: 0, blocks: [], audio: { segments: 'x' } }),
        'doc.json',
      ),
    ).to.throw(/"audio\.segments" must be an array/);
  });
});
