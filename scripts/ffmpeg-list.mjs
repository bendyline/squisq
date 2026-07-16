/**
 * Check whether an FFmpeg list command (`-filters`, `-encoders`, etc.) contains
 * a component. FFmpeg has changed the width of its capability-flags column
 * between releases, so treat the component name as a field rather than
 * hard-coding the number of flags that precede it.
 */
export function hasFfmpegListEntry(output, componentName) {
  return output.split(/\r?\n/).some((line) => {
    const [capabilities, name] = line.trim().split(/\s+/);
    return /^[A-Z.]+$/i.test(capabilities ?? '') && name === componentName;
  });
}
