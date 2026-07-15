# Accessibility audit

Accessibility is a release contract, not a one-time spot check. CI runs axe against the editor,
block-type modal, Page view, and video player, and unit tests enforce the shared modal contract
(name, `aria-modal`, background isolation, focus trap, Escape, and focus restoration).

## Automated gate

- `npm run test:e2e:built -- --project=chromium e2e/accessibility.spec.ts` checks WCAG 2.0/2.1
  A and AA rules and fails on serious or critical violations.
- Firefox and WebKit smoke tests exercise editing, HTML/SVG rendering, and modal keyboard focus.
- Vitest axe checks cover the link and video-export dialogs without needing a browser.

Automated tools cannot validate reading order quality, useful alternative text, voice-control
wording, cognitive load, or real screen-reader announcements. Before a release that materially
changes one of these surfaces, complete the manual matrix below at 200% zoom and with reduced
motion enabled.

## Manual release matrix

| Surface                          | Keyboard-only                                  | Screen reader                                 | Zoom/reflow                 | Reduced motion                      | Notes                                                  |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------- | --------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Editor and toolbar               | Tab order, shortcuts, menus, drag alternatives | NVDA + VoiceOver headings and control names   | 200% and 320 CSS px         | No essential animated feedback      | Include raw and WYSIWYG modes                          |
| Player controls                  | Play/pause, seek, captions, mode selection     | State changes and elapsed time announced      | Controls remain reachable   | Transitions suppressed              | Test slideshow, video, and Page                        |
| Diagram, tree, timeline, drawing | Reach every authored item without a pointer    | Selection and edit state announced            | Canvas controls do not clip | Panning/selection remain usable     | Record any pointer-only operation as a release blocker |
| Recorder and teleprompter        | Start/stop/cancel and permission denial        | Live state, errors, and countdown announced   | Text and controls reflow    | Countdown remains understandable    | Test denied and revoked permissions                    |
| Image editor                     | Layer selection, reorder, crop, save/cancel    | Layer names and current values announced      | Inspector remains usable    | No essential motion                 | Verify a non-drag reorder path                         |
| Export and settings dialogs      | Trap, Escape, destructive labels, restoration  | Title, progress, errors, completion announced | Dialog stays in viewport    | Progress does not rely on animation | Include video export and document settings             |

Log the browser/OS/screen-reader versions, failures, and evidence in the release issue. A checked
row without that evidence is not considered audited.
