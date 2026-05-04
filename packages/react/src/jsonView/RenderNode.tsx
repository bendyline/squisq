/**
 * Recursive dispatcher: looks at a schema node + value, chooses a
 * `ControlKind`, evaluates `hidden` rules, and renders the matching
 * read-only viewer.
 */

import {
  chooseControl,
  resolveFlag,
  resolveRef,
  type SquisqAnnotatedSchema,
} from '@bendyline/squisq/jsonForm';
import { VIEWERS, type ViewerProps } from './viewers';

export interface RenderNodeProps {
  value: unknown;
  schema: SquisqAnnotatedSchema;
  rootSchema: SquisqAnnotatedSchema;
  rootData: unknown;
  pointer: string;
  density: 'comfortable' | 'compact';
  /**
   * When a parent group already wrote its own card chrome (e.g. a
   * card-stack item), suppress the nested group's outer title so the
   * UI doesn't double up on labels.
   */
  suppressTopGroupTitle?: boolean;
}

export function RenderNode(props: RenderNodeProps): React.ReactElement | null {
  const resolved = resolveRef(props.schema, props.rootSchema) ?? props.schema;

  if (resolveFlag(resolved.squisq?.hidden, props.rootData)) return null;

  const kind = chooseControl(resolved);
  const Viewer = VIEWERS[kind];
  const viewerProps: ViewerProps = {
    value: props.value,
    schema: resolved,
    rootSchema: props.rootSchema,
    rootData: props.rootData,
    pointer: props.pointer,
    density: props.density,
  };
  if (kind === 'group' || kind === 'card') {
    // GroupViewer accepts an extra prop that RenderNode forwards.
    const Group = Viewer as React.ComponentType<ViewerProps & { suppressTitle?: boolean }>;
    return <Group {...viewerProps} suppressTitle={props.suppressTopGroupTitle} />;
  }
  return <Viewer {...viewerProps} />;
}
