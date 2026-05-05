/**
 * Read-only viewer renderers for `<JsonView>`. Each viewer is a small
 * pure function that takes a value + schema slice and renders inline.
 * Group / card-stack viewers recurse into `RenderNode`.
 */

import { Fragment, useMemo } from 'react';
import {
  arrayItemKind,
  type ControlKind,
  type SquisqAnnotatedSchema,
} from '@bendyline/squisq/jsonForm';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { RenderNode } from './RenderNode';

export interface ViewerProps {
  value: unknown;
  schema: SquisqAnnotatedSchema;
  rootSchema: SquisqAnnotatedSchema;
  rootData: unknown;
  pointer: string;
  density: 'comfortable' | 'compact';
}

// ── Primitive viewers ──────────────────────────────────────────────

export function TextViewer({ value }: ViewerProps) {
  if (value === undefined || value === null || value === '') {
    return <span className="squisq-jv-empty">—</span>;
  }
  return <span className="squisq-jv-value">{String(value)}</span>;
}

export function MultilineViewer({ value }: ViewerProps) {
  if (value === undefined || value === null || value === '') {
    return <span className="squisq-jv-empty">—</span>;
  }
  return <span className="squisq-jv-value squisq-jv-value--multiline">{String(value)}</span>;
}

export function RichTextViewer({ value }: ViewerProps) {
  const nodes = useMemo(() => {
    if (typeof value !== 'string' || value === '') return null;
    try {
      const doc = parseMarkdown(value);
      return doc.children;
    } catch {
      return null;
    }
  }, [value]);
  if (!nodes) return <span className="squisq-jv-empty">—</span>;
  return (
    <div className="squisq-jv-richtext">
      <MarkdownRenderer nodes={nodes} />
    </div>
  );
}

export function NumberViewer({ value }: ViewerProps) {
  if (value === undefined || value === null) {
    return <span className="squisq-jv-empty">—</span>;
  }
  return <span className="squisq-jv-value">{String(value)}</span>;
}

export function BooleanViewer({ value }: ViewerProps) {
  const on = Boolean(value);
  return (
    <span className={`squisq-jv-toggle squisq-jv-toggle--${on ? 'on' : 'off'}`}>
      {on ? 'On' : 'Off'}
    </span>
  );
}

export function EnumViewer({ value, schema }: ViewerProps) {
  if (value === undefined || value === null || value === '') {
    return <span className="squisq-jv-empty">—</span>;
  }
  const labels = schema.squisq?.enumLabels;
  const display = labels && typeof value === 'string' ? (labels[value] ?? value) : String(value);
  return <span className="squisq-jv-value">{display}</span>;
}

export function ColorViewer({ value }: ViewerProps) {
  if (typeof value !== 'string' || value === '') {
    return <span className="squisq-jv-empty">—</span>;
  }
  return (
    <span className="squisq-jv-color">
      <span className="squisq-jv-color__swatch" style={{ background: value }} aria-hidden />
      <span className="squisq-jv-color__hex">{value}</span>
    </span>
  );
}

export function DateViewer({ value, schema }: ViewerProps) {
  if (typeof value !== 'string' || value === '') {
    return <span className="squisq-jv-empty">—</span>;
  }
  const fmt = schema.format;
  let display = value;
  try {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      if (fmt === 'time') {
        display = date.toLocaleTimeString();
      } else if (fmt === 'date') {
        display = date.toLocaleDateString();
      } else {
        display = date.toLocaleString();
      }
    }
  } catch {
    /* fall through to raw value */
  }
  return <span className="squisq-jv-value">{display}</span>;
}

// ── Composite viewers ─────────────────────────────────────────────

export function ChipBinViewer({ value, schema }: ViewerProps) {
  if (!Array.isArray(value) || value.length === 0) {
    return <span className="squisq-jv-empty">—</span>;
  }
  const itemSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items;
  const labels = itemSchema?.squisq?.enumLabels;
  return (
    <div className="squisq-jv-chip-bin">
      {value.map((item, i) => {
        const label =
          labels && typeof item === 'string' ? (labels[item] ?? String(item)) : String(item);
        return (
          <span key={i} className="squisq-jv-chip">
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function CardStackViewer(props: ViewerProps) {
  const { value, schema, rootSchema, rootData, pointer, density } = props;
  if (!Array.isArray(value) || value.length === 0) {
    return <span className="squisq-jv-empty">No items</span>;
  }
  const itemSchema = (Array.isArray(schema.items) ? schema.items[0] : schema.items) ?? {};
  const itemLabel = itemSchema.squisq?.itemLabel;
  return (
    <div className="squisq-jv-card-stack">
      {value.map((item, i) => {
        const title = resolveItemTitle(itemLabel, item, i);
        return (
          <div key={i} className="squisq-jv-card">
            {title ? <h4 className="squisq-jv-card__title">{title}</h4> : null}
            <RenderNode
              value={item}
              schema={itemSchema}
              rootSchema={rootSchema}
              rootData={rootData}
              pointer={`${pointer}/${i}`}
              density={density}
              suppressTopGroupTitle
            />
          </div>
        );
      })}
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

export function GroupViewer(props: ViewerProps & { suppressTitle?: boolean }) {
  const { value, schema, rootSchema, rootData, pointer, density, suppressTitle } = props;
  const title = !suppressTitle ? (schema.squisq?.label ?? schema.title) : undefined;
  const help = schema.squisq?.help ?? schema.description;
  const obj = (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}) ?? {};
  const propEntries = Object.entries(schema.properties ?? {});

  return (
    <section className="squisq-jv-group">
      {title ? <h3 className="squisq-jv-group__title">{title}</h3> : null}
      {help ? <p className="squisq-jv-group__help">{help}</p> : null}
      {propEntries.map(([key, propSchema]) => (
        <Fragment key={key}>
          <RowOrSection
            label={propSchema.squisq?.label ?? propSchema.title ?? key}
            help={propSchema.squisq?.help ?? propSchema.description}
            kindHint={propSchema}
          >
            <RenderNode
              value={obj[key]}
              schema={propSchema}
              rootSchema={rootSchema}
              rootData={rootData}
              pointer={`${pointer}/${key}`}
              density={density}
              suppressTopGroupTitle
            />
          </RowOrSection>
        </Fragment>
      ))}
    </section>
  );
}

/**
 * Decide whether to use the inline label/value Row layout, or to drop
 * the row chrome entirely (for nested groups, card-stacks, richtext —
 * which present their own headings).
 */
function RowOrSection({
  label,
  help,
  kindHint,
  children,
}: {
  label: string;
  help?: string;
  kindHint: SquisqAnnotatedSchema;
  children: React.ReactNode;
}) {
  const composite = isCompositeKind(kindHint);
  if (composite) {
    return <>{children}</>;
  }
  return (
    <div className="squisq-jv-row">
      <div className="squisq-jv-label" title={help}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function isCompositeKind(schema: SquisqAnnotatedSchema): boolean {
  const t = schema.type;
  const arrayLike = t === 'array' || (Array.isArray(t) && t.includes('array'));
  if (arrayLike) {
    return arrayItemKind(schema) === 'object';
  }
  const objectLike = t === 'object' || (Array.isArray(t) && t.includes('object'));
  if (objectLike) return true;
  if (schema.oneOf || schema.anyOf) return true;
  if (schema.format === 'markdown' || schema.squisq?.control === 'richtext') return true;
  return false;
}

export function TabsViewer(props: ViewerProps) {
  const { value, schema, rootSchema, rootData, pointer, density } = props;
  const branches = (schema.oneOf ?? schema.anyOf ?? []).slice();
  const matchedIndex = pickMatchingBranch(branches as SquisqAnnotatedSchema[], value);
  const branch = branches[matchedIndex] as SquisqAnnotatedSchema | undefined;
  if (!branch) {
    return <TextViewer {...props} />;
  }
  return (
    <div className="squisq-jv-tabs">
      <span className="squisq-jv-tabs__discriminator">
        {branch.squisq?.label ?? branch.title ?? `Option ${matchedIndex + 1}`}
      </span>
      <RenderNode
        value={value}
        schema={branch}
        rootSchema={rootSchema}
        rootData={rootData}
        pointer={pointer}
        density={density}
      />
    </div>
  );
}

function pickMatchingBranch(branches: SquisqAnnotatedSchema[], value: unknown): number {
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

export const VIEWERS: Record<ControlKind, React.ComponentType<ViewerProps>> = {
  text: TextViewer,
  multiline: MultilineViewer,
  richtext: RichTextViewer,
  color: ColorViewer,
  date: DateViewer,
  time: DateViewer,
  datetime: DateViewer,
  slider: NumberViewer,
  stepper: NumberViewer,
  segmented: EnumViewer,
  radio: EnumViewer,
  combobox: EnumViewer,
  toggle: BooleanViewer,
  checkbox: BooleanViewer,
  card: GroupViewer,
  group: GroupViewer,
  'card-stack': CardStackViewer,
  'chip-bin': ChipBinViewer,
  tabs: TabsViewer,
};
