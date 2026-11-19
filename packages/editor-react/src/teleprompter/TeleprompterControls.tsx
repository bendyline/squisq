/**
 * Docked controls rail for the Narrate mode. Lives under the surface (never
 * in the main toolbar) and is organized in two tiers:
 *
 * 1. A toolbar row of actions — Start/Pause + Restart as one segmented
 *    control, the start countdown, the Record slot (mounted by
 *    NarrationStage so scenario 2, prompter-only, has zero recording code
 *    paths), and Pop out.
 * 2. Three settings areas — Pacing (speed, voice pace), Microphone
 *    (input, level, sensitivity), and Display (text size, mirror, eye-line
 *    guide). A wide rail shows them side by side; a narrow one (a phone, the
 *    recorder dialog's column) shows one at a time behind a tab strip. The
 *    switch is a container query in teleprompterTheme.ts, so the rail adapts
 *    to the width it is given rather than to the viewport.
 *
 * Glyphs come from the chrome icon set (Icon.tsx), never emoji or Unicode
 * arrows, so the rail matches the editor toolbar on every platform.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { useEditorContextOptional } from '../EditorContext';
import type { TeleprompterController } from './useTeleprompter';
import type { FloatingWindowHandle } from './useFloatingWindow';
import { TELEPROMPTER_PREF_LIMITS, type FloatTier } from './types';
import { offersDeviceChoice, recorderDeviceOptions } from '../recorder/mediaDeviceList';

const TIER_LABELS: Record<FloatTier, string> = {
  'document-pip': 'Floating window (always on top)',
  'video-pip': 'Picture-in-picture (read-only)',
  popup: 'Popup window',
  docked: 'Docked',
};

type SettingsSection = 'pacing' | 'mic' | 'display';

/** `tab` is the narrow-rail tab label; `title` heads the area on a wide rail. */
const SECTIONS: readonly { id: SettingsSection; tab: string; title: string }[] = [
  { id: 'pacing', tab: 'Pacing', title: 'Pacing' },
  { id: 'mic', tab: 'Mic', title: 'Microphone' },
  { id: 'display', tab: 'Display', title: 'Display' },
];

const sectionId = (id: SettingsSection) => `squisq-prompter-section-${id}`;

/** Feeds the slider's accent fill (the track gradient in teleprompterTheme). */
function rangeFill(value: number, limits: { min: number; max: number }): CSSProperties {
  const span = limits.max - limits.min;
  const pct = span > 0 ? ((value - limits.min) / span) * 100 : 0;
  return { '--squisq-range-pct': `${Math.min(100, Math.max(0, pct))}%` } as CSSProperties;
}

export interface TeleprompterControlsProps {
  controller: TeleprompterController;
  float: FloatingWindowHandle;
  /** Phase B mounts the narration Record button here. */
  recordSlot?: ReactNode;
  /**
   * Show the Start/Pause transport button (default true). Hosts whose own
   * chrome drives playback — the Record media dialog starts the prompter
   * through its Record button — pass false; Restart and Countdown stay.
   */
  showPlayPause?: boolean;
}

export function TeleprompterControls({
  controller,
  float,
  recordSlot,
  showPlayPause = true,
}: TeleprompterControlsProps) {
  const { transport, prefs, setPrefs, mic } = controller;
  const rolling = transport === 'rolling' || transport === 'countdown';
  const voiceLive = prefs.voiceTracking && mic.status === 'live';
  const [activeSection, setActiveSection] = useState<SettingsSection>('pacing');
  const [chosenTier, setChosenTier] = useState<FloatTier | null>(null);
  // Outside an EditorProvider (the exported control used on its own) Pop out
  // stays available; a host that turned it off offers no tiers at all.
  const allowPopOut = useEditorContextOptional()?.allowNarratePopOut ?? true;
  const popOutTiers = allowPopOut ? float.supportedTiers : [];
  const floatTier = chosenTier && popOutTiers.includes(chosenTier) ? chosenTier : popOutTiers[0];

  const playLabel = rolling ? 'Pause' : transport === 'paused' ? 'Resume' : 'Start';
  // Real microphones only (not Chromium's "default" and "communications"
  // aliases). A lone microphone gets no picker: there is nothing to choose.
  const micOptions = recorderDeviceOptions(
    mic.devices,
    'audioinput',
    'Microphone',
    prefs.micDeviceId ?? '',
  );
  const showMicPicker = offersDeviceChoice(
    micOptions.map((option) => option.deviceId),
    prefs.micDeviceId,
  );

  const toggleVoicePace = () => {
    const next = !prefs.voiceTracking;
    setPrefs({ voiceTracking: next });
    if (next && mic.status === 'idle') void mic.start(prefs.micDeviceId);
    if (!next && mic.status !== 'idle') mic.stop();
  };

  return (
    <div
      className="squisq-teleprompter-controls"
      data-testid="teleprompter-controls"
      data-mic-status={mic.status}
      data-transport={transport}
      data-voice-live={voiceLive || undefined}
    >
      <div className="squisq-teleprompter-bar">
        {/* Not role="toolbar": that promises arrow-key focus movement, and
            Narrate's arrows nudge the script from anywhere on the page. */}
        <div className="squisq-teleprompter-seg" role="group" aria-label="Playback">
          {showPlayPause ? (
            <button
              type="button"
              className="squisq-teleprompter-tool squisq-teleprompter-tool--play"
              onClick={() => (rolling ? controller.pause() : controller.play())}
              aria-label={`${playLabel} prompter`}
              data-rolling={rolling || undefined}
            >
              <Icon icon={rolling ? 'fa-solid fa-pause' : 'fa-solid fa-play'} />
              <span className="squisq-teleprompter-tool-label">{playLabel}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="squisq-teleprompter-tool squisq-teleprompter-tool--restart"
            onClick={controller.restart}
            aria-label="Restart prompter"
            title="Back to the top"
          >
            <Icon icon="fa-solid fa-rotate-left" />
            <span className="squisq-teleprompter-tool-label">Restart</span>
          </button>
        </div>

        <div
          className="squisq-teleprompter-countdown-field"
          title="Seconds to count down before the prompter starts rolling"
        >
          <Icon icon="fa-solid fa-stopwatch" />
          <label htmlFor="squisq-prompter-countdown" className="squisq-teleprompter-bar-label">
            Countdown
          </label>
          <select
            id="squisq-prompter-countdown"
            value={prefs.countdownSec}
            onChange={(e) => setPrefs({ countdownSec: Number(e.target.value) as 0 | 3 | 5 | 10 })}
          >
            <option value={0}>Off</option>
            <option value={3}>3s</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
          </select>
        </div>

        {recordSlot}

        {float.isOpen || popOutTiers.length > 0 ? (
          <div className="squisq-teleprompter-float">
            {float.isOpen ? (
              <button type="button" className="squisq-teleprompter-tool" onClick={float.close}>
                <Icon icon="fa-solid fa-compress" />
                <span className="squisq-teleprompter-tool-label">Bring back</span>
              </button>
            ) : (
              <div className="squisq-teleprompter-split">
                <button
                  type="button"
                  className="squisq-teleprompter-tool"
                  onClick={() => void float.open(floatTier)}
                  title={`Pop the prompter out so it can sit next to your camera — ${
                    floatTier ? TIER_LABELS[floatTier] : ''
                  }`}
                >
                  <Icon icon="picture-in-picture" />
                  <span className="squisq-teleprompter-tool-label">Pop out</span>
                </button>
                {popOutTiers.length > 1 ? (
                  <span className="squisq-teleprompter-split-menu">
                    <Icon icon="fa-solid fa-chevron-down" />
                    <select
                      aria-label="Pop-out window type"
                      data-testid="teleprompter-float-tier"
                      value={floatTier}
                      onChange={(e) => setChosenTier(e.target.value as FloatTier)}
                    >
                      {popOutTiers.map((tier) => (
                        <option key={tier} value={tier}>
                          {TIER_LABELS[tier]}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Narrow rails only (see the container query); wide rails show every area. */}
      <div className="squisq-teleprompter-tabs" role="group" aria-label="Prompter settings">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className="squisq-teleprompter-tab"
            aria-pressed={activeSection === section.id}
            aria-controls={sectionId(section.id)}
            onClick={() => setActiveSection(section.id)}
          >
            {section.tab}
          </button>
        ))}
      </div>

      <div className="squisq-teleprompter-sections" data-active-section={activeSection}>
        <div
          id={sectionId('pacing')}
          className="squisq-teleprompter-section"
          data-section="pacing"
          role="group"
          aria-labelledby={`${sectionId('pacing')}-title`}
        >
          <div id={`${sectionId('pacing')}-title`} className="squisq-teleprompter-section-title">
            {SECTIONS[0].title}
          </div>
          <div className="squisq-teleprompter-row">
            <label htmlFor="squisq-prompter-wpm" className="squisq-teleprompter-row-label">
              <Icon icon="fa-solid fa-gauge" />
              Speed
            </label>
            <input
              id="squisq-prompter-wpm"
              type="range"
              min={TELEPROMPTER_PREF_LIMITS.baseWpm.min}
              max={TELEPROMPTER_PREF_LIMITS.baseWpm.max}
              step={5}
              value={prefs.baseWpm}
              onChange={(e) => setPrefs({ baseWpm: Number(e.target.value) })}
              style={rangeFill(prefs.baseWpm, TELEPROMPTER_PREF_LIMITS.baseWpm)}
            />
            <output htmlFor="squisq-prompter-wpm" className="squisq-teleprompter-value">
              {prefs.baseWpm} wpm
            </output>
          </div>
          <div className="squisq-teleprompter-row">
            <button
              type="button"
              className="squisq-teleprompter-toggle"
              aria-pressed={prefs.voiceTracking}
              onClick={toggleVoicePace}
              title="Match the prompter speed to your voice (halts when you stop speaking)"
            >
              <Icon icon="fa-solid fa-microphone-lines" />
              <span>Voice pace</span>
            </button>
            <span className="squisq-teleprompter-hint">
              {!prefs.voiceTracking
                ? 'Fixed speed'
                : mic.status === 'error'
                  ? 'Mic unavailable — fixed speed'
                  : 'Follows your voice'}
            </span>
          </div>
        </div>

        <div
          id={sectionId('mic')}
          className="squisq-teleprompter-section"
          data-section="mic"
          data-inactive={!prefs.voiceTracking || undefined}
          role="group"
          aria-labelledby={`${sectionId('mic')}-title`}
        >
          <div id={`${sectionId('mic')}-title`} className="squisq-teleprompter-section-title">
            {SECTIONS[1].title}
          </div>
          <div className="squisq-teleprompter-row">
            {showMicPicker ? (
              <select
                className="squisq-teleprompter-mic-select"
                aria-label="Microphone input"
                value={prefs.micDeviceId ?? ''}
                disabled={mic.sourceManaged}
                title={mic.sourceManaged ? 'Microphone selected in recording settings' : undefined}
                onChange={(e) => setPrefs({ micDeviceId: e.target.value || null })}
              >
                <option value="">Default mic</option>
                {micOptions.map((option) => (
                  <option key={option.deviceId} value={option.deviceId}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="squisq-teleprompter-row-label" aria-hidden="true">
                Level
              </span>
            )}
            <span
              className={`squisq-teleprompter-meter${showMicPicker ? '' : ' squisq-teleprompter-meter--wide'}${controller.voiceActive ? ' squisq-teleprompter-meter--voice' : ''}`}
              role="meter"
              aria-label="Mic level"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={Math.round(controller.micLevel * 100) / 100}
            >
              <span
                className="squisq-teleprompter-meter-fill"
                style={{ width: `${Math.round(controller.micLevel * 100)}%` }}
              />
            </span>
          </div>
          <div className="squisq-teleprompter-row">
            <label
              htmlFor="squisq-prompter-sensitivity"
              className="squisq-teleprompter-row-label"
              title="How readily the prompter treats sound as speech"
            >
              Sensitivity
            </label>
            <input
              id="squisq-prompter-sensitivity"
              type="range"
              min={TELEPROMPTER_PREF_LIMITS.vadSensitivity.min}
              max={TELEPROMPTER_PREF_LIMITS.vadSensitivity.max}
              step={0.05}
              value={prefs.vadSensitivity}
              onChange={(e) => setPrefs({ vadSensitivity: Number(e.target.value) })}
              style={rangeFill(prefs.vadSensitivity, TELEPROMPTER_PREF_LIMITS.vadSensitivity)}
            />
          </div>
          {prefs.voiceTracking && mic.status === 'error' ? (
            <div
              className="squisq-teleprompter-row squisq-teleprompter-warning"
              title={mic.error?.message ?? 'Microphone unavailable'}
            >
              <Icon icon="fa-solid fa-triangle-exclamation" />
              Mic unavailable — using fixed speed
            </div>
          ) : !prefs.voiceTracking ? (
            <div className="squisq-teleprompter-row squisq-teleprompter-hint">
              Used when Voice pace is on.
            </div>
          ) : null}
        </div>

        <div
          id={sectionId('display')}
          className="squisq-teleprompter-section"
          data-section="display"
          role="group"
          aria-labelledby={`${sectionId('display')}-title`}
        >
          <div id={`${sectionId('display')}-title`} className="squisq-teleprompter-section-title">
            {SECTIONS[2].title}
          </div>
          <div className="squisq-teleprompter-row">
            <label htmlFor="squisq-prompter-fontsize" className="squisq-teleprompter-row-label">
              <Icon icon="fa-solid fa-text-height" />
              Text size
            </label>
            <input
              id="squisq-prompter-fontsize"
              type="range"
              min={TELEPROMPTER_PREF_LIMITS.fontSizePx.min}
              max={TELEPROMPTER_PREF_LIMITS.fontSizePx.max}
              step={2}
              value={prefs.fontSizePx}
              onChange={(e) => setPrefs({ fontSizePx: Number(e.target.value) })}
              style={rangeFill(prefs.fontSizePx, TELEPROMPTER_PREF_LIMITS.fontSizePx)}
            />
          </div>
          <div className="squisq-teleprompter-row">
            <button
              type="button"
              className="squisq-teleprompter-toggle"
              aria-pressed={prefs.mirrored}
              onClick={() => setPrefs({ mirrored: !prefs.mirrored })}
              title="Mirror for beam-splitter teleprompter rigs (M)"
            >
              <Icon icon="flip-horizontal" />
              <span>Mirror</span>
            </button>
            <button
              type="button"
              className="squisq-teleprompter-toggle"
              aria-pressed={prefs.lineGuide}
              onClick={() => setPrefs({ lineGuide: !prefs.lineGuide })}
              title="Eye-line guide"
            >
              <Icon icon="fa-solid fa-crosshairs" />
              <span>Guide</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
