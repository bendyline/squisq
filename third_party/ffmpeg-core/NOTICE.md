# @ffmpeg/core 0.12.9 - license and source notice

Squisq distributes the following unmodified files from the ESM build of
`@ffmpeg/core@0.12.9` with its demo site:

| File               | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `ffmpeg-core.js`   | `67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3` |
| `ffmpeg-core.wasm` | `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7` |

## License

`@ffmpeg/core` is a WebAssembly build with an upstream dependency on the
FFmpeg project and external libraries. The license applicable to a particular
core build follows the components and configuration used to produce it. The
`@ffmpeg/core@0.12.9` package metadata declares `GPL-2.0-or-later`.

The two files above are provided under GNU GPL version 2 or, at the
recipient's option, any later version. A verbatim copy of GPLv2 is in
`COPYING.GPL-2.0.txt` beside this notice. The `@ffmpeg/ffmpeg` JavaScript
wrapper and `@ffmpeg/util` package are separate MIT-licensed components.

Upstream licensing references:

- https://ffmpegwasm.netlify.app/docs/faq/#what-is-the-license-of-ffmpegwasm
- https://ffmpeg.org/legal.html

## Corresponding source

Squisq does not modify the distributed `@ffmpeg/core` files. Upstream's
`v12.14` release identifies `@ffmpeg/core` / `@ffmpeg/core-mt` version 0.12.9
and commit `d3c018aa40a241384965268f0506b73f47dee60c` as that release's source.
The tagged tree contains the ffmpeg.wasm source, patches, Dockerfile, and build
scripts, including the recipes for the FFmpeg and external-library source
inputs compiled into the WebAssembly artifact.

Equivalent network access to that source and its build materials is available
here:

- Release and build notes:
  https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.14
- Version-pinned source tree:
  https://github.com/ffmpegwasm/ffmpeg.wasm/tree/d3c018aa40a241384965268f0506b73f47dee60c
- Source archive:
  https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.14.tar.gz
- Core build instructions:
  https://ffmpegwasm.netlify.app/docs/contribution/core/

Recipients may copy, modify, and redistribute the covered files and their
source under the GPL. No Squisq terms are intended to restrict those rights.

The source location must remain available for as long as Squisq distributes
the corresponding object files. A deployer that republishes the core files is
responsible for preserving this notice, the GPL text, and equivalent access to
the complete corresponding source.
