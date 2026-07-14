# Third-Party Notices for @bendyline/squisq-video

This notice applies to the `@bendyline/squisq-video` npm package.
Squisq-authored code is licensed under the MIT license in `LICENSE`.
Third-party components remain under their respective license terms.

## Runtime dependencies

| Package           | Version | License | Repository                                |
| ----------------- | ------- | ------- | ----------------------------------------- |
| @bendyline/squisq | 2.1.0   | MIT     | https://github.com/bendyline/squisq       |
| @ffmpeg/ffmpeg    | 0.12.15 | MIT     | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/util      | 0.12.2  | MIT     | https://github.com/ffmpegwasm/ffmpeg.wasm |

The `@ffmpeg/ffmpeg` and `@ffmpeg/util` packages provide JavaScript APIs and
utilities. This npm package does not include `@ffmpeg/core`,
`ffmpeg-core.js`, or `ffmpeg-core.wasm`; applications that use a WebAssembly
core supply and distribute it separately.

Copyright and complete license texts for the listed dependencies are included
in their respective npm distributions and source repositories.
