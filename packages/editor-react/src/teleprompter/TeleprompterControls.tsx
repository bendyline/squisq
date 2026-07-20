/**
 * Docked controls rail for the Narrate mode: transport, pacing, mic,
 * display, and pop-out. Lives under the surface (never in the main
 * toolbar). The Record affordance mounts through `recordSlot` in
 * Phase B so scenario 2 (prompter-only) has zero recording code paths.
 */

import type { ReactNode } from 'react';
import type { TeleprompterController } from './useTeleprompter';
import type { FloatingWindowHandle } from './useFloatingWindow';
import { TELEPROMPTER_PREF_LIMITS, type FloatTier } from './types';

const TIER_LABELS: Record<FloatTier, string> = {
  'document-pip': 'Floating window (always on top)',
  'video-pip': 'Picture-in-picture (read-only)',
  popup: 'Popup window',
  docked: 'Docked',
};

export interface TeleprompterControlsProps {
  controller: TeleprompterController;
  float: FloatingWindowHandle;
  /** Phase B mounts the narration Record button here. */
  recordSlot?: ReactNode;
}

export function TeleprompterControls({ controller, float, recordSlot }: TeleprompterControlsProps) {
  const { transport, prefs, setPrefs, mic } = controller;
  const rolling = transport === 'rolling' || transport === 'countdown';
  const voiceLive = prefs.voiceTracking && mic.status === 'live';

  return (
    <div
      className="squisq-teleprompter-controls"
      data-testid="teleprompter-controls"
      data-mic-status={mic.status}
      data-transport={transport}
      data-voice-live={voiceLive || undefined}
    >
      <span className="squisq-teleprompter-group">
        <button
          type="button"
          onClick={() => (rolling ? controller.pause() : controller.play())}
          aria-label={rolling ? 'Pause prompter' : 'Start prompter'}
        >
          {rolling ? '⏸ Pause' : transport === 'paused' ? '▶ Resume' : '▶ Start'}
        </button>
        <button type="button" onClick={controller.restart} aria-label="Restart prompter">
          ⟲ Restart
        </button>
      </span>

      <span className="squisq-teleprompter-group">
        <label htmlFor="squisq-prompter-countdown">Countdown</label>
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
      </span>

      <span className="squisq-teleprompter-group">
        <label htmlFor="squisq-prompter-wpm">Speed</label>
        <input
          id="squisq-prompter-wpm"
          type="range"
          min={TELEPROMPTER_PREF_LIMITS.baseWpm.min}
          max={TELEPROMPTER_PREF_LIMITS.baseWpm.max}
          step={5}
          value={prefs.baseWpm}
          onChange={(e) => setPrefs({ baseWpm: Number(e.target.value) })}
        />
        <span aria-live="off">{prefs.baseWpm} wpm</span>
      </span>

      <span className="squisq-teleprompter-group">
        <button
          type="button"
          aria-pressed={prefs.voiceTracking}
          onClick={() => {
            const next = !prefs.voiceTracking;
            setPrefs({ voiceTracking: next });
            if (next && mic.status === 'idle') void mic.start(prefs.micDeviceId);
            if (!next && mic.status !== 'idle') mic.stop();
          }}
          title="Match the prompter speed to your voice (halts when you stop speaking)"
        >
          🎙 Voice pace
        </button>
        {prefs.voiceTracking ? (
          <>
            <label htmlFor="squisq-prompter-sensitivity" title="Voice detection sensitivity">
              Sens.
            </label>
            <input
              id="squisq-prompter-sensitivity"
              type="range"
              min={TELEPROMPTER_PREF_LIMITS.vadSensitivity.min}
              max={TELEPROMPTER_PREF_LIMITS.vadSensitivity.max}
              step={0.05}
              value={prefs.vadSensitivity}
              onChange={(e) => setPrefs({ vadSensitivity: Number(e.target.value) })}
              style={{ width: 70 }}
            />
            <select
              aria-label="Microphone"
              value={prefs.micDeviceId ?? ''}
              onChange={(e) => setPrefs({ micDeviceId: e.target.value || null })}
            >
              <option value="">Default mic</option>
              {mic.devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Mic ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
            <span
              className={`squisq-teleprompter-meter${controller.voiceActive ? ' squisq-teleprompter-meter--voice' : ''}`}
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
            {mic.status === 'error' ? (
              <span title={mic.error?.message ?? 'Microphone unavailable'}>
                ⚠ mic unavailable — constant speed
              </span>
            ) : null}
          </>
        ) : null}
      </span>

      <span className="squisq-teleprompter-group">
        <label htmlFor="squisq-prompter-fontsize">Aa</label>
        <input
          id="squisq-prompter-fontsize"
          type="range"
          min={TELEPROMPTER_PREF_LIMITS.fontSizePx.min}
          max={TELEPROMPTER_PREF_LIMITS.fontSizePx.max}
          step={2}
          value={prefs.fontSizePx}
          onChange={(e) => setPrefs({ fontSizePx: Number(e.target.value) })}
          style={{ width: 80 }}
          aria-label="Prompter font size"
        />
        <button
          type="button"
          aria-pressed={prefs.mirrored}
          onClick={() => setPrefs({ mirrored: !prefs.mirrored })}
          title="Mirror for beam-splitter teleprompter rigs (M)"
        >
          ⇋ Mirror
        </button>
        <button
          type="button"
          aria-pressed={prefs.lineGuide}
          onClick={() => setPrefs({ lineGuide: !prefs.lineGuide })}
          title="Eye-line guide"
        >
          ▸ Guide
        </button>
      </span>

      {recordSlot}

      {float.supportedTiers.length > 0 ? (
        <span className="squisq-teleprompter-group" style={{ marginLeft: 'auto' }}>
          {float.isOpen ? (
            <button type="button" onClick={float.close}>
              ⇤ Bring back
            </button>
          ) : (
            <>
              {float.supportedTiers.length > 1 ? (
                <select
                  aria-label="Float mode"
                  data-testid="teleprompter-float-tier"
                  defaultValue={float.supportedTiers[0]}
                  id="squisq-prompter-float-tier"
                >
                  {float.supportedTiers.map((tier) => (
                    <option key={tier} value={tier}>
                      {TIER_LABELS[tier]}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  const select = document.getElementById(
                    'squisq-prompter-float-tier',
                  ) as HTMLSelectElement | null;
                  const preferred = (select?.value as FloatTier | undefined) ?? undefined;
                  void float.open(preferred);
                }}
                title="Pop the prompter out so it can sit next to your camera"
              >
                ⇱ Pop out
              </button>
            </>
          )}
        </span>
      ) : null}
    </div>
  );
}
