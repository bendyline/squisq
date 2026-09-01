# Third-Party Notices

This file lists the direct open-source runtime dependencies used by the Squisq
packages, plus notable bundled and transitive components, along with their
licenses. Most dependencies are permissively licensed. The `@ffmpeg/core`
WebAssembly runtime used by browser video export is built from the upstream
FFmpeg project and external libraries; version 0.12.9 declares
GPL-2.0-or-later and is distributed under those terms.

## Scope of the Squisq MIT license

Squisq-authored source and package artifacts are licensed under the MIT license
in [`LICENSE`](LICENSE). That license is not a blanket relicensing of
third-party code, generated artifacts, fonts, icons, or binaries identified in
this notice. Each third-party component remains available under its own license
terms.

The ffmpeg.wasm JavaScript wrapper and utility packages are MIT licensed. Its
WebAssembly core has an upstream dependency on FFmpeg and external libraries
and follows the licenses applicable to that build. The
`@ffmpeg/core@0.12.9` package used by Squisq declares
`GPL-2.0-or-later`; upstream describes the component licenses in its
[licensing FAQ](https://ffmpegwasm.netlify.app/docs/faq/#what-is-the-license-of-ffmpegwasm).

Every published Squisq npm package includes a package-scoped notice covering
the third-party components relevant to that package. Packages continue to
carry Squisq's MIT `LICENSE`; each third-party component remains under its own
license terms.

---

## @bendyline/squisq (core)

| Package             | Version | License    | Repository                                                             |
| ------------------- | ------- | ---------- | ---------------------------------------------------------------------- |
| genson-js           | 0.0.8   | Apache-2.0 | https://github.com/aspecto-io/genson-js                                |
| hast-util-from-html | 2.0.3   | MIT        | https://github.com/syntax-tree/hast-util-from-html                     |
| localforage         | 1.10.0  | Apache-2.0 | https://github.com/localForage/localForage                             |
| ngeohash            | 0.6.3   | MIT        | https://github.com/sunng87/node-geohash                                |
| remark-directive    | 3.0.1   | MIT        | https://github.com/remarkjs/remark-directive                           |
| remark-frontmatter  | 5.0.0   | MIT        | https://github.com/remarkjs/remark-frontmatter                         |
| remark-gfm          | 4.0.1   | MIT        | https://github.com/remarkjs/remark-gfm                                 |
| remark-math         | 6.0.0   | MIT        | https://github.com/remarkjs/remark-math                                |
| remark-parse        | 11.0.0  | MIT        | https://github.com/remarkjs/remark/tree/main/packages/remark-parse     |
| remark-stringify    | 11.0.0  | MIT        | https://github.com/remarkjs/remark/tree/main/packages/remark-stringify |
| unified             | 11.0.5  | MIT        | https://unifiedjs.com                                                  |

## @bendyline/squisq-react

| Package            | Version   | License | Repository          |
| ------------------ | --------- | ------- | ------------------- |
| @bendyline/squisq  | workspace | MIT     | (internal)          |
| react _(peer)_     | ^18 / ^19 | MIT     | https://reactjs.org |
| react-dom _(peer)_ | ^18 / ^19 | MIT     | https://reactjs.org |

## @bendyline/squisq-formats

| Package                      | Version   | License                 | Repository                           |
| ---------------------------- | --------- | ----------------------- | ------------------------------------ |
| @bendyline/squisq            | workspace | MIT                     | (internal)                           |
| @pdf-lib/fontkit             | 1.1.1     | MIT                     | https://github.com/Hopding/fontkit   |
| @xmldom/xmldom               | 0.9.12    | MIT                     | https://github.com/xmldom/xmldom     |
| hyparquet _(peer, optional)_ | ^1.29.1   | MIT                     | https://github.com/hyparam/hyparquet |
| jszip                        | 3.10.1    | MIT OR GPL-3.0-or-later | https://github.com/Stuk/jszip        |
| pdf-lib                      | 1.17.1    | MIT                     | https://pdf-lib.js.org               |
| pdfjs-dist                   | 4.10.38   | Apache-2.0              | https://mozilla.github.io/pdf.js     |

## @bendyline/squisq-editor-react

| Package                        | Version   | License                       | Repository                                   |
| ------------------------------ | --------- | ----------------------------- | -------------------------------------------- |
| @bendyline/squisq              | workspace | MIT                           | (internal)                                   |
| @bendyline/squisq-formats      | workspace | MIT                           | (internal)                                   |
| @bendyline/squisq-react        | workspace | MIT                           | (internal)                                   |
| @fortawesome/fontawesome-free  | 7.2.0     | CC-BY-4.0 AND OFL-1.1 AND MIT | https://github.com/FortAwesome/Font-Awesome  |
| @monaco-editor/react           | 4.7.0     | MIT                           | https://github.com/suren-atoyan/monaco-react |
| @tiptap/core                   | 2.27.2    | MIT                           | https://github.com/ueberdosis/tiptap         |
| @tiptap/extension-heading      | 2.27.2    | MIT                           | https://github.com/ueberdosis/tiptap         |
| @tiptap/extension-image        | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-link         | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-mention      | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-placeholder  | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-table        | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-table-cell   | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-table-header | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-table-row    | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-task-item    | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/extension-task-list    | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/pm                     | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/react                  | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/starter-kit            | 2.27.2    | MIT                           | https://tiptap.dev                           |
| @tiptap/suggestion             | 2.27.2    | MIT                           | https://tiptap.dev                           |
| mermaid                        | 11.16.1   | MIT                           | https://github.com/mermaid-js/mermaid        |
| type-fest                      | 4.41.0    | MIT OR CC0-1.0                | https://github.com/sindresorhus/type-fest    |
| harper.js _(peer, optional)_   | ^2.7.0    | Apache-2.0                    | https://github.com/automattic/harper         |
| monaco-editor _(peer)_         | >=0.50.0  | MIT                           | https://github.com/microsoft/monaco-editor   |
| react _(peer)_                 | ^18 / ^19 | MIT                           | https://reactjs.org                          |
| react-dom _(peer)_             | ^18 / ^19 | MIT                           | https://reactjs.org                          |

`@fortawesome/fontawesome-free` ships three license-distinct asset families:
icon glyph artwork under **CC-BY-4.0** (attribution required when redistributing
the icons), the FontAwesome font files under **OFL-1.1**, and the CSS/JS
loader code under **MIT**. Each applies to its respective subset of the
package — no choose-one election.

Mermaid is Copyright (c) 2014-2022 Knut Sveidqvist and is distributed under
the MIT License. Its source and license are available at
https://github.com/mermaid-js/mermaid. Mermaid's rendering stack includes
transitive ISC, BSD-3-Clause, Apache-2.0, Unlicense, and dual-licensed
DOMPurify components called out in the transitive-dependency and license
summary tables below. `khroma` 2.1.0 omits an SPDX field from its package
metadata but ships an MIT license file with its distribution.

## @bendyline/squisq-video

| Package           | Version   | License | Repository                                |
| ----------------- | --------- | ------- | ----------------------------------------- |
| @bendyline/squisq | workspace | MIT     | (internal)                                |
| @ffmpeg/ffmpeg    | 0.12.15   | MIT     | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/util      | 0.12.2    | MIT     | https://github.com/ffmpegwasm/ffmpeg.wasm |

## @bendyline/squisq-video-react

| Package                 | Version   | License          | Repository                                |
| ----------------------- | --------- | ---------------- | ----------------------------------------- |
| @bendyline/squisq       | workspace | MIT              | (internal)                                |
| @bendyline/squisq-video | workspace | MIT              | (internal)                                |
| @bendyline/squisq-react | workspace | MIT              | (internal)                                |
| @ffmpeg/core            | 0.12.9    | GPL-2.0-or-later | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/ffmpeg          | 0.12.15   | MIT              | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/util            | 0.12.2    | MIT              | https://github.com/ffmpegwasm/ffmpeg.wasm |
| html2canvas             | 1.4.1     | MIT              | https://github.com/niklasvh/html2canvas   |
| mp4-muxer               | 5.2.2     | MIT              | https://github.com/Vanilagy/mp4-muxer     |
| react _(peer)_          | ^18 / ^19 | MIT              | https://reactjs.org                       |
| react-dom _(peer)_      | ^18 / ^19 | MIT              | https://reactjs.org                       |

`@ffmpeg/core` is the separately distributed single-thread WebAssembly runtime
used by the browser fallback and GIF encoder. It is built from the upstream
FFmpeg project and external libraries. The 0.12.9 package declares
GPL-2.0-or-later and is distributed under those terms.

Squisq's demo site distributes unmodified ESM copies of `ffmpeg-core.js` and
`ffmpeg-core.wasm`. The component-specific notice, binary hashes, complete
GPLv2 text, and exact source/build references are maintained in
`third_party/ffmpeg-core/`. The site publishes that
notice and GPL text beside the core files. The `@bendyline/squisq-video-react`
npm package also includes this notice and the GPLv2 text so hosts are informed
before redistributing the optional runtime.

Upstream identifies its `v12.14` release, commit
`d3c018aa40a241384965268f0506b73f47dee60c`, as the release containing
`@ffmpeg/core` / `@ffmpeg/core-mt` 0.12.9. Source and build materials:

- https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.14
- https://github.com/ffmpegwasm/ffmpeg.wasm/tree/d3c018aa40a241384965268f0506b73f47dee60c
- https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.14.tar.gz
- https://ffmpegwasm.netlify.app/docs/contribution/core/

Redistributors of the core files must preserve the applicable copyright and
license notices, provide a copy of the GPL, impose no additional restrictions
on recipients' GPL rights, and provide equivalent access to the complete
corresponding source for the exact binaries for as long as they distribute
them.

## @bendyline/squisq-cli

| Package                   | Version   | License    | Repository                              |
| ------------------------- | --------- | ---------- | --------------------------------------- |
| @bendyline/squisq         | workspace | MIT        | (internal)                              |
| @bendyline/squisq-formats | workspace | MIT        | (internal)                              |
| @bendyline/squisq-react   | workspace | MIT        | (internal)                              |
| @bendyline/squisq-video   | workspace | MIT        | (internal)                              |
| commander                 | 12.1.0    | MIT        | https://github.com/tj/commander.js      |
| playwright-core           | 1.58.2    | Apache-2.0 | https://github.com/microsoft/playwright |
| vite                      | 8.0.14    | MIT        | https://github.com/vitejs/vite          |

---

## Self-Hosted Google Fonts

The site package (`packages/site/public/fonts/`) includes self-hosted WOFF2
subsets for the 15 typefaces used by the built-in theme system. All fonts are
sourced from [Google Fonts](https://fonts.google.com) and distributed under
permissive licenses.

| Font               | License    | Author / Source                                                          |
| ------------------ | ---------- | ------------------------------------------------------------------------ |
| Cormorant Garamond | OFL-1.1    | Christian Talmash — https://github.com/CatharsisFonts                    |
| Crimson Text       | OFL-1.1    | Sebastian Kosch                                                          |
| DM Sans            | OFL-1.1    | Colophon Foundry — https://github.com/googlefonts/dm-fonts               |
| DM Serif Display   | OFL-1.1    | Colophon Foundry — https://github.com/googlefonts/dm-fonts               |
| Hanken Grotesk     | OFL-1.1    | Alfredo Marco Pradil — https://github.com/nicbarker/hanken-grotesk       |
| IBM Plex Sans      | OFL-1.1    | IBM Corp — https://github.com/IBM/plex                                   |
| Inter              | OFL-1.1    | Rasmus Andersson — https://github.com/rsms/inter                         |
| JetBrains Mono     | OFL-1.1    | JetBrains — https://github.com/JetBrains/JetBrainsMono                   |
| Lora               | OFL-1.1    | Cyreal — https://github.com/cyrealtype/Lora-Cyrillic                     |
| Merriweather       | OFL-1.1    | Sorkin Type — https://github.com/SorkinType/Merriweather                 |
| Oswald             | OFL-1.1    | Vernon Adams — https://github.com/googlefonts/OswaldFont                 |
| Playfair Display   | OFL-1.1    | Claus Eggers Sorensen — https://github.com/clauseggers/Playfair          |
| PT Serif           | OFL-1.1    | ParaType — https://company.paratype.com                                  |
| Roboto             | Apache-2.0 | Google — https://github.com/googlefonts/roboto                           |
| Source Serif 4     | OFL-1.1    | Frank Griesshammer / Adobe — https://github.com/adobe-fonts/source-serif |

OFL-1.1 = SIL Open Font License 1.1 — permits use, modification, and
redistribution with attribution. Full license text:
https://openfontlicense.org/open-font-license-official-text/

---

## Notable Transitive Dependencies

| Package                 | Version | License               | Used By        |
| ----------------------- | ------- | --------------------- | -------------- |
| pako                    | 1.0.11  | MIT AND Zlib          | jszip, pdf-lib |
| tslib                   | 1.14.1  | 0BSD                  | pdf-lib        |
| @pdf-lib/standard-fonts | 1.0.0   | MIT                   | pdf-lib        |
| @pdf-lib/upng           | 1.0.1   | MIT                   | pdf-lib        |
| @chevrotain/types       | 11.1.2  | Apache-2.0            | Mermaid parser |
| d3                      | 7.9.0   | ISC                   | Mermaid        |
| d3-sankey               | 0.12.3  | BSD-3-Clause          | Mermaid        |
| dompurify               | 3.4.12  | MPL-2.0 OR Apache-2.0 | Mermaid        |
| khroma                  | 2.1.0   | MIT (shipped license) | Mermaid        |
| robust-predicates       | 3.0.3   | Unlicense             | Mermaid / D3   |

---

## License Summary

| License                       | Packages                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| MIT                           | Mermaid and the majority of dependencies                                                 |
| Apache-2.0                    | genson-js, harper.js, localforage, pdfjs-dist, playwright-core, Roboto, Chevrotain types |
| MPL-2.0 OR Apache-2.0         | DOMPurify (dual-licensed; Apache-2.0 option available)                                   |
| ISC                           | D3 and most current D3 modules used by Mermaid                                           |
| BSD-3-Clause                  | d3-sankey and related legacy D3 modules                                                  |
| Unlicense                     | robust-predicates                                                                        |
| OFL-1.1                       | 14 self-hosted Google Fonts (see table above) + FontAwesome font files                   |
| CC-BY-4.0                     | FontAwesome icon artwork (attribution required when redistributing icons)                |
| GPL-2.0-or-later              | @ffmpeg/core WebAssembly runtime                                                         |
| MIT OR GPL-3.0-or-later       | jszip (dual-licensed; MIT option used)                                                   |
| MIT AND Zlib                  | pako (both permissive)                                                                   |
| 0BSD                          | tslib (maximally permissive)                                                             |
| CC-BY-4.0 AND OFL-1.1 AND MIT | @fortawesome/fontawesome-free (composite — see editor-react table note)                  |

Most dependencies use permissive licenses compatible with MIT. The jszip
dual-license allows choosing MIT, and DOMPurify offers an Apache-2.0 option.
Apache-2.0 dependencies require preserving their copyright notices and license
text. OFL-1.1 fonts require attribution and permit redistribution. The
FontAwesome Free icon artwork (CC-BY-4.0) requires visible attribution to
FontAwesome when the icons are redistributed. The separately distributed
`@ffmpeg/core` WebAssembly runtime is built from upstream FFmpeg and external
libraries; version 0.12.9 declares GPL-2.0-or-later and must be redistributed
under those terms.
