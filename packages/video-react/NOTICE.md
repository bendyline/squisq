# Third-Party Notices for @bendyline/squisq-video-react

This notice applies to the `@bendyline/squisq-video-react` npm package.
Squisq-authored code is licensed under the MIT license in `LICENSE`.
Third-party components remain under their respective license terms.

## Runtime, peer, and bundled dependencies

| Package                 | Version              | License          | Repository                                |
| ----------------------- | -------------------- | ---------------- | ----------------------------------------- |
| @ffmpeg/core            | 0.12.9               | GPL-2.0-or-later | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/ffmpeg          | 0.12.15              | MIT              | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/util            | 0.12.2               | MIT              | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @shiguredo/rnnoise-wasm | 2025.1.5             | Apache-2.0       | https://github.com/shiguredo/rnnoise-wasm |
| html2canvas             | 1.4.1                | MIT              | https://github.com/niklasvh/html2canvas   |
| mediabunny _(bundled)_  | 1.57.0               | MPL-2.0          | https://github.com/Vanilagy/mediabunny    |
| mp4-muxer _(bundled)_   | 5.2.2                | MIT              | https://github.com/Vanilagy/mp4-muxer     |
| react _(peer)_          | ^18.0.0 \|\| ^19.0.0 | MIT              | https://github.com/facebook/react         |
| react-dom _(peer)_      | ^18.0.0 \|\| ^19.0.0 | MIT              | https://github.com/facebook/react         |

## @ffmpeg/core WebAssembly runtime

@ffmpeg/core is a WebAssembly build with an upstream dependency on the FFmpeg
project and external libraries. Version 0.12.9 declares GPL-2.0-or-later. A
verbatim copy of GPLv2 is included as COPYING.GPL-2.0.txt. Hosts that publish
ffmpeg-core.js or ffmpeg-core.wasm must preserve the applicable notices,
provide the GPL text, and provide equivalent access to the corresponding
source for the exact binaries.

Squisq's demo site uses the unmodified ESM files from @ffmpeg/core@0.12.9.
Upstream identifies ffmpeg.wasm release v12.14, commit
d3c018aa40a241384965268f0506b73f47dee60c, as the source release containing
that package version:

- https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.14
- https://github.com/ffmpegwasm/ffmpeg.wasm/tree/d3c018aa40a241384965268f0506b73f47dee60c
- https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.14.tar.gz
- https://ffmpegwasm.netlify.app/docs/contribution/core/

mp4-muxer is bundled as a private runtime implementation detail so its legacy
global WebCodecs declaration dependencies are not installed for consumers. Its
exact license text is shipped in THIRD_PARTY_LICENSES.txt.

## mediabunny

mediabunny demuxes and decodes video sources during export. It is bundled for
the same reason as mp4-muxer. mediabunny is distributed under the Mozilla
Public License 2.0; this package ships its files unmodified, and their Source
Code Form is available from the mediabunny npm package (which includes `src/`)
at the version listed above and from https://github.com/Vanilagy/mediabunny.
The complete MPL-2.0 text is shipped in THIRD_PARTY_LICENSES.txt.
