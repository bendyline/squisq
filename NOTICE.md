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
| @bendyline/squisq-react        | workspace | MIT     | (internal)                                   |
| @monaco-editor/react           | 4.7.0     | MIT     | https://github.com/suren-atoyan/monaco-react |
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

| License                 | Packages                               |
| ----------------------- | -------------------------------------- |
| MIT                     | majority of dependencies               |
| Apache-2.0              | localforage, pdfjs-dist                |
| MIT OR GPL-3.0-or-later | jszip (dual-licensed; MIT option used) |
| MIT AND Zlib            | pako (both permissive)                 |
| 0BSD                    | tslib (maximally permissive)           |

All dependencies use permissive licenses compatible with MIT. The jszip
dual-license allows choosing MIT. Apache-2.0 dependencies (localforage,
pdfjs-dist) require preserving their copyright notice and license text, which
are included in their respective packages distributed via npm.
