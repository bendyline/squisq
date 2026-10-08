import { describe, expect, it } from 'vitest';
import {
  findBlockVideoEmbed,
  parseHtmlToNodes,
  parseMarkdown,
  parseVideoEmbedInput,
  parseVideoEmbedUrl,
  parseVideoStartTime,
  sanitizeHtmlNodes,
  stringifyHtmlNodes,
  videoEmbedIframeAttributes,
} from '../markdown/index';
import type { HtmlElement, MarkdownBlockNode } from '../markdown/index';

const YT = 'dQw4w9WgXcQ';
const NOCOOKIE = 'https://www.youtube-nocookie.com/embed';

function blocks(markdown: string): MarkdownBlockNode[] {
  return parseMarkdown(markdown).children;
}

describe('parseVideoEmbedUrl — YouTube', () => {
  it.each([
    `https://www.youtube.com/watch?v=${YT}`,
    `https://youtube.com/watch?v=${YT}&feature=share`,
    `https://m.youtube.com/watch?v=${YT}`,
    `https://music.youtube.com/watch?v=${YT}`,
    `https://youtu.be/${YT}?si=tracking123`,
    `https://www.youtube.com/embed/${YT}?si=abc`,
    `https://www.youtube-nocookie.com/embed/${YT}`,
    `https://www.youtube.com/v/${YT}`,
    `https://www.youtube.com/live/${YT}?feature=shared`,
    `youtu.be/${YT}`,
    `www.youtube.com/watch?v=${YT}`,
    `//www.youtube.com/embed/${YT}`,
    `<https://youtu.be/${YT}>`,
    `http://www.youtube.com/watch?v=${YT}`,
  ])('recognizes %s and canonicalizes it', (input) => {
    const embed = parseVideoEmbedUrl(input);
    expect(embed).toMatchObject({
      provider: 'youtube',
      providerName: 'YouTube',
      id: YT,
      embedUrl: `${NOCOOKIE}/${YT}`,
      watchUrl: `https://www.youtube.com/watch?v=${YT}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
      aspectRatio: 16 / 9,
    });
    expect(embed?.startSeconds).toBeUndefined();
  });

  it('carries start offsets in every spelling into both URLs', () => {
    for (const input of [
      `https://youtu.be/${YT}?t=90`,
      `https://youtu.be/${YT}?t=90s`,
      `https://www.youtube.com/watch?v=${YT}&t=1m30s`,
      `https://www.youtube.com/watch?v=${YT}#t=1m30s`,
      `https://www.youtube.com/embed/${YT}?start=90`,
    ]) {
      const embed = parseVideoEmbedUrl(input);
      expect(embed?.startSeconds, input).toBe(90);
      expect(embed?.embedUrl, input).toBe(`${NOCOOKIE}/${YT}?start=90`);
      expect(embed?.watchUrl, input).toBe(`https://www.youtube.com/watch?v=${YT}&t=90s`);
    }
  });

  it('keeps playlists, with and without a starting video', () => {
    const inList = parseVideoEmbedUrl(
      `https://www.youtube.com/watch?v=${YT}&list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb`,
    );
    expect(inList?.playlistId).toBe('PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb');
    expect(inList?.embedUrl).toBe(`${NOCOOKIE}/${YT}?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb`);

    const playlist = parseVideoEmbedUrl(
      'https://www.youtube.com/playlist?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb',
    );
    expect(playlist).toMatchObject({
      id: 'PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb',
      embedUrl: `${NOCOOKIE}/videoseries?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb`,
      watchUrl: 'https://www.youtube.com/playlist?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb',
    });
    expect(playlist?.thumbnailUrl).toBeUndefined();
  });

  it('gives Shorts a portrait frame and keeps the Shorts page link', () => {
    expect(parseVideoEmbedUrl(`https://www.youtube.com/shorts/${YT}`)).toMatchObject({
      embedUrl: `${NOCOOKIE}/${YT}`,
      watchUrl: `https://www.youtube.com/shorts/${YT}`,
      aspectRatio: 9 / 16,
    });
  });

  it('undoes markdown backslash escapes in a destination', () => {
    expect(parseVideoEmbedUrl('https://youtu.be/abc\\_def-123')?.id).toBe('abc_def-123');
  });

  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/@channelname',
    'https://www.youtube.com/results?search_query=cats',
    'https://www.youtube.com/watch?v=tooShort',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ%22%3E%3Cscript%3E',
    'https://youtu.be/',
    'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/?u=https://youtu.be/dQw4w9WgXcQ',
    'https://user:pw@youtu.be/dQw4w9WgXcQ',
    'https://youtu.be:8443/dQw4w9WgXcQ',
    'javascript:alert(1)//youtu.be/dQw4w9WgXcQ',
    'ftp://youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ and more text',
    '',
  ])('rejects %s', (input) => {
    expect(parseVideoEmbedUrl(input)).toBeNull();
  });
});

describe('parseVideoEmbedUrl — other providers', () => {
  it('recognizes Vimeo pages, unlisted hashes, and player URLs', () => {
    expect(parseVideoEmbedUrl('https://vimeo.com/76979871')).toMatchObject({
      provider: 'vimeo',
      id: '76979871',
      embedUrl: 'https://player.vimeo.com/video/76979871',
      watchUrl: 'https://vimeo.com/76979871',
    });
    expect(parseVideoEmbedUrl('https://vimeo.com/76979871/a1b2c3d4e5')).toMatchObject({
      embedUrl: 'https://player.vimeo.com/video/76979871?h=a1b2c3d4e5',
      watchUrl: 'https://vimeo.com/76979871/a1b2c3d4e5',
    });
    expect(
      parseVideoEmbedUrl('https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&badge=0'),
    ).toMatchObject({ watchUrl: 'https://vimeo.com/76979871/a1b2c3d4e5' });
    expect(parseVideoEmbedUrl('https://vimeo.com/channels/staffpicks/76979871')?.id).toBe(
      '76979871',
    );
    expect(parseVideoEmbedUrl('https://vimeo.com/groups/shortfilms/videos/76979871')?.id).toBe(
      '76979871',
    );
    expect(parseVideoEmbedUrl('https://vimeo.com/showcase/123/video/76979871')?.id).toBe(
      '76979871',
    );
    expect(parseVideoEmbedUrl('https://vimeo.com/76979871#t=1m5s')).toMatchObject({
      startSeconds: 65,
      embedUrl: 'https://player.vimeo.com/video/76979871#t=65s',
      watchUrl: 'https://vimeo.com/76979871#t=65s',
    });
    expect(parseVideoEmbedUrl('https://vimeo.com/about')).toBeNull();
    expect(parseVideoEmbedUrl('https://vimeo.com/channels/staffpicks')).toBeNull();
  });

  it('recognizes Loom share and embed links, slugged or not', () => {
    const id = '0281766fa2d04bb788eaf19e65135184';
    for (const input of [
      `https://www.loom.com/share/${id}`,
      `https://loom.com/embed/${id}?sid=abc`,
      `https://www.loom.com/share/Quarterly-Review-${id}`,
    ]) {
      expect(parseVideoEmbedUrl(input), input).toMatchObject({
        provider: 'loom',
        id,
        embedUrl: `https://www.loom.com/embed/${id}`,
        watchUrl: `https://www.loom.com/share/${id}`,
      });
    }
    expect(parseVideoEmbedUrl('https://www.loom.com/share/not-an-id')).toBeNull();
  });

  it('recognizes Dailymotion pages, short links, and player URLs', () => {
    for (const input of [
      'https://www.dailymotion.com/video/x7tgad0',
      'https://www.dailymotion.com/video/x7tgad0_some-old-title-slug',
      'https://dai.ly/x7tgad0',
      'https://www.dailymotion.com/embed/video/x7tgad0',
      'https://geo.dailymotion.com/player.html?video=x7tgad0',
    ]) {
      expect(parseVideoEmbedUrl(input), input).toMatchObject({
        provider: 'dailymotion',
        id: 'x7tgad0',
        embedUrl: 'https://www.dailymotion.com/embed/video/x7tgad0',
        watchUrl: 'https://www.dailymotion.com/video/x7tgad0',
      });
    }
    expect(parseVideoEmbedUrl('https://www.dailymotion.com/video/x7tgad0?start=42')).toMatchObject({
      embedUrl: 'https://www.dailymotion.com/embed/video/x7tgad0?start=42',
      watchUrl: 'https://www.dailymotion.com/video/x7tgad0?start=42',
    });
  });

  it('recognizes Wistia media pages and player URLs', () => {
    expect(parseVideoEmbedUrl('https://home.wistia.com/medias/e4a27b971d')).toMatchObject({
      provider: 'wistia',
      id: 'e4a27b971d',
      embedUrl: 'https://fast.wistia.net/embed/iframe/e4a27b971d',
      watchUrl: 'https://home.wistia.com/medias/e4a27b971d',
    });
    expect(
      parseVideoEmbedUrl('https://fast.wistia.net/embed/iframe/e4a27b971d?videoFoam=true'),
    ).toMatchObject({ watchUrl: 'https://fast.wistia.net/embed/iframe/e4a27b971d' });
    expect(parseVideoEmbedUrl('https://wistia.com.evil.example/medias/e4a27b971d')).toBeNull();
  });
});

describe('parseVideoStartTime', () => {
  it.each([
    ['90', 90],
    ['90s', 90],
    ['1m30s', 90],
    ['1m30', 90],
    ['1h2m3s', 3723],
    ['1h', 3600],
    ['1:30', 90],
    ['1:02:03', 3723],
  ])('reads %s as %d seconds', (input, seconds) => {
    expect(parseVideoStartTime(input)).toBe(seconds);
  });

  it.each(['', '0', 'abc', '1:75', '1:75:00', '-5', null, undefined])('ignores %s', (input) => {
    expect(parseVideoStartTime(input)).toBeUndefined();
  });
});

describe('parseVideoEmbedInput', () => {
  it('accepts a page URL', () => {
    expect(parseVideoEmbedInput(`  https://youtu.be/${YT}  `)).toMatchObject({
      embed: { id: YT },
      title: null,
    });
  });

  it("reads a provider's iframe embed code, keeping an authored title", () => {
    const youtube = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?si=x" title="YouTube video player" frameborder="0" allowfullscreen></iframe>`;
    expect(parseVideoEmbedInput(youtube)).toMatchObject({
      embed: { id: YT, watchUrl: `https://www.youtube.com/watch?v=${YT}` },
      title: null,
    });
    for (const generic of ['Vimeo video player', 'vimeo-player', 'Player', 'Vimeo video']) {
      expect(
        parseVideoEmbedInput(
          `<iframe src="https://vimeo.com/76979871" title="${generic}"></iframe>`,
        )?.title,
        generic,
      ).toBeNull();
    }

    const vimeo =
      '<div style="padding:56.25% 0 0 0;position:relative;"><iframe src="https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&amp;badge=0" style="position:absolute;top:0;left:0;width:100%;height:100%;" title="Product tour"></iframe></div><script src="https://player.vimeo.com/api/player.js"></script>';
    expect(parseVideoEmbedInput(vimeo)).toMatchObject({
      embed: { provider: 'vimeo', watchUrl: 'https://vimeo.com/76979871/a1b2c3d4e5' },
      title: 'Product tour',
    });
  });

  it('rejects unknown iframes, several iframes, and other HTML', () => {
    expect(parseVideoEmbedInput('<iframe src="https://evil.example/x"></iframe>')).toBeNull();
    expect(
      parseVideoEmbedInput(
        `<iframe src="https://youtu.be/${YT}"></iframe><iframe src="https://youtu.be/${YT}"></iframe>`,
      ),
    ).toBeNull();
    expect(
      parseVideoEmbedInput(`<p>Watch: <iframe src="https://youtu.be/${YT}"></iframe></p>`),
    ).toBeNull();
    expect(parseVideoEmbedInput('<b>bold</b>')).toBeNull();
    expect(parseVideoEmbedInput('just some prose')).toBeNull();
  });
});

describe('findBlockVideoEmbed', () => {
  it('reads a paragraph that is only a titled link', () => {
    const [node] = blocks(`[Launch keynote](https://youtu.be/${YT}?t=42)`);
    expect(findBlockVideoEmbed(node!)).toMatchObject({
      embed: { id: YT, startSeconds: 42 },
      title: 'Launch keynote',
      form: 'link',
    });
  });

  it('reads a bare URL and an autolink, with no title', () => {
    for (const md of [`https://www.youtube.com/watch?v=${YT}`, `<https://youtu.be/${YT}>`]) {
      const [node] = blocks(md);
      expect(findBlockVideoEmbed(node!), md).toMatchObject({ title: null, form: 'url' });
    }
    const [linkedUrl] = blocks(`[https://youtu.be/${YT}](https://youtu.be/${YT})`);
    expect(findBlockVideoEmbed(linkedUrl!)).toMatchObject({ title: null, form: 'url' });
  });

  it('reads a bare URL whose id ends in `_`, which GFM autolinks short', () => {
    const [node] = blocks('https://www.youtube.com/watch?v=abcdefghij_');
    expect(findBlockVideoEmbed(node!)?.embed.id).toBe('abcdefghij_');
  });

  it('leaves a video link inside prose alone', () => {
    for (const md of [
      `Watch [the keynote](https://youtu.be/${YT}) first.`,
      `See https://youtu.be/${YT} for more`,
      `[one](https://youtu.be/${YT}) [two](https://youtu.be/${YT})`,
      '[a page](https://example.com/watch)',
      `![poster](https://youtu.be/${YT})`,
    ]) {
      const [node] = blocks(md);
      expect(findBlockVideoEmbed(node!), md).toBeNull();
    }
  });

  it('reads an HTML block holding a provider iframe', () => {
    const [node] = blocks(
      `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}" title="Our demo"></iframe>`,
    );
    expect(findBlockVideoEmbed(node!)).toMatchObject({
      embed: { id: YT },
      title: 'Our demo',
      form: 'iframe',
    });
  });
});

describe('video embeds in the HTML sanitizer', () => {
  it('rebuilds a provider iframe from its validated id and the canonical attributes', () => {
    const [iframe] = sanitizeHtmlNodes(
      parseHtmlToNodes(
        `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?si=x&autoplay=1&origin=https://evil.example" title="Demo" onload="alert(1)" style="position:fixed" srcdoc="<script>alert(1)</script>" sandbox="" allow="camera; microphone">fallback</iframe>`,
      ),
    ) as HtmlElement[];
    expect(iframe).toEqual({
      type: 'htmlElement',
      tagName: 'iframe',
      attributes: {
        ...videoEmbedIframeAttributes(parseVideoEmbedUrl(`https://youtu.be/${YT}`)!, 'Demo'),
        width: '560',
        height: '315',
      },
      children: [],
      selfClosing: false,
    });
    expect(iframe!.attributes.src).toBe(`${NOCOOKIE}/${YT}`);
  });

  it('still drops every other iframe with its content', () => {
    for (const html of [
      '<iframe src="https://evil.example/embed/x">text</iframe>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe></iframe>',
    ]) {
      expect(stringifyHtmlNodes(sanitizeHtmlNodes(parseHtmlToNodes(html))), html).toBe('');
    }
  });

  it('drops a non-integer width or height', () => {
    const [iframe] = sanitizeHtmlNodes(
      parseHtmlToNodes(`<iframe width="100%" height="auto" src="https://youtu.be/${YT}"></iframe>`),
    ) as HtmlElement[];
    expect(iframe!.attributes.width).toBeUndefined();
    expect(iframe!.attributes.height).toBeUndefined();
  });
});
