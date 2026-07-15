# Format interoperability corpus

These fixtures are intentionally independent of the Squisq exporters. The HTML and CSV files are
hand-authored inputs; the Office archives are assembled from explicit vendor-neutral OOXML parts in
`goldenCorpus.fixtures.ts`; and the PDF is produced by `pdf-lib`, not by Squisq's PDF exporter.

`manifest.json` is the reviewable semantic contract. Tests compare imported structure and text (not
unstable ZIP metadata or byte-for-byte serialization), while the EPUB case verifies the exported
package spine and chapter XHTML. Add sanitized files from additional authoring applications here as
interoperability bugs are reported, along with the producer/version and expected semantics.

No fixture may contain customer data, secrets, macros, external relationships, or restrictive
licensed content.
