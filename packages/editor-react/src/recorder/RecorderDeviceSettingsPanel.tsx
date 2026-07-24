/**
 * Capability-aware advanced recorder settings.
 *
 * `getSupportedConstraints()` controls which track fields are rendered.
 * Device enumeration is best effort: browsers commonly hide labels until the
 * first permission grant, so the default-device choices always remain usable.
 */

import { useCallback, useEffect, useId, useState, type CSSProperties } from 'react';
import type {
  RecorderAudioDeviceSettings,
  RecorderCameraDeviceSettings,
  RecorderDeviceSettings,
  RecorderEncodingSettings,
  RecorderScreenDeviceSettings,
  RecorderScreenAudioSettings,
} from './deviceSettings.js';

export interface RecorderDeviceSettingsPanelProps {
  value: RecorderDeviceSettings;
  onChange: (next: RecorderDeviceSettings) => void;
  disabled?: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  systemAudioEnabled?: boolean;
  /** Narration records mic audio separately even when its camera is on. */
  separateAudioRecorder?: boolean;
  primaryStream?: MediaStream | null;
  cameraStream?: MediaStream | null;
}

type SupportedConstraintMap = Record<string, boolean>;
type TriState = 'default' | 'true' | 'false';

const detailsStyle: CSSProperties = {
  border: '1px solid var(--squisq-recorder-border)',
  marginBottom: 12,
};

const summaryToggleStyle: CSSProperties = {
  cursor: 'pointer',
  padding: '8px 10px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--squisq-recorder-text)',
  background: 'var(--squisq-recorder-surface-muted)',
};

const panelStyle: CSSProperties = {
  padding: '4px 10px 10px',
};

const fieldsetStyle: CSSProperties = {
  border: 0,
  borderTop: '1px solid var(--squisq-recorder-border)',
  margin: '10px 0 0',
  padding: '10px 0 0',
};

const legendStyle: CSSProperties = {
  padding: '0 6px 0 0',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--squisq-recorder-text)',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '8px 10px',
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  fontSize: 12,
  color: 'var(--squisq-recorder-muted)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '5px 6px',
  font: 'inherit',
  color: 'var(--squisq-recorder-text)',
  background: 'var(--squisq-recorder-input)',
  border: '1px solid var(--squisq-recorder-border)',
};

const noteStyle: CSSProperties = {
  margin: '8px 0 0',
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--squisq-recorder-muted)',
};

const actualStyle: CSSProperties = {
  margin: '6px 0 0',
  padding: 6,
  overflowX: 'auto',
  fontSize: 10,
  lineHeight: 1.35,
  color: 'var(--squisq-recorder-muted)',
  background: 'var(--squisq-recorder-surface-muted)',
};

const AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

const VIDEO_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

function numberFromInput(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function triState(value: boolean | undefined): TriState {
  return value === undefined ? 'default' : value ? 'true' : 'false';
}

function booleanFromTriState(value: string): boolean | undefined {
  return value === 'default' ? undefined : value === 'true';
}

function deviceLabel(device: MediaDeviceInfo, index: number, noun: string): string {
  return device.label || `${noun} ${index + 1}`;
}

function deviceGroups(devices: MediaDeviceInfo[]): Array<{ id: string; label: string }> {
  const groups = new Map<string, string>();
  for (const [index, device] of devices.entries()) {
    if (!device.groupId || groups.has(device.groupId)) continue;
    groups.set(device.groupId, device.label || `Device group ${index + 1}`);
  }
  return [...groups].map(([id, label]) => ({ id, label }));
}

function readSettings(track: MediaStreamTrack | undefined): MediaTrackSettings | null {
  if (!track || typeof track.getSettings !== 'function') return null;
  try {
    return track.getSettings();
  } catch {
    return null;
  }
}

function NumericField({
  label,
  value,
  onChange,
  disabled,
  min,
  step,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  disabled: boolean;
  min?: number;
  step?: number;
}) {
  return (
    <label style={fieldStyle}>
      {label}
      <input
        type="number"
        min={min ?? 0}
        step={step ?? 1}
        value={value ?? ''}
        disabled={disabled}
        style={inputStyle}
        onChange={(event) => onChange(numberFromInput(event.target.value))}
      />
    </label>
  );
}

function BooleanField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
  disabled: boolean;
}) {
  return (
    <label style={fieldStyle}>
      {label}
      <select
        value={triState(value)}
        disabled={disabled}
        style={inputStyle}
        onChange={(event) => onChange(booleanFromTriState(event.target.value))}
      >
        <option value="default">Browser default</option>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    </label>
  );
}

export function RecorderDeviceSettingsPanel({
  value,
  onChange,
  disabled = false,
  microphoneEnabled,
  cameraEnabled,
  screenEnabled,
  systemAudioEnabled = false,
  separateAudioRecorder = false,
  primaryStream = null,
  cameraStream = null,
}: RecorderDeviceSettingsPanelProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [supported, setSupported] = useState<SupportedConstraintMap | null>(null);
  const audioMimeListId = useId();
  const videoMimeListId = useId();

  const refreshBrowserInfo = useCallback(async () => {
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!mediaDevices) return;
    if (typeof mediaDevices.getSupportedConstraints === 'function') {
      setSupported(mediaDevices.getSupportedConstraints() as SupportedConstraintMap);
    }
    if (typeof mediaDevices.enumerateDevices === 'function') {
      try {
        setDevices(await mediaDevices.enumerateDevices());
      } catch {
        // Device enumeration is permission- and policy-dependent.
      }
    }
  }, []);

  useEffect(() => {
    void refreshBrowserInfo();
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => void refreshBrowserInfo();
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshBrowserInfo]);

  // A permission grant often reveals device labels without firing
  // `devicechange`; refresh once a preview stream lands.
  useEffect(() => {
    if (primaryStream || cameraStream) void refreshBrowserInfo();
  }, [cameraStream, primaryStream, refreshBrowserInfo]);

  const supports = (key: string) => supported === null || supported[key] === true;
  const hasAudioTrack = microphoneEnabled || systemAudioEnabled;
  const hasStandaloneAudioRecorder =
    separateAudioRecorder || (microphoneEnabled && !cameraEnabled && !screenEnabled);
  const audioDevices = devices.filter((device) => device.kind === 'audioinput');
  const videoDevices = devices.filter((device) => device.kind === 'videoinput');
  const audioGroups = deviceGroups(audioDevices);
  const videoGroups = deviceGroups(videoDevices);

  const patchAudio = (patch: Partial<RecorderAudioDeviceSettings>) =>
    onChange({ ...value, audio: { ...value.audio, ...patch } });
  const patchCamera = (patch: Partial<RecorderCameraDeviceSettings>) =>
    onChange({ ...value, camera: { ...value.camera, ...patch } });
  const patchScreen = (patch: Partial<RecorderScreenDeviceSettings>) =>
    onChange({ ...value, screen: { ...value.screen, ...patch } });
  const patchScreenAudio = (patch: Partial<RecorderScreenAudioSettings>) =>
    onChange({ ...value, screenAudio: { ...value.screenAudio, ...patch } });
  const patchEncoding = (patch: Partial<RecorderEncodingSettings>) =>
    onChange({ ...value, encoding: { ...value.encoding, ...patch } });

  const primaryAudioSettings = readSettings(primaryStream?.getAudioTracks()[0]);
  const primaryVideoSettings = readSettings(primaryStream?.getVideoTracks()[0]);
  const secondaryVideoSettings = readSettings(cameraStream?.getVideoTracks()[0]);
  const actualSettings = {
    ...(primaryAudioSettings ? { audio: primaryAudioSettings } : {}),
    ...(primaryVideoSettings
      ? { [screenEnabled ? 'screen' : 'camera']: primaryVideoSettings }
      : {}),
    ...(secondaryVideoSettings ? { camera: secondaryVideoSettings } : {}),
  };

  return (
    <details style={detailsStyle} data-testid="recorder-device-settings">
      <summary style={summaryToggleStyle}>Advanced device settings</summary>
      <div style={panelStyle}>
        <label style={fieldStyle}>
          Constraint strength
          <select
            value={value.constraintMode}
            disabled={disabled}
            style={inputStyle}
            onChange={(event) =>
              onChange({
                ...value,
                constraintMode: event.target.value === 'exact' ? 'exact' : 'ideal',
              })
            }
          >
            <option value="ideal">Preferred (use closest available)</option>
            <option value="exact">Required (fail when unavailable)</option>
          </select>
        </label>

        {microphoneEnabled && (
          <fieldset style={fieldsetStyle} disabled={disabled}>
            <legend style={legendStyle}>Microphone</legend>
            <div style={gridStyle}>
              <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                Input device
                <select
                  aria-label="Recording microphone"
                  value={value.audio.deviceId}
                  style={inputStyle}
                  onChange={(event) => patchAudio({ deviceId: event.target.value })}
                >
                  <option value="">System default</option>
                  {audioDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {deviceLabel(device, index, 'Microphone')}
                    </option>
                  ))}
                </select>
              </label>
              {supports('groupId') && audioGroups.length > 0 && (
                <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                  Device group
                  <select
                    value={value.audio.groupId ?? ''}
                    style={inputStyle}
                    onChange={(event) => patchAudio({ groupId: event.target.value || undefined })}
                  >
                    <option value="">Any group</option>
                    {audioGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {supports('sampleRate') && (
                <NumericField
                  label="Sample rate (Hz)"
                  value={value.audio.sampleRate}
                  onChange={(sampleRate) => patchAudio({ sampleRate })}
                  disabled={disabled}
                />
              )}
              {supports('sampleSize') && (
                <NumericField
                  label="Sample size (bits)"
                  value={value.audio.sampleSize}
                  onChange={(sampleSize) => patchAudio({ sampleSize })}
                  disabled={disabled}
                />
              )}
              {supports('channelCount') && (
                <NumericField
                  label="Channel count"
                  value={value.audio.channelCount}
                  onChange={(channelCount) => patchAudio({ channelCount })}
                  disabled={disabled}
                />
              )}
              {supports('latency') && (
                <NumericField
                  label="Latency (seconds)"
                  value={value.audio.latency}
                  onChange={(latency) => patchAudio({ latency })}
                  disabled={disabled}
                  step={0.001}
                />
              )}
              {supports('echoCancellation') && (
                <BooleanField
                  label="Echo cancellation"
                  value={value.audio.echoCancellation}
                  onChange={(echoCancellation) => patchAudio({ echoCancellation })}
                  disabled={disabled}
                />
              )}
              {supports('noiseSuppression') && (
                <BooleanField
                  label="Noise suppression"
                  value={value.audio.noiseSuppression}
                  onChange={(noiseSuppression) => patchAudio({ noiseSuppression })}
                  disabled={disabled}
                />
              )}
              {supports('autoGainControl') && (
                <BooleanField
                  label="Automatic gain control"
                  value={value.audio.autoGainControl}
                  onChange={(autoGainControl) => patchAudio({ autoGainControl })}
                  disabled={disabled}
                />
              )}
            </div>
          </fieldset>
        )}

        {cameraEnabled && (
          <fieldset style={fieldsetStyle} disabled={disabled}>
            <legend style={legendStyle}>Camera</legend>
            <div style={gridStyle}>
              <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                Video input
                <select
                  aria-label="Recording camera"
                  value={value.camera.deviceId}
                  style={inputStyle}
                  onChange={(event) => patchCamera({ deviceId: event.target.value })}
                >
                  <option value="">System default</option>
                  {videoDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {deviceLabel(device, index, 'Camera')}
                    </option>
                  ))}
                </select>
              </label>
              {supports('groupId') && videoGroups.length > 0 && (
                <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                  Device group
                  <select
                    value={value.camera.groupId ?? ''}
                    style={inputStyle}
                    onChange={(event) => patchCamera({ groupId: event.target.value || undefined })}
                  >
                    <option value="">Any group</option>
                    {videoGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {supports('width') && (
                <NumericField
                  label="Width (px)"
                  value={value.camera.width}
                  onChange={(width) => patchCamera({ width })}
                  disabled={disabled}
                />
              )}
              {supports('height') && (
                <NumericField
                  label="Height (px)"
                  value={value.camera.height}
                  onChange={(height) => patchCamera({ height })}
                  disabled={disabled}
                />
              )}
              {supports('aspectRatio') && (
                <NumericField
                  label="Aspect ratio (width / height)"
                  value={value.camera.aspectRatio}
                  onChange={(aspectRatio) => patchCamera({ aspectRatio })}
                  disabled={disabled}
                  step={0.01}
                />
              )}
              {supports('frameRate') && (
                <NumericField
                  label="Frame rate (fps)"
                  value={value.camera.frameRate}
                  onChange={(frameRate) => patchCamera({ frameRate })}
                  disabled={disabled}
                  step={0.01}
                />
              )}
              {supports('facingMode') && (
                <label style={fieldStyle}>
                  Facing mode
                  <select
                    value={value.camera.facingMode ?? ''}
                    disabled={disabled}
                    style={inputStyle}
                    onChange={(event) =>
                      patchCamera({ facingMode: event.target.value || undefined })
                    }
                  >
                    <option value="">Browser default</option>
                    <option value="user">User/front</option>
                    <option value="environment">Environment/rear</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              )}
              {supports('resizeMode') && (
                <label style={fieldStyle}>
                  Resize mode
                  <select
                    value={value.camera.resizeMode ?? ''}
                    disabled={disabled}
                    style={inputStyle}
                    onChange={(event) =>
                      patchCamera({ resizeMode: event.target.value || undefined })
                    }
                  >
                    <option value="">Browser default</option>
                    <option value="none">None</option>
                    <option value="crop-and-scale">Crop and scale</option>
                  </select>
                </label>
              )}
              {supports('backgroundBlur') && (
                <BooleanField
                  label="Background blur"
                  value={value.camera.backgroundBlur}
                  onChange={(backgroundBlur) => patchCamera({ backgroundBlur })}
                  disabled={disabled}
                />
              )}
            </div>
          </fieldset>
        )}

        {(screenEnabled || systemAudioEnabled) && (
          <fieldset style={fieldsetStyle} disabled={disabled}>
            <legend style={legendStyle}>
              {screenEnabled ? 'Screen capture' : 'System audio capture'}
            </legend>
            <div style={gridStyle}>
              {screenEnabled && (
                <>
                  {supports('displaySurface') && (
                    <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                      Preferred surface
                      <select
                        value={value.screen.displaySurface ?? ''}
                        disabled={disabled}
                        style={inputStyle}
                        onChange={(event) =>
                          patchScreen({ displaySurface: event.target.value || undefined })
                        }
                      >
                        <option value="">Browser picker default</option>
                        <option value="monitor">Entire monitor</option>
                        <option value="window">Application window</option>
                        <option value="browser">Browser tab</option>
                      </select>
                    </label>
                  )}
                  {supports('cursor') && (
                    <label style={fieldStyle}>
                      Mouse cursor
                      <select
                        value={value.screen.cursor ?? ''}
                        disabled={disabled}
                        style={inputStyle}
                        onChange={(event) =>
                          patchScreen({ cursor: event.target.value || undefined })
                        }
                      >
                        <option value="">Browser default</option>
                        <option value="always">Always</option>
                        <option value="motion">While moving</option>
                        <option value="never">Never</option>
                      </select>
                    </label>
                  )}
                  {supports('logicalSurface') && (
                    <BooleanField
                      label="Logical surface"
                      value={value.screen.logicalSurface}
                      onChange={(logicalSurface) => patchScreen({ logicalSurface })}
                      disabled={disabled}
                    />
                  )}
                  {supports('resizeMode') && (
                    <label style={fieldStyle}>
                      Resize mode
                      <select
                        value={value.screen.resizeMode ?? ''}
                        disabled={disabled}
                        style={inputStyle}
                        onChange={(event) =>
                          patchScreen({ resizeMode: event.target.value || undefined })
                        }
                      >
                        <option value="">Browser default</option>
                        <option value="none">Full detail</option>
                        <option value="crop-and-scale">Downscale</option>
                      </select>
                    </label>
                  )}
                  {supports('width') && (
                    <NumericField
                      label="Width (px)"
                      value={value.screen.width}
                      onChange={(width) => patchScreen({ width })}
                      disabled={disabled}
                    />
                  )}
                  {supports('height') && (
                    <NumericField
                      label="Height (px)"
                      value={value.screen.height}
                      onChange={(height) => patchScreen({ height })}
                      disabled={disabled}
                    />
                  )}
                  {supports('aspectRatio') && (
                    <NumericField
                      label="Aspect ratio (width / height)"
                      value={value.screen.aspectRatio}
                      onChange={(aspectRatio) => patchScreen({ aspectRatio })}
                      disabled={disabled}
                      step={0.01}
                    />
                  )}
                  {supports('frameRate') && (
                    <NumericField
                      label="Frame rate (fps)"
                      value={value.screen.frameRate}
                      onChange={(frameRate) => patchScreen({ frameRate })}
                      disabled={disabled}
                      step={0.01}
                    />
                  )}
                </>
              )}
              {systemAudioEnabled && supports('restrictOwnAudio') && (
                <BooleanField
                  label="Remove this tab's audio"
                  value={value.screenAudio.restrictOwnAudio}
                  onChange={(restrictOwnAudio) => patchScreenAudio({ restrictOwnAudio })}
                  disabled={disabled}
                />
              )}
              {systemAudioEnabled && supports('suppressLocalAudioPlayback') && (
                <BooleanField
                  label="Mute captured tab locally"
                  value={value.screenAudio.suppressLocalAudioPlayback}
                  onChange={(suppressLocalAudioPlayback) =>
                    patchScreenAudio({ suppressLocalAudioPlayback })
                  }
                  disabled={disabled}
                />
              )}
            </div>
            <p style={noteStyle}>
              The browser still shows its own surface picker and may limit which display constraints
              it honors.
            </p>
          </fieldset>
        )}

        <fieldset style={fieldsetStyle} disabled={disabled}>
          <legend style={legendStyle}>Encoding</legend>
          <div style={gridStyle}>
            {hasStandaloneAudioRecorder && (
              <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                Audio MIME type / codecs
                <input
                  type="text"
                  list={audioMimeListId}
                  value={value.encoding.audioMimeType}
                  style={inputStyle}
                  placeholder="Automatic"
                  onChange={(event) => patchEncoding({ audioMimeType: event.target.value })}
                />
                <datalist id={audioMimeListId}>
                  {AUDIO_MIME_TYPES.map((mime) => (
                    <option key={mime} value={mime} />
                  ))}
                </datalist>
              </label>
            )}
            {hasAudioTrack && (
              <>
                <NumericField
                  label="Audio bitrate (kbps)"
                  value={value.encoding.audioBitsPerSecond}
                  onChange={(audioBitsPerSecond) => patchEncoding({ audioBitsPerSecond })}
                  disabled={disabled}
                />
              </>
            )}
            {(cameraEnabled || screenEnabled) && (
              <>
                <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                  Video MIME type / codecs
                  <input
                    type="text"
                    list={videoMimeListId}
                    value={value.encoding.videoMimeType}
                    style={inputStyle}
                    placeholder="Automatic"
                    onChange={(event) => patchEncoding({ videoMimeType: event.target.value })}
                  />
                  <datalist id={videoMimeListId}>
                    {VIDEO_MIME_TYPES.map((mime) => (
                      <option key={mime} value={mime} />
                    ))}
                  </datalist>
                </label>
                <NumericField
                  label="Video bitrate (kbps)"
                  value={value.encoding.videoBitsPerSecond}
                  onChange={(videoBitsPerSecond) => patchEncoding({ videoBitsPerSecond })}
                  disabled={disabled}
                />
              </>
            )}
            <NumericField
              label="Total bitrate (kbps)"
              value={value.encoding.bitsPerSecond}
              onChange={(bitsPerSecond) => patchEncoding({ bitsPerSecond })}
              disabled={disabled}
            />
            {hasAudioTrack && (
              <label style={fieldStyle}>
                Audio bitrate mode
                <select
                  value={value.encoding.audioBitrateMode ?? ''}
                  disabled={disabled}
                  style={inputStyle}
                  onChange={(event) =>
                    patchEncoding({
                      audioBitrateMode:
                        event.target.value === 'constant' || event.target.value === 'variable'
                          ? event.target.value
                          : undefined,
                    })
                  }
                >
                  <option value="">Browser default</option>
                  <option value="variable">Variable</option>
                  <option value="constant">Constant</option>
                </select>
              </label>
            )}
            {(cameraEnabled || screenEnabled) && (
              <>
                <NumericField
                  label="Keyframe interval (ms)"
                  value={value.encoding.videoKeyFrameIntervalDuration}
                  onChange={(videoKeyFrameIntervalDuration) =>
                    patchEncoding({
                      videoKeyFrameIntervalDuration,
                      videoKeyFrameIntervalCount: undefined,
                    })
                  }
                  disabled={disabled}
                />
                <NumericField
                  label="Keyframe interval (frames)"
                  value={value.encoding.videoKeyFrameIntervalCount}
                  onChange={(videoKeyFrameIntervalCount) =>
                    patchEncoding({
                      videoKeyFrameIntervalCount,
                      videoKeyFrameIntervalDuration: undefined,
                    })
                  }
                  disabled={disabled}
                />
              </>
            )}
          </div>
          <p style={noteStyle}>
            MIME and bitrate values are hints. Unsupported MIME choices fall back to the
            recorder&apos;s automatic format selection. A total bitrate overrides separate
            audio/video bitrate hints.
          </p>
        </fieldset>

        {Object.keys(actualSettings).length > 0 && (
          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Active track settings</legend>
            <pre style={actualStyle}>{JSON.stringify(actualSettings, null, 2)}</pre>
          </fieldset>
        )}

        <p style={noteStyle}>
          Only constraints advertised by this browser are shown. Device names may appear only after
          microphone or camera permission is granted.
        </p>
      </div>
    </details>
  );
}
