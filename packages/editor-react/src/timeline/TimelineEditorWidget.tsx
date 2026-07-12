/**
 * Accessible WYSIWYG editor for one authored ASCII timeline fence.
 *
 * The canvas is deliberately DOM/SVG rather than a freeform diagram scene:
 * tracks share one normalized horizontal scale, markers are real buttons,
 * and the selected event is edited through ordinary form controls.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/react';
import {
  asciiTimelineToTemplateData,
  type AsciiTimelineEvent,
  type AsciiTimelineMarker,
  type AsciiTimelineSide,
} from '@bendyline/squisq/doc';
import { Icon } from '../Icon';
import { useTimelineData } from './timelineData';
import {
  applyTimelineCommand,
  isTimelineSourceSafeForSemanticEdit,
  type TimelineCommand,
  type TimelineCommandResult,
} from './timelineCommands';

export interface TimelineEditorWidgetProps {
  editor: Editor;
  blockId: string;
}

interface SelectedEvent {
  event: AsciiTimelineEvent;
  trackId: string;
  trackLabel: string;
}

interface PositionedEvent {
  event: AsciiTimelineEvent;
  trackId: string;
  trackIndex: number;
  position: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function TimelineEditorWidget({ editor, blockId }: TimelineEditorWidgetProps) {
  const view = useTimelineData(editor, blockId);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ trackId: string; position: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const dispatch = useCallback(
    (command: TimelineCommand): TimelineCommandResult => {
      const result = applyTimelineCommand(editor, blockId, command);
      if (result.reason === 'read-only') setAnnouncement('Timeline is read only.');
      if (result.reason === 'unsafe-source') {
        setAnnouncement('Visual editing is paused until the timeline source is repaired.');
      }
      return result;
    },
    [editor, blockId],
  );

  const sourceText = view?.text;
  const sourceTimeline = view?.timeline;
  const sourceSafe = useMemo(
    () =>
      sourceText && sourceTimeline
        ? isTimelineSourceSafeForSemanticEdit(sourceText, sourceTimeline)
        : false,
    // `useTimelineData` publishes on every editor transaction so read-only
    // changes are observed. Unrelated transactions retain both primitive/model
    // identities; depending on those keeps the linear safety audit out of the
    // editor's cursor/selection hot path.
    [sourceText, sourceTimeline],
  );

  const positioned = useMemo(() => {
    if (!view) return [];
    const normalized = asciiTimelineToTemplateData(view.timeline).tracks;
    return view.timeline.tracks.flatMap((track, trackIndex) => {
      const templateTrack = normalized[trackIndex];
      return track.events.map(
        (event, eventIndex): PositionedEvent => ({
          event,
          trackId: track.id,
          trackIndex,
          position: templateTrack?.events[eventIndex]?.position ?? 0,
        }),
      );
    });
  }, [view]);

  const positionById = useMemo(
    () => new Map(positioned.map((point) => [point.event.id, point.position])),
    [positioned],
  );

  const selected = useMemo<SelectedEvent | null>(() => {
    if (!view || !selectedEventId) return null;
    for (const track of view.timeline.tracks) {
      const event = track.events.find((candidate) => candidate.id === selectedEventId);
      if (event) {
        return {
          event,
          trackId: track.id,
          trackLabel: track.label || `Track ${view.timeline.tracks.indexOf(track) + 1}`,
        };
      }
    }
    return null;
  }, [selectedEventId, view]);

  useEffect(() => {
    if (!view) return;
    const ids = new Set(
      view.timeline.tracks.flatMap((track) => track.events.map((event) => event.id)),
    );
    if (selectedEventId && ids.has(selectedEventId)) return;
    setSelectedEventId(view.timeline.tracks[0]?.events[0]?.id ?? null);
  }, [selectedEventId, view]);

  if (!view) return null;

  const editorEditable = editor.isEditable;
  const editable = editorEditable && sourceSafe;
  const totalEvents = positioned.length;
  const addEvent = (trackId: string, position: number) => {
    if (!editable) return;
    const result = dispatch({ kind: 'addEvent', trackId, position: clamp01(position) });
    if (result.applied && result.eventId) {
      setSelectedEventId(result.eventId);
      setAnnouncement('New timeline point added. Edit its text below.');
    }
  };

  const selectEvent = (event: AsciiTimelineEvent, trackLabel: string) => {
    setSelectedEventId(event.id);
    setAnnouncement(`${event.label || 'Timeline point'} selected on ${trackLabel}.`);
  };

  return (
    <section className="squisq-ascii-timeline-editor" aria-label="Timeline editor">
      <header className="squisq-ascii-timeline-header">
        <span>
          <Icon icon="fa-solid fa-timeline" /> Timeline
        </span>
        {editable ? (
          <small>Click the line to add a point</small>
        ) : editorEditable ? (
          <small>Source repair needed</small>
        ) : (
          <small>Read only</small>
        )}
      </header>

      <div
        className="squisq-ascii-timeline-canvas"
        style={
          { '--squisq-ascii-timeline-track-count': view.timeline.tracks.length } as CSSProperties
        }
      >
        {view.timeline.links.length > 0 ? (
          <svg
            className="squisq-ascii-timeline-branches"
            viewBox={`0 0 100 ${Math.max(1, view.timeline.tracks.length) * 96}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {view.timeline.links.map((link, index) => {
              const source = positioned.find((point) => point.event.id === link.source);
              const target = positioned.find((point) => point.event.id === link.target);
              if (!source || !target) return null;
              const sx = source.position * 100;
              const tx = target.position * 100;
              const sy = source.trackIndex * 96 + 48;
              const ty = target.trackIndex * 96 + 48;
              const sameTrack = source.trackIndex === target.trackIndex;
              const controlY = sameTrack
                ? sy + (source.event.side === 'below' ? -30 : 30)
                : (sy + ty) / 2;
              return (
                <path
                  key={`${link.source}-${link.target}-${index}`}
                  d={`M ${sx} ${sy} C ${sx} ${controlY}, ${tx} ${controlY}, ${tx} ${ty}`}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        ) : null}

        {view.timeline.tracks.map((track, trackIndex) => {
          const trackLabel = track.label || `Track ${trackIndex + 1}`;
          const events = track.events
            .map((event) => ({ event, position: positionById.get(event.id) ?? 0 }))
            .sort((a, b) => a.position - b.position);
          const eventPositions = events.map((entry) => entry.position);
          const gaps = insertionGaps(eventPositions);
          return (
            <div className="squisq-ascii-timeline-track" key={track.id}>
              <div className="squisq-ascii-timeline-track-label" title={trackLabel}>
                <span>{trackLabel}</span>
                {editable ? (
                  <button
                    type="button"
                    className="squisq-ascii-timeline-track-add"
                    aria-label={`Add point to ${trackLabel} timeline`}
                    title="Add point in the largest available gap"
                    onClick={() => addEvent(track.id, largestGap(eventPositions))}
                  >
                    +
                  </button>
                ) : null}
              </div>
              <div
                className={`squisq-ascii-timeline-rail${editable ? '' : ' squisq-ascii-timeline-rail--readonly'}`}
                role="group"
                aria-label={`${trackLabel} timeline rail`}
                title={editable ? 'Click anywhere on the line to add a point' : undefined}
                onPointerMove={(event) => {
                  if (!editable) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (rect.width <= 0) return;
                  setHover({
                    trackId: track.id,
                    position: clamp01((event.clientX - rect.left) / rect.width),
                  });
                }}
                onPointerLeave={() =>
                  setHover((current) => (current?.trackId === track.id ? null : current))
                }
                onClick={(event) => {
                  if (!editable || event.target !== event.currentTarget) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (rect.width <= 0) return;
                  addEvent(track.id, (event.clientX - rect.left) / rect.width);
                }}
              >
                <span className="squisq-ascii-timeline-rail-line" aria-hidden="true" />
                {hover?.trackId === track.id ? (
                  <span
                    className="squisq-ascii-timeline-add-ghost"
                    style={{ left: `${hover.position * 100}%` }}
                    aria-hidden="true"
                  >
                    +
                  </span>
                ) : null}

                {editable
                  ? gaps.map((position) => (
                      <button
                        type="button"
                        className="squisq-ascii-timeline-gap-add"
                        style={{ left: `${position * 100}%` }}
                        aria-label={`Add point to ${trackLabel} at ${Math.round(position * 100)} percent`}
                        title="Add point"
                        key={position}
                        onClick={(event) => {
                          event.stopPropagation();
                          addEvent(track.id, position);
                        }}
                      >
                        +
                      </button>
                    ))
                  : null}

                {events.map(({ event, position }, eventIndex) => {
                  const selectedPoint = selectedEventId === event.id;
                  const side = event.side ?? (eventIndex % 2 === 0 ? 'above' : 'below');
                  const descriptionSide = event.descriptionSide ?? side;
                  return (
                    <span
                      className={`squisq-ascii-timeline-point squisq-ascii-timeline-point--${side}`}
                      style={{ left: `${position * 100}%` }}
                      key={event.id}
                    >
                      {event.callout !== false ? (
                        <span
                          className={`squisq-ascii-timeline-callout squisq-ascii-timeline-callout--${side}`}
                        >
                          {event.label}
                        </span>
                      ) : null}
                      {event.callout !== false && event.description ? (
                        <span
                          className={`squisq-ascii-timeline-description squisq-ascii-timeline-description--${descriptionSide}`}
                        >
                          {event.description}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className={`squisq-ascii-timeline-marker squisq-ascii-timeline-marker--${event.marker ?? 'filled'}${selectedPoint ? ' squisq-ascii-timeline-marker--selected' : ''}`}
                        aria-label={`Edit ${event.label || 'timeline point'}, ${trackLabel}, ${Math.round(position * 100)} percent`}
                        aria-pressed={selectedPoint}
                        title={event.description || event.label}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          selectEvent(event, trackLabel);
                        }}
                        onKeyDown={(keyEvent) => navigateTrackPoints(keyEvent)}
                      />
                    </span>
                  );
                })}
                {track.endLabel ? (
                  <span className="squisq-ascii-timeline-end-label">{track.endLabel}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {view.timeline.links.length > 0 ? (
        <ul className="squisq-ascii-timeline-link-list" aria-label="Timeline branches">
          {view.timeline.links.map((link, index) => (
            <li key={`${link.source}-${link.target}-${index}`}>
              {link.source} → {link.target}
              {link.label ? `: ${link.label}` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {selected ? (
        <EventInspector
          key={`${selected.trackId}:${selected.event.id}`}
          selected={selected}
          editable={editable}
          canDelete={totalEvents > 1}
          dispatch={dispatch}
          onDelete={() => {
            const remaining = positioned.filter((point) => point.event.id !== selected.event.id);
            const result = dispatch({ kind: 'removeEvent', eventId: selected.event.id });
            if (result.applied) {
              setSelectedEventId(remaining[0]?.event.id ?? null);
              setAnnouncement(`${selected.event.label} deleted.`);
            }
          }}
        />
      ) : null}

      {!sourceSafe ? (
        <div className="squisq-ascii-timeline-warnings" role="status">
          Visual editing paused: this timeline contains source the canvas cannot safely rewrite.
          Repair it in Source view first.
          {view.warnings.length > 0
            ? ` (${view.warnings.length} parser note${view.warnings.length === 1 ? '' : 's'})`
            : ''}
        </div>
      ) : null}
      <div className="squisq-sr-only" aria-live="polite">
        {announcement}
      </div>
    </section>
  );
}

function EventInspector({
  selected,
  editable,
  canDelete,
  dispatch,
  onDelete,
}: {
  selected: SelectedEvent;
  editable: boolean;
  canDelete: boolean;
  dispatch: (command: TimelineCommand) => TimelineCommandResult;
  onDelete: () => void;
}) {
  const { event } = selected;
  const [label, setLabel] = useState(event.label);
  const [description, setDescription] = useState(event.description ?? '');

  useEffect(() => setLabel(event.label), [event.label]);
  useEffect(() => setDescription(event.description ?? ''), [event.description]);

  const update = (patch: TimelineCommand & { kind: 'updateEvent' }) => dispatch(patch);
  const commitLabel = () => {
    const next = label.trim();
    if (!next) {
      setLabel(event.label);
      return;
    }
    if (next !== event.label) {
      const result = update({ kind: 'updateEvent', eventId: event.id, patch: { label: next } });
      if (!result.applied) setLabel(event.label);
    }
  };
  const commitDescription = () => {
    const next = description.trim();
    if (next !== (event.description ?? '')) {
      const result = update({
        kind: 'updateEvent',
        eventId: event.id,
        patch: { description: next || undefined },
      });
      if (!result.applied) setDescription(event.description ?? '');
    }
  };

  return (
    <fieldset className="squisq-ascii-timeline-inspector" disabled={!editable}>
      <legend>
        Edit point <span>{selected.trackLabel}</span>
      </legend>
      <label>
        <span>Label</span>
        <input
          value={label}
          onChange={(event_) => setLabel(event_.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event_) => {
            if (event_.key === 'Enter') {
              event_.preventDefault();
              commitLabel();
              event_.currentTarget.blur();
            } else if (event_.key === 'Escape') {
              setLabel(event.label);
              event_.currentTarget.blur();
            }
          }}
        />
      </label>
      <label className="squisq-ascii-timeline-inspector-description">
        <span>Callout text</span>
        <textarea
          rows={2}
          value={description}
          onChange={(event_) => setDescription(event_.target.value)}
          onBlur={commitDescription}
          onKeyDown={(event_) => {
            if ((event_.ctrlKey || event_.metaKey) && event_.key === 'Enter') {
              event_.preventDefault();
              commitDescription();
              event_.currentTarget.blur();
            } else if (event_.key === 'Escape') {
              setDescription(event.description ?? '');
              event_.currentTarget.blur();
            }
          }}
        />
      </label>
      <label>
        <span>Label side</span>
        <select
          value={event.side ?? 'above'}
          onChange={(event_) =>
            update({
              kind: 'updateEvent',
              eventId: event.id,
              patch: { side: event_.target.value as AsciiTimelineSide },
            })
          }
        >
          <option value="above">Above</option>
          <option value="below">Below</option>
        </select>
      </label>
      <label>
        <span>Marker</span>
        <select
          value={event.marker ?? 'filled'}
          onChange={(event_) =>
            update({
              kind: 'updateEvent',
              eventId: event.id,
              patch: { marker: event_.target.value as AsciiTimelineMarker },
            })
          }
        >
          <option value="filled">Filled dot</option>
          <option value="hollow">Hollow dot</option>
          <option value="diamond">Diamond</option>
        </select>
      </label>
      <label className="squisq-ascii-timeline-checkbox">
        <input
          type="checkbox"
          checked={event.callout !== false}
          onChange={(event_) =>
            update({
              kind: 'updateEvent',
              eventId: event.id,
              patch: { callout: event_.target.checked },
            })
          }
        />
        <span>Show callout</span>
      </label>
      <button
        type="button"
        className="squisq-ascii-timeline-delete"
        disabled={!canDelete}
        title={canDelete ? 'Delete point' : 'A timeline needs at least one point'}
        onClick={onDelete}
      >
        <Icon icon="fa-solid fa-trash" /> Delete point
      </button>
    </fieldset>
  );
}

function insertionGaps(positions: readonly number[]): number[] {
  if (positions.length === 0) return [0.5];
  const sorted = [...positions].sort((a, b) => a - b);
  const bounds = [0, ...sorted, 1];
  const gaps: number[] = [];
  for (let index = 0; index < bounds.length - 1; index++) {
    const start = bounds[index];
    const end = bounds[index + 1];
    if (end - start >= 0.09) gaps.push((start + end) / 2);
  }
  return gaps;
}

function largestGap(positions: readonly number[]): number {
  if (positions.length === 0) return 0.5;
  const sorted = [0, ...positions.map(clamp01).sort((a, b) => a - b), 1];
  let start = sorted[0];
  let end = sorted[1];
  for (let index = 1; index < sorted.length - 1; index++) {
    if (sorted[index + 1] - sorted[index] > end - start) {
      start = sorted[index];
      end = sorted[index + 1];
    }
  }
  return (start + end) / 2;
}

function navigateTrackPoints(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const rail = event.currentTarget.closest('.squisq-ascii-timeline-rail');
  if (!rail) return;
  const buttons = Array.from(
    rail.querySelectorAll<HTMLButtonElement>('.squisq-ascii-timeline-marker'),
  );
  const current = buttons.indexOf(event.currentTarget);
  if (current < 0) return;
  event.preventDefault();
  const target =
    event.key === 'Home'
      ? buttons[0]
      : event.key === 'End'
        ? buttons[buttons.length - 1]
        : event.key === 'ArrowLeft'
          ? buttons[Math.max(0, current - 1)]
          : buttons[Math.min(buttons.length - 1, current + 1)];
  target?.focus();
}

export default TimelineEditorWidget;
