# Third-Party Notices

This file lists the open-source dependencies used by the Squisq packages, along
with their licenses. All licenses are permissive and compatible with MIT.

---

## @bendyline/squisq (core)

| Package             | Version | License    | Repository                                                             |
| ------------------- | ------- | ---------- | ---------------------------------------------------------------------- |
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

| Package           | Version   | License                 | Repository                       |
| ----------------- | --------- | ----------------------- | -------------------------------- |
| @bendyline/squisq | workspace | MIT                     | (internal)                       |
| jszip             | 3.10.1    | MIT OR GPL-3.0-or-later | https://github.com/Stuk/jszip    |
| pdf-lib           | 1.17.1    | MIT                     | https://pdf-lib.js.org           |
| pdfjs-dist        | 4.10.38   | Apache-2.0              | https://mozilla.github.io/pdf.js |

## @bendyline/squisq-editor-react

| Package                        | Version   | License | Repository                                   |
| ------------------------------ | --------- | ------- | -------------------------------------------- |
| @bendyline/squisq              | workspace | MIT     | (internal)                                   |
| @bendyline/squisq-formats      | workspace | MIT     | (internal)                                   |
| @bendyline/squisq-react        | workspace | MIT     | (internal)                                   |
| @monaco-editor/react           | 4.7.0     | MIT     | https://github.com/suren-atoyan/monaco-react |
| @tiptap/extension-image        | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/extension-placeholder  | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/extension-table        | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/extension-table-cell   | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/extension-table-header | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/extension-table-row    | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/extension-task-item    | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/extension-task-list    | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/pm                     | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/react                  | 2.27.2    | MIT     | https://tiptap.dev                           |
| @tiptap/starter-kit            | 2.27.2    | MIT     | https://tiptap.dev                           |
| monaco-editor                  | 0.55.1    | MIT     | https://github.com/microsoft/monaco-editor   |
| react _(peer)_                 | ^18 / ^19 | MIT     | https://reactjs.org                          |
| react-dom _(peer)_             | ^18 / ^19 | MIT     | https://reactjs.org                          |

## @bendyline/squisq-video

| Package                 | Version   | License | Repository                                |
| ----------------------- | --------- | ------- | ----------------------------------------- |
| @bendyline/squisq       | workspace | MIT     | (internal)                                |
| @bendyline/squisq-react | workspace | MIT     | (internal)                                |
| @ffmpeg/ffmpeg          | 0.12.15   | MIT     | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/util            | 0.12.2    | MIT     | https://github.com/ffmpegwasm/ffmpeg.wasm |

## @bendyline/squisq-video-react

| Package                 | Version   | License | Repository                               |
| ----------------------- | --------- | ------- | ---------------------------------------- |
| @bendyline/squisq       | workspace | MIT     | (internal)                               |
| @bendyline/squisq-video | workspace | MIT     | (internal)                               |
| @bendyline/squisq-react | workspace | MIT     | (internal)                               |
| html2canvas             | 1.4.1     | MIT     | https://github.com/nicbarker/html2canvas |
| mp4-muxer               | 5.2.2     | MIT     | https://github.com/nicbarker/mp4-muxer   |
| react _(peer)_          | ^18 / ^19 | MIT     | https://reactjs.org                      |
| react-dom _(peer)_      | ^18 / ^19 | MIT     | https://reactjs.org                      |

## @bendyline/squisq-cli

| Package                   | Version   | License    | Repository                              |
| ------------------------- | --------- | ---------- | --------------------------------------- |
| @bendyline/squisq         | workspace | MIT        | (internal)                              |
| @bendyline/squisq-formats | workspace | MIT        | (internal)                              |
| @bendyline/squisq-react   | workspace | MIT        | (internal)                              |
| @bendyline/squisq-video   | workspace | MIT        | (internal)                              |
| commander                 | 12.1.0    | MIT        | https://github.com/tj/commander.js      |
| playwright-core           | 1.58.2    | Apache-2.0 | https://github.com/microsoft/playwright |

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

| Package                 | Version | License      | Used By        |
| ----------------------- | ------- | ------------ | -------------- |
| pako                    | 1.0.11  | MIT AND Zlib | jszip, pdf-lib |
| tslib                   | 1.14.1  | 0BSD         | pdf-lib        |
| @pdf-lib/standard-fonts | 1.0.0   | MIT          | pdf-lib        |
| @pdf-lib/upng           | 1.0.1   | MIT          | pdf-lib        |

---

## License Summary

| License                 | Packages                                         |
| ----------------------- | ------------------------------------------------ |
| MIT                     | majority of dependencies                         |
| Apache-2.0              | localforage, pdfjs-dist, playwright-core, Roboto |
| OFL-1.1                 | 14 self-hosted Google Fonts (see table above)    |
| MIT OR GPL-3.0-or-later | jszip (dual-licensed; MIT option used)           |
| MIT AND Zlib            | pako (both permissive)                           |
| 0BSD                    | tslib (maximally permissive)                     |

All dependencies use permissive licenses compatible with MIT. The jszip
dual-license allows choosing MIT. Apache-2.0 dependencies (localforage,
pdfjs-dist, Roboto font) require preserving their copyright notice and license
text. OFL-1.1 fonts require attribution and permit redistribution.
