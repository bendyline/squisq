/**
 * Microphone / camera pickers promoted out of "Advanced device settings".
 *
 * Choosing WHICH microphone or camera to record is an everyday decision on a
 * machine that has more than one, and burying it under a disclosure whose
 * other twenty fields are constraint plumbing puts it in the wrong place. Each
 * picker therefore appears inline when — and only when — two conditions hold:
 * its source is enabled, and the browser reports more than one real device of
 * that kind (see `recorderDeviceOptions` for what "real" excludes). A machine
 * with a single webcam gets no camera picker, because there is nothing to pick.
 *
 * These are the SAME selects as the ones in the advanced panel, bound to the
 * same `RecorderDeviceSettings` and rendering the same option list — a
 * shortcut to one setting, never a second source of truth.
 */

import type { CSSProperties } from 'react';
import {
  hasRecorderDeviceChoice,
  recorderDeviceOptions,
  type RecorderDeviceOption,
} from './mediaDeviceList.js';

export interface RecorderDeviceQuickPicksProps {
  /** Enumerated devices, typically from `useMediaDevices()`. */
  devices: readonly MediaDeviceInfo[];
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  audioDeviceId: string;
  cameraDeviceId: string;
  onAudioDeviceChange: (deviceId: string) => void;
  onCameraDeviceChange: (deviceId: string) => void;
  disabled?: boolean;
}

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '8px 10px',
  marginBottom: 12,
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  fontSize: 12,
  color: 'var(--squisq-recorder-muted)',
};

const selectStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '5px 6px',
  font: 'inherit',
  color: 'var(--squisq-recorder-text)',
  background: 'var(--squisq-recorder-input)',
  border: '1px solid var(--squisq-recorder-border)',
};

function DevicePick({
  label,
  testId,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  testId: string;
  options: readonly RecorderDeviceOption[];
  value: string;
  onChange: (deviceId: string) => void;
  disabled: boolean;
}) {
  // No `aria-label`: the wrapping label already names the control, and reusing
  // the advanced panel's "Recording microphone" / "Recording camera" names
  // would leave two different controls sharing one accessible name.
  return (
    <label style={fieldStyle}>
      {label}
      <select
        data-testid={testId}
        value={value}
        disabled={disabled}
        style={selectStyle}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">System default</option>
        {options.map((option) => (
          <option key={option.deviceId} value={option.deviceId}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RecorderDeviceQuickPicks({
  devices,
  microphoneEnabled,
  cameraEnabled,
  audioDeviceId,
  cameraDeviceId,
  onAudioDeviceChange,
  onCameraDeviceChange,
  disabled = false,
}: RecorderDeviceQuickPicksProps) {
  const audioOptions = recorderDeviceOptions(devices, 'audioinput', 'Microphone', audioDeviceId);
  const videoOptions = recorderDeviceOptions(devices, 'videoinput', 'Camera', cameraDeviceId);
  const showMicrophone = microphoneEnabled && hasRecorderDeviceChoice(audioOptions);
  const showCamera = cameraEnabled && hasRecorderDeviceChoice(videoOptions);
  if (!showMicrophone && !showCamera) return null;

  return (
    <div style={rowStyle} data-testid="recorder-device-quick-picks">
      {showMicrophone && (
        <DevicePick
          label="Microphone"
          testId="recorder-quick-pick-microphone"
          options={audioOptions}
          value={audioDeviceId}
          onChange={onAudioDeviceChange}
          disabled={disabled}
        />
      )}
      {showCamera && (
        <DevicePick
          label="Camera"
          testId="recorder-quick-pick-camera"
          options={videoOptions}
          value={cameraDeviceId}
          onChange={onCameraDeviceChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}
