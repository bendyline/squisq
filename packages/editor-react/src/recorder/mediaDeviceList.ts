/**
 * Turning an `enumerateDevices()` result into the option list a recorder
 * device picker should show — and answering "does the user actually have a
 * choice here?", which is what decides whether a picker is worth surfacing
 * outside Advanced settings.
 *
 * Two kinds of entry are dropped:
 *
 * - **Alias ids.** Chromium reports `deviceId: 'default'` and
 *   `'communications'` for audio inputs: synthetic entries that POINT AT a
 *   real device further down the list. Counting them makes a single-microphone
 *   machine look like it has three. A picker's own "System default" choice
 *   (the empty deviceId — no constraint at all) already covers that intent.
 * - **Blank ids.** Before the first permission grant, browsers return one
 *   label-less, id-less entry per device. There is nothing to select, so those
 *   are placeholders, not choices.
 *
 * The currently-selected id is always kept, even when a rule above would drop
 * it, so a setting persisted from an earlier session can never silently vanish
 * from the control that owns it.
 */

/** One selectable capture device. */
export interface RecorderDeviceOption {
  deviceId: string;
  /** `device.label`, or a positional fallback when labels are withheld. */
  label: string;
  groupId: string;
}

/** Synthetic Chromium entries that alias a real device rather than being one. */
const ALIAS_DEVICE_IDS: ReadonlySet<string> = new Set(['default', 'communications']);

/**
 * The real, selectable devices of one kind. Excludes the synthetic
 * "System default" entry a picker renders itself.
 */
export function recorderDeviceOptions(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceKind,
  noun: string,
  selectedDeviceId = '',
): RecorderDeviceOption[] {
  const options: RecorderDeviceOption[] = [];
  for (const device of devices) {
    if (device.kind !== kind) continue;
    // An empty `selectedDeviceId` is "System default", not a device — it must
    // never match the blank-id placeholders this guard is meant to drop.
    const isSelected = selectedDeviceId !== '' && device.deviceId === selectedDeviceId;
    if (!isSelected && (!device.deviceId || ALIAS_DEVICE_IDS.has(device.deviceId))) continue;
    options.push({
      deviceId: device.deviceId,
      label: device.label || `${noun} ${options.length + 1}`,
      groupId: device.groupId || '',
    });
  }
  return options;
}

/**
 * True when more than one real device exists — i.e. picking between them is a
 * decision the user could meaningfully make, rather than a control that can
 * only ever restate the system default.
 */
export function hasRecorderDeviceChoice(options: readonly RecorderDeviceOption[]): boolean {
  return options.length > 1;
}

/** Distinct hardware groups represented by an option list, in first-seen order. */
export function recorderDeviceGroups(
  options: readonly RecorderDeviceOption[],
): Array<{ id: string; label: string }> {
  const groups = new Map<string, string>();
  for (const [index, option] of options.entries()) {
    if (!option.groupId || groups.has(option.groupId)) continue;
    groups.set(option.groupId, option.label || `Device group ${index + 1}`);
  }
  return [...groups].map(([id, label]) => ({ id, label }));
}
