# Teleprompter (Narrate mode) — manual test script

The Playwright suite (`e2e/teleprompter.spec.ts`) covers mode
registration, manual/voice pacing with Chromium's fake mic, the popup
float tier, and the record→align→save loop. The scenarios below need
real hardware, real browsers, or window interactions automation can't
reach. Run them against `npm run site` → sample **Teleprompter (Narrate
mode)**.

## Voice pacing with a real microphone

1. Start the prompter (voice pacing on) and read at your natural pace —
   the highlight should track within a couple of words.
2. Stop speaking mid-sentence: the prompter must halt within ~¼ s and
   resume when you do.
3. Read noticeably faster, then slower — speed follows within a second
   or two; the `Sens.` slider adjusts how easily quiet speech registers.
4. Pause at a paragraph break for several seconds — no drift or runaway
   when you resume.
5. Skip a sentence deliberately — the hard resync should snap the
   highlight forward within a few words.
6. Switch mics via the device picker mid-session; the meter and pacing
   must keep working on the new device.

## Floating windows

- **Document PiP (Chromium, Firefox 151+)**: Pop out with "Floating
  window (always on top)". Verify: true always-on-top over other apps;
  scroll/highlight keep animating while the main window is fully
  covered; closing via the PiP ✕ restores the docked surface; "Bring
  back" closes the window.
- **Video PiP (Safari)**: Pop out with "Picture-in-picture". The canvas
  rendition must scroll on voice ticks (read-only — controls stay
  docked). Known-fragile territory: Safari's `canvas.captureStream` has
  quirks; any failure should silently fall through to a popup, never
  break the mode.
- **Occlusion (the scenario-2 hazard)**: put OBS/recording software
  fullscreen over the browser for 5+ minutes with the PiP prompter
  visible and the mic live — voice pacing must keep tracking (the audio
  worklet is the clock; rAF throttling only affects the occluded docked
  surface's smoothness).

## Recording

1. Record an audio-only take of the full demo doc; verify the review
   strip's playback re-scrolls the prompter in sync with your voice
   (this is the alignment being validated before it's written).
2. Save, then switch to Video mode: blocks must advance with your
   narration; check `audio/narration-*.webm` + `.timing.json` in the
   container and the `{[audio src=… anchor=document]}` preamble in
   Source.
3. Retake: record again and save — the preamble must be REPLACED, not
   duplicated; the new sidecar timing wins.
4. Camera variant: enable the `camera` checkbox — self-view appears
   while recording; saving adds `video/narration-cam-*.webm` plus an
   inline `<video>` line under the preamble.
5. Record while popped out (Document PiP) — the recording must survive
   opening/closing the float.
6. MP4 export of the saved doc — narration audio muxed, block timing
   matching the voice (`squisq video doc.dbk` or the site's Video
   export).

## Cross-browser expectations

| Capability             | Chromium | Firefox            | Safari                 |
| ---------------------- | -------- | ------------------ | ---------------------- |
| Voice pacing (worklet) | ✓        | ✓                  | ✓                      |
| Document PiP           | ✓        | ✓ (151+)           | — (falls to video-PiP) |
| Video PiP tier         | ✓        | — (falls to popup) | ✓ (verify per release) |
| Popup tier             | ✓        | ✓                  | ✓                      |
| Recording (WebM)       | ✓        | ✓                  | MP4/AAC output instead |
