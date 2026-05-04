/**
 * Editable renderers for `<JsonEditor>`. Each editor is a small
 * controlled component that reads its slice from the
 * `JsonEditorContext` via JSON Pointer and writes back via
 * `setAtPath`. Composite renderers (group, card-stack, tabs) recurse
 * into `RenderNode`.
 */

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import {
  arrayItemKind,
  type ControlKind,
  type SquisqAnnotatedSchema,
} from '@bendyline/squisq/jsonForm';
import { useJsonEditor } from './JsonEditorContext';
import { RenderNode } from './RenderNode';
import { EmbeddedRichTextField } from './EmbeddedRichTextField';

export interface EditorProps {
  value: unknown;
  schema: SquisqAnnotatedSchema;
  pointer: string;
  disabled: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────

function asString(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function asNumber(v: unknown): number | '' {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}

// ── Primitive editors ────────────────────────────────────────────

export function TextEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  return (
    <input
      type="text"
      className="squisq-jf-input"
      value={asString(value)}
      placeholder={schema.squisq?.placeholder}
      disabled={disabled}
      onChange={(e) => setAtPath(pointer, e.target.value)}
    />
  );
}

export function MultilineEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const ref = useRef<HTMLTextAreaElement>(null);
  // Auto-grow vertically.
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="squisq-jf-textarea"
      value={asString(value)}
      placeholder={schema.squisq?.placeholder}
      disabled={disabled}
      onChange={(e) => setAtPath(pointer, e.target.value)}
    />
  );
}

export function RichTextEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  return (
    <EmbeddedRichTextField
      value={asString(value)}
      placeholder={schema.squisq?.placeholder}
      readOnly={disabled}
      onChange={(md) => setAtPath(pointer, md)}
    />
  );
}

export function NumberStepperEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const isInt = schema.type === 'integer';
  const step = schema.squisq?.step ?? schema.multipleOf ?? (isInt ? 1 : 0.1);
  const num = asNumber(value);
  const update = (next: number) => {
    const min = schema.minimum ?? schema.exclusiveMinimum;
    const max = schema.maximum ?? schema.exclusiveMaximum;
    let clamped = next;
    if (typeof min === 'number') clamped = Math.max(min, clamped);
    if (typeof max === 'number') clamped = Math.min(max, clamped);
    setAtPath(pointer, isInt ? Math.round(clamped) : clamped);
  };
  return (
    <span className="squisq-jf-stepper">
      <button
        type="button"
        className="squisq-jf-stepper__btn"
        disabled={disabled}
        onClick={() => update((typeof num === 'number' ? num : 0) - step)}
        aria-label="Decrease"
      >
        −
      </button>
      <input
        className="squisq-jf-stepper__input"
        type="number"
        value={num === '' ? '' : num}
        step={step}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          if (e.target.value === '') {
            setAtPath(pointer, undefined);
            return;
          }
          const n = Number(e.target.value);
          if (Number.isFinite(n)) update(n);
        }}
      />
      <button
        type="button"
        className="squisq-jf-stepper__btn"
        disabled={disabled}
        onClick={() => update((typeof num === 'number' ? num : 0) + step)}
        aria-label="Increase"
      >
        +
      </button>
    </span>
  );
}

export function SliderEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const min = (schema.minimum ?? schema.exclusiveMinimum ?? 0) as number;
  const max = (schema.maximum ?? schema.exclusiveMaximum ?? 100) as number;
  const step = schema.squisq?.step ?? schema.multipleOf ?? (schema.type === 'integer' ? 1 : 1);
  const num = asNumber(value);
  const display = typeof num === 'number' ? num : min;
  return (
    <span className="squisq-jf-slider-row">
      <input
        type="range"
        className="squisq-jf-slider"
        min={min}
        max={max}
        step={step}
        value={display}
        disabled={disabled}
        onChange={(e) => setAtPath(pointer, Number(e.target.value))}
      />
      <span className="squisq-jf-slider-readout">{display}</span>
    </span>
  );
}

export function ToggleEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const on = Boolean(value);
  return (
    <button
      type="button"
      className={`squisq-jf-toggle${on ? ' squisq-jf-toggle--on' : ''}`}
      disabled={disabled}
      onClick={() => setAtPath(pointer, !on)}
      aria-pressed={on}
    >
      <span className="squisq-jf-toggle__track">
        <span className="squisq-jf-toggle__thumb" />
      </span>
      <span className="squisq-jf-toggle__label">
        {on
          ? (schema.squisq?.label ? `${schema.squisq.label}: On` : 'On')
          : (schema.squisq?.label ? `${schema.squisq.label}: Off` : 'Off')}
      </span>
    </button>
  );
}

export function CheckboxEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const id = useId();
  return (
    <label htmlFor={id} className="squisq-jf-toggle">
      <input
        id={id}
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(e) => setAtPath(pointer, e.target.checked)}
      />
      {schema.squisq?.label ?? schema.title ?? ''}
    </label>
  );
}

function enumOptions(schema: SquisqAnnotatedSchema): { value: unknown; label: string }[] {
  const labels = schema.squisq?.enumLabels;
  return (schema.enum ?? []).map((v) => ({
    value: v,
    label: labels && typeof v === 'string' ? (labels[v] ?? String(v)) : String(v),
  }));
}

export function SegmentedEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const options = enumOptions(schema);
  return (
    <span className="squisq-jf-segmented">
      {options.map((opt, i) => {
        const active = value === opt.value;
        return (
          <button
            key={i}
            type="button"
            className={`squisq-jf-segmented__btn${active ? ' squisq-jf-segmented__btn--active' : ''}`}
            disabled={disabled}
            onClick={() => setAtPath(pointer, opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}

export function RadioEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const options = enumOptions(schema);
  const name = useId();
  return (
    <div className="squisq-jf-radio">
      {options.map((opt, i) => {
        const active = value === opt.value;
        return (
          <label key={i} className="squisq-jf-radio__option">
            <input
              type="radio"
              name={name}
              checked={active}
              disabled={disabled}
              onChange={() => setAtPath(pointer, opt.value)}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}

export function ComboboxEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const options = enumOptions(schema);
  return (
    <select
      className="squisq-jf-select"
      value={asString(value)}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        const matched = options.find((opt) => String(opt.value) === raw);
        setAtPath(pointer, matched ? matched.value : raw);
      }}
    >
      {options.map((opt, i) => (
        <option key={i} value={String(opt.value)}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function ColorEditor({ value, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <span className="squisq-jf-color">
      <input
        type="color"
        className="squisq-jf-color__input"
        value={hex}
        disabled={disabled}
        onChange={(e) => setAtPath(pointer, e.target.value)}
      />
      <input
        type="text"
        className="squisq-jf-input squisq-jf-color__hex"
        value={asString(value)}
        disabled={disabled}
        onChange={(e) => setAtPath(pointer, e.target.value)}
      />
    </span>
  );
}

export function DateEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const fmt = schema.format;
  const inputType = fmt === 'time' ? 'time' : fmt === 'date' ? 'date' : 'datetime-local';
  // datetime-local needs YYYY-MM-DDTHH:mm; if the value is an ISO string we
  // strip the trailing Z + seconds for the input, then write back the full
  // value the user picked.
  const display =
    inputType === 'datetime-local' && typeof value === 'string' && value.includes('T')
      ? value.replace(/Z$|:\d{2}\.\d+Z?$/, '').slice(0, 16)
      : asString(value);
  return (
    <input
      type={inputType}
      className="squisq-jf-input"
      value={display}
      disabled={disabled}
      onChange={(e) => setAtPath(pointer, e.target.value)}
    />
  );
}

// ── Composite editors ────────────────────────────────────────────

export function GroupEditor(
  props: EditorProps & { suppressTitle?: boolean },
) {
  const { value, schema, pointer, disabled, suppressTitle } = props;
  const title = !suppressTitle ? (schema.squisq?.label ?? schema.title) : undefined;
  const help = schema.squisq?.help ?? schema.description;
  const obj = (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}) ?? {};
  const propEntries = Object.entries(schema.properties ?? {});

  return (
    <section className="squisq-jf-group">
      {title ? <h3 className="squisq-jf-group__title">{title}</h3> : null}
      {help ? <p className="squisq-jf-group__help">{help}</p> : null}
      {propEntries.map(([key, propSchema]) => (
        <RenderNode
          key={key}
          value={obj[key]}
          schema={propSchema}
          pointer={`${pointer}/${key}`}
          parentDisabled={disabled}
        />
      ))}
    </section>
  );
}

export function ChipBinEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const items: unknown[] = Array.isArray(value) ? value : [];
  const itemSchema = (Array.isArray(schema.items) ? schema.items[0] : schema.items) ?? { type: 'string' };
  const labels = itemSchema.squisq?.enumLabels;
  const enumOpts = itemSchema.enum;
  const [draft, setDraft] = useState('');

  const remove = (index: number) => {
    const next = items.slice();
    next.splice(index, 1);
    setAtPath(pointer, next);
  };
  const add = (raw: string) => {
    if (raw === '') return;
    const coerced = coerceToSchema(raw, itemSchema);
    setAtPath(pointer, [...items, coerced]);
    setDraft('');
  };

  return (
    <div className="squisq-jf-chip-bin">
      {items.map((item, i) => {
        const display = labels && typeof item === 'string' ? (labels[item] ?? String(item)) : String(item);
        return (
          <span key={i} className="squisq-jf-chip">
            {display}
            <button
              type="button"
              className="squisq-jf-chip__remove"
              disabled={disabled}
              onClick={() => remove(i)}
              aria-label={`Remove ${display}`}
            >
              ×
            </button>
          </span>
        );
      })}
      {!disabled && enumOpts && enumOpts.length > 0 ? (
        <select
          className="squisq-jf-select"
          value=""
          onChange={(e) => add(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="" disabled>
            {schema.squisq?.addLabel ?? '+ Add'}
          </option>
          {enumOpts
            .filter((v: unknown) => !items.includes(v))
            .map((v: unknown, i: number) => (
              <option key={i} value={String(v)}>
                {labels && typeof v === 'string' ? (labels[v] ?? String(v)) : String(v)}
              </option>
            ))}
        </select>
      ) : !disabled ? (
        <input
          type="text"
          className="squisq-jf-chip-bin__add-input"
          placeholder={schema.squisq?.addLabel ?? '+ Add'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft.trim());
            }
          }}
          onBlur={() => add(draft.trim())}
        />
      ) : null}
    </div>
  );
}

function coerceToSchema(raw: string, schema: SquisqAnnotatedSchema): unknown {
  switch (schema.type) {
    case 'integer':
      return parseInt(raw, 10);
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw === 'true' || raw === '1';
    default:
      return raw;
  }
}

export function CardStackEditor({ value, schema, pointer, disabled }: EditorProps) {
  const { setAtPath } = useJsonEditor();
  const items: unknown[] = Array.isArray(value) ? value : [];
  const itemSchema = (Array.isArray(schema.items) ? schema.items[0] : schema.items) ?? { type: 'object' };
  const itemLabel = itemSchema.squisq?.itemLabel;
  const addLabel = schema.squisq?.addLabel ?? '+ Add';

  const updateItems = (next: unknown[]) => setAtPath(pointer, next);
  const addItem = () => updateItems([...items, defaultForSchema(itemSchema)]);
  const removeItem = (i: number) => {
    const next = items.slice();
    next.splice(i, 1);
    updateItems(next);
  };
  const moveItem = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    updateItems(next);
  };

  return (
    <div>
      <div className="squisq-jf-card-stack">
        {items.map((item, i) => {
          const title = resolveItemTitle(itemLabel, item, i);
          return (
            <div key={i} className="squisq-jf-card">
              <div className="squisq-jf-card__header">
                <h4 className="squisq-jf-card__title">{title}</h4>
                {!disabled ? (
                  <span className="squisq-jf-card__actions">
                    <button
                      type="button"
                      className="squisq-jf-icon-btn"
                      onClick={() => moveItem(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="squisq-jf-icon-btn"
                      onClick={() => moveItem(i, +1)}
                      disabled={i === items.length - 1}
                      aria-label="Move down"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="squisq-jf-icon-btn squisq-jf-icon-btn--danger"
                      onClick={() => removeItem(i)}
                      aria-label={schema.squisq?.removeLabel ?? 'Remove'}
                      title={schema.squisq?.removeLabel ?? 'Remove'}
                    >
                      ×
                    </button>
                  </span>
                ) : null}
              </div>
              <RenderNode
                value={item}
                schema={itemSchema}
                pointer={`${pointer}/${i}`}
                parentDisabled={disabled}
                suppressTopGroupTitle
              />
            </div>
          );
        })}
      </div>
      {!disabled ? (
        <button type="button" className="squisq-jf-add-btn" onClick={addItem} style={{ marginTop: 8 }}>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}

function resolveItemTitle(
  spec: string | { fromField: string } | undefined,
  item: unknown,
  index: number,
): string {
  if (!spec) return `Item ${index + 1}`;
  if (typeof spec === 'string') return spec;
  if (item && typeof item === 'object') {
    const v = (item as Record<string, unknown>)[spec.fromField];
    if (typeof v === 'string' && v !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  return `Item ${index + 1}`;
}

function defaultForSchema(schema: SquisqAnnotatedSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== 'null') : schema.type;
  switch (t) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        out[k] = defaultForSchema(v);
      }
      return out;
    }
    case 'array':
      return [];
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return (schema.minimum ?? 0) as number;
    case 'boolean':
      return false;
    default:
      return undefined;
  }
}

export function TabsEditor({ value, schema, pointer, disabled }: EditorProps) {
  const branches = (schema.oneOf ?? schema.anyOf ?? []) as readonly SquisqAnnotatedSchema[];
  const initial = pickMatchingBranch(branches, value);
  const [active, setActive] = useState(initial);
  // Sync if value changes externally to a different branch shape.
  useEffect(() => {
    setActive(pickMatchingBranch(branches, value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const branch = branches[active];
  if (!branch) return null;
  return (
    <div>
      <div className="squisq-jf-tabs__strip">
        {branches.map((b, i) => (
          <button
            key={i}
            type="button"
            className={`squisq-jf-tabs__tab${i === active ? ' squisq-jf-tabs__tab--active' : ''}`}
            disabled={disabled}
            onClick={() => setActive(i)}
          >
            {b.squisq?.label ?? b.title ?? `Option ${i + 1}`}
          </button>
        ))}
      </div>
      <RenderNode value={value} schema={branch} pointer={pointer} parentDisabled={disabled} />
    </div>
  );
}

function pickMatchingBranch(branches: readonly SquisqAnnotatedSchema[], value: unknown): number {
  for (let i = 0; i < branches.length; i++) {
    if (matchesShape(branches[i], value)) return i;
  }
  return 0;
}

function matchesShape(schema: SquisqAnnotatedSchema, value: unknown): boolean {
  const t = schema.type;
  const target = Array.isArray(t) ? t.find((x) => x !== 'null') : t;
  if (!target) return true;
  switch (target) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return false;
  }
}

// ── Registry ──────────────────────────────────────────────────────

export const EDITORS: Record<ControlKind, React.ComponentType<EditorProps>> = {
  text: TextEditor,
  multiline: MultilineEditor,
  richtext: RichTextEditor,
  color: ColorEditor,
  date: DateEditor,
  time: DateEditor,
  datetime: DateEditor,
  slider: SliderEditor,
  stepper: NumberStepperEditor,
  segmented: SegmentedEditor,
  radio: RadioEditor,
  combobox: ComboboxEditor,
  toggle: ToggleEditor,
  checkbox: CheckboxEditor,
  card: GroupEditor,
  group: GroupEditor,
  'card-stack': CardStackEditor,
  'chip-bin': ChipBinEditor,
  tabs: TabsEditor,
};

/** True when this control kind handles its own grouping/heading. */
export function isCompositeControl(kind: ControlKind, schema: SquisqAnnotatedSchema): boolean {
  if (kind === 'group' || kind === 'card' || kind === 'tabs' || kind === 'card-stack') return true;
  if (kind === 'richtext') return true;
  if (kind === 'chip-bin') return arrayItemKind(schema) === 'object';
  return false;
}
