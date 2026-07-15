# Third-Party Notices for @bendyline/squisq-video-react

This notice applies to the `@bendyline/squisq-video-react` npm package.
Squisq-authored code is licensed under the MIT license in `LICENSE`.
Third-party components remain under their respective license terms.

## Runtime, peer, and bundled dependencies

| Package                 | Version              | License          | Repository                                |
| ----------------------- | -------------------- | ---------------- | ----------------------------------------- |
| @bendyline/squisq       | 2.1.0                | MIT              | https://github.com/bendyline/squisq       |
| @bendyline/squisq-video | 2.0.2                | MIT              | https://github.com/bendyline/squisq       |
| @bendyline/squisq-react | 2.1.0                | MIT              | https://github.com/bendyline/squisq       |
| @ffmpeg/core            | 0.12.9               | GPL-2.0-or-later | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/ffmpeg          | 0.12.15              | MIT              | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/util            | 0.12.2               | MIT              | https://github.com/ffmpegwasm/ffmpeg.wasm |
| html2canvas             | 1.4.1                | MIT              | https://github.com/niklasvh/html2canvas   |
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
global WebCodecs declaration dependencies are not installed for consumers.
