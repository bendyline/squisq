/**
 * Loss-minimizing structured adapters for Mermaid grammars whose databases are
 * not exposed through Mermaid's public API. The Mermaid fence remains the
 * source of truth: every gesture rewrites a small, ordinary source statement.
 */

import type {
  MermaidDiagramProperty,
  MermaidEditCapabilities,
  MermaidEditableEdge,
  MermaidEditableNode,
  MermaidEditableText,
  MermaidFlowchartDirection,
  MermaidSourceEditableModel,
} from './mermaidModel';
import type { MermaidSourceEditResult } from './mermaidSourceOps';

const ID = '[A-Za-z_][A-Za-z0-9_.-]*';
const DIRECTIONS: readonly MermaidFlowchartDirection[] = ['TB', 'BT', 'LR', 'RL'];
const DIRECTION_OPTIONS = [
  { value: 'LR', label: 'Left to right' },
  { value: 'TB', label: 'Top to bottom' },
  { value: 'RL', label: 'Right to left' },
  { value: 'BT', label: 'Bottom to top' },
] as const;

const BASE_CAPABILITIES: MermaidEditCapabilities = {
  addNode: true,
  renameNode: true,
  duplicateNode: true,
  deleteNode: true,
  connect: false,
  disconnect: false,
  edgeLabel: false,
  shape: false,
  direction: false,
  properties: true,
};

function capabilities(overrides: Partial<MermaidEditCapabilities> = {}): MermaidEditCapabilities {
  return { ...BASE_CAPABILITIES, ...overrides };
}

function linesOf(source: string): string[] {
  return source.split(/\r?\n/);
}

function sourceResult(source: string, lines: readonly string[]): MermaidSourceEditResult {
  const next = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  return next === source
    ? { ok: false, source, reason: 'The diagram is unchanged.' }
    : { ok: true, source: next };
}

function failure(source: string, reason: string): MermaidSourceEditResult {
  return { ok: false, source, reason };
}

function indentation(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? '';
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function safeId(value: string): boolean {
  return new RegExp(`^${ID}$`).test(value);
}

function escapedId(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referencesId(line: string, id: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_.-])${escapedId(id)}(?=$|[^A-Za-z0-9_.-])`).test(line);
}

function replaceId(line: string, id: string, replacement: string): string {
  return line.replace(
    new RegExp(`(^|[^A-Za-z0-9_.-])${escapedId(id)}(?=$|[^A-Za-z0-9_.-])`, 'g'),
    (_match, prefix: string) => `${prefix}${replacement}`,
  );
}

function nextId(nodes: readonly MermaidEditableNode[], base: string): string {
  const ids = new Set(nodes.map((node) => node.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

function node(
  id: string,
  label: string,
  line: number,
  extra: Readonly<Record<string, string | number | boolean>> = {},
): MermaidEditableNode {
  return {
    id,
    domId: id,
    label,
    shape: 'rect',
    classes: [],
    origin: { line, ...extra },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  label: string,
  line: number,
  extra: Readonly<Record<string, string | number | boolean>> = {},
): MermaidEditableEdge {
  return { id, source, target, label, origin: { line, ...extra } };
}

function sourceLine(
  item: MermaidEditableNode | MermaidEditableEdge | MermaidEditableText,
): number | null {
  const line = item.origin?.line;
  return typeof line === 'number' ? line : null;
}

function propertyLine(
  lines: readonly string[],
  id: string,
  label: string,
  keyword = id,
  options: Partial<MermaidDiagramProperty> = {},
): MermaidDiagramProperty {
  const match = lines
    .map((line) => new RegExp(`^\\s*${keyword}\\s+(.+?)\\s*$`, 'i').exec(line))
    .find(Boolean);
  return { id, label, value: match ? unquote(match[1]) : '', ...options };
}

function renderedPropertyLine(
  lines: readonly string[],
  id: string,
  label: string,
  keyword = id,
): MermaidDiagramProperty {
  return propertyLine(lines, id, label, keyword, { rendered: true, deletable: true });
}

function directionProperty(lines: readonly string[]): MermaidDiagramProperty {
  const found = propertyLine(lines, 'direction', 'Direction', 'direction', {
    type: 'select',
    options: DIRECTION_OPTIONS,
  });
  return { ...found, value: found.value || 'TB' };
}

function model(
  kind: MermaidSourceEditableModel['kind'],
  nodes: readonly MermaidEditableNode[],
  edges: readonly MermaidEditableEdge[],
  properties: readonly MermaidDiagramProperty[],
  caps: MermaidEditCapabilities,
  nodeNoun = 'Node',
  edgeNoun = 'Connection',
  texts: readonly MermaidEditableText[] = [],
): MermaidSourceEditableModel {
  const rawDirection = properties.find((property) => property.id === 'direction')?.value;
  const direction = DIRECTIONS.includes(rawDirection as MermaidFlowchartDirection)
    ? (rawDirection as MermaidFlowchartDirection)
    : undefined;
  return {
    kind,
    nodes,
    edges,
    properties,
    texts,
    capabilities: caps,
    nodeNoun,
    edgeNoun,
    ...(direction ? { direction } : {}),
  };
}

function sourceText(
  id: string,
  label: string,
  line: number,
  role: string,
  deletable: boolean,
  extra: Readonly<Record<string, string | number | boolean>> = {},
): MermaidEditableText {
  return {
    id,
    label,
    target: 'source',
    targetId: id,
    deletable,
    origin: { line, role, ...extra },
  };
}

function firstHeaderLine(lines: readonly string[]): number {
  return Math.max(
    0,
    lines.findIndex((line) => /\S/.test(line) && !line.trimStart().startsWith('%%')),
  );
}

function insertAfterHeader(source: string, statement: string): MermaidSourceEditResult {
  const lines = linesOf(source);
  lines.splice(firstHeaderLine(lines) + 1, 0, statement);
  return sourceResult(source, lines);
}

function appendStatement(source: string, statement: string): MermaidSourceEditResult {
  const lines = linesOf(source);
  while (lines.length > 1 && !lines[lines.length - 1]?.trim()) lines.pop();
  lines.push(statement);
  return sourceResult(source, lines);
}

function inspectSequence(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes = new Map<string, MermaidEditableNode>();
  const edges: MermaidEditableEdge[] = [];
  const declaration = new RegExp(
    `^\\s*(participant|actor)\\s+(${ID})(?:\\s+as\\s+(.+))?\\s*$`,
    'i',
  );
  const message = new RegExp(`^\\s*(${ID})\\s*([-.=+x)o<(>]+)\\s*(${ID})\\s*:\\s*(.*?)\\s*$`);
  lines.forEach((line, index) => {
    const declared = declaration.exec(line);
    if (declared) {
      nodes.set(
        declared[2],
        node(declared[2], unquote(declared[3] ?? declared[2]), index, { declaration: true }),
      );
      return;
    }
    const sent = message.exec(line);
    if (!sent || (!sent[2].includes('>') && !sent[2].includes('<') && !sent[2].includes(')')))
      return;
    if (!nodes.has(sent[1])) nodes.set(sent[1], node(sent[1], sent[1], index));
    if (!nodes.has(sent[3])) nodes.set(sent[3], node(sent[3], sent[3], index));
    edges.push(edge(`sequence-${index}`, sent[1], sent[3], sent[4], index, { operator: sent[2] }));
  });
  const autoNumber = lines.some((line) => /^\s*autonumber\s*$/i.test(line));
  return model(
    'sequence',
    [...nodes.values()],
    edges,
    [{ id: 'autonumber', label: 'Number messages', value: autoNumber, type: 'boolean' }],
    capabilities({ connect: true, disconnect: true, edgeLabel: true }),
    'Participant',
    'Message',
  );
}

function inspectState(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes = new Map<string, MermaidEditableNode>();
  const edges: MermaidEditableEdge[] = [];
  const alias = new RegExp(`^\\s*state\\s+"([^"]+)"\\s+as\\s+(${ID})\\s*$`, 'i');
  const declaration = new RegExp(`^\\s*state\\s+(${ID})(?:\\s+as\\s+"([^"]+)")?\\s*$`, 'i');
  const transition = new RegExp(
    `^\\s*(\\[\\*\\]|${ID})\\s*--?>\\s*(\\[\\*\\]|${ID})(?:\\s*:\\s*(.*?))?\\s*$`,
  );
  lines.forEach((line, index) => {
    const aliased = alias.exec(line);
    if (aliased) {
      nodes.set(
        aliased[2],
        node(aliased[2], aliased[1], index, { declaration: true, aliasFirst: true }),
      );
      return;
    }
    const declared = declaration.exec(line);
    if (declared) {
      nodes.set(
        declared[1],
        node(declared[1], declared[2] ?? declared[1], index, { declaration: true }),
      );
      return;
    }
    const linked = transition.exec(line);
    if (!linked) return;
    for (const id of [linked[1], linked[2]]) {
      if (id !== '[*]' && !nodes.has(id)) nodes.set(id, node(id, id, index));
    }
    edges.push(edge(`state-${index}`, linked[1], linked[2], linked[3] ?? '', index));
  });
  return model(
    'state',
    [...nodes.values()],
    edges,
    [directionProperty(lines)],
    capabilities({ connect: true, disconnect: true, edgeLabel: true, direction: true }),
    'State',
    'Transition',
  );
}

function inspectClass(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes = new Map<string, MermaidEditableNode>();
  const edges: MermaidEditableEdge[] = [];
  const texts: MermaidEditableText[] = [];
  const declaration = new RegExp(`^\\s*class\\s+(${ID})(?:\\["([^"]+)"\\])?(?:\\s*\\{)?\\s*$`, 'i');
  const relation = new RegExp(
    `^\\s*(${ID})(?:\\s+"[^"]+")?\\s+([<|>*o.()\\-]+)\\s+(?:"[^"]+"\\s+)?(${ID})(?:\\s*:\\s*(.*?))?\\s*$`,
  );
  let openClass: string | null = null;
  lines.forEach((line, index) => {
    if (openClass && /^\s*}\s*$/.test(line)) {
      openClass = null;
      return;
    }
    if (openClass && line.trim()) {
      texts.push(sourceText(`class-member-${index}`, line.trim(), index, 'line-content', true));
      return;
    }
    const declared = declaration.exec(line);
    if (declared) {
      nodes.set(
        declared[1],
        node(declared[1], declared[2] ?? declared[1], index, { declaration: true }),
      );
      if (/\{\s*$/.test(line)) openClass = declared[1];
      return;
    }
    const linked = relation.exec(line);
    if (!linked || !/--|\.\./.test(linked[2])) {
      const member = new RegExp(`^\\s*(${ID})\\s*:\\s*(.+?)\\s*$`).exec(line);
      if (member)
        texts.push(sourceText(`class-member-${index}`, member[2], index, 'after-colon', true));
      return;
    }
    for (const id of [linked[1], linked[3]]) {
      if (!nodes.has(id)) nodes.set(id, node(id, id, index));
    }
    edges.push(
      edge(`class-${index}`, linked[1], linked[3], linked[4] ?? '', index, { operator: linked[2] }),
    );
  });
  return model(
    'class',
    [...nodes.values()],
    edges,
    [directionProperty(lines)],
    capabilities({ connect: true, disconnect: true, edgeLabel: true, direction: true }),
    'Class',
    'Relationship',
    texts,
  );
}

function inspectEr(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes = new Map<string, MermaidEditableNode>();
  const edges: MermaidEditableEdge[] = [];
  const texts: MermaidEditableText[] = [];
  const relation = new RegExp(
    `^\\s*(${ID})\\s+([|}{o]+--[|}{o]+)\\s+(${ID})\\s*:\\s*(.*?)\\s*$`,
    'i',
  );
  const block = new RegExp(`^\\s*(${ID})\\s*\\{\\s*$`);
  let openEntity = false;
  lines.forEach((line, index) => {
    if (openEntity && /^\s*}\s*$/.test(line)) {
      openEntity = false;
      return;
    }
    if (openEntity && line.trim()) {
      texts.push(sourceText(`er-attribute-${index}`, line.trim(), index, 'line-content', true));
      return;
    }
    const opened = block.exec(line);
    if (opened && !nodes.has(opened[1])) {
      const close = lines.findIndex(
        (candidate, candidateIndex) => candidateIndex > index && /^\s*}\s*$/.test(candidate),
      );
      nodes.set(
        opened[1],
        node(opened[1], opened[1], index, {
          declaration: true,
          endLine: close >= 0 ? close : index,
        }),
      );
      openEntity = true;
    }
    const linked = relation.exec(line);
    if (!linked) return;
    for (const id of [linked[1], linked[3]]) {
      if (!nodes.has(id)) nodes.set(id, node(id, id, index));
    }
    edges.push(
      edge(`er-${index}`, linked[1], linked[3], linked[4], index, {
        operator: linked[2],
        labelDeletable: false,
      }),
    );
  });
  return model(
    'er',
    [...nodes.values()],
    edges,
    [directionProperty(lines)],
    capabilities({ connect: true, disconnect: true, edgeLabel: true, direction: true }),
    'Entity',
    'Relationship',
    texts,
  );
}

interface MindmapItem {
  node: MermaidEditableNode;
  indent: number;
  prefix: string;
  suffix: string;
}

function mindmapParts(line: string): { label: string; prefix: string; suffix: string } {
  const indent = indentation(line);
  const trimmed = line.trim();
  const explicit = new RegExp(`^(${ID})?([([{]+)(.*?)([)\\]}]+)$`).exec(trimmed);
  if (explicit) {
    return {
      label: explicit[3].trim(),
      prefix: `${indent}${explicit[1] ?? ''}${explicit[2]}`,
      suffix: explicit[4],
    };
  }
  return { label: trimmed, prefix: indent, suffix: '' };
}

function inspectMindmap(lines: readonly string[]): MermaidSourceEditableModel {
  const items: MindmapItem[] = [];
  const edges: MermaidEditableEdge[] = [];
  const stack: MindmapItem[] = [];
  lines.forEach((line, index) => {
    if (index === firstHeaderLine(lines) || !line.trim() || line.trimStart().startsWith('%%'))
      return;
    const parts = mindmapParts(line);
    const item: MindmapItem = {
      node: node(`mindmap-${index}`, parts.label, index, {
        prefix: parts.prefix,
        suffix: parts.suffix,
      }),
      indent: indentation(line).replace(/\t/g, '  ').length,
      prefix: parts.prefix,
      suffix: parts.suffix,
    };
    while (stack.length && stack[stack.length - 1]!.indent >= item.indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) edges.push(edge(`mindmap-edge-${index}`, parent.node.id, item.node.id, '', index));
    stack.push(item);
    items.push(item);
  });
  return model(
    'mindmap',
    items.map((item) => item.node),
    edges,
    [],
    capabilities({ connect: true, disconnect: true, edgeLabel: false, properties: false }),
    'Topic',
    'Parent link',
  );
}

function inspectC4(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes = new Map<string, MermaidEditableNode>();
  const edges: MermaidEditableEdge[] = [];
  const declaration =
    /^\s*(Person(?:_Ext)?|System(?:_Ext)?|Container|Component)\s*\(\s*([^,]+)\s*,\s*"([^"]*)"(.*?)\)\s*$/i;
  const relation = /^\s*(Rel(?:_[A-Z]+)?)\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*"([^"]*)"(.*?)\)\s*$/i;
  lines.forEach((line, index) => {
    const declared = declaration.exec(line);
    if (declared) {
      const id = declared[2].trim();
      nodes.set(id, node(id, declared[3], index, { declaration: declared[1], tail: declared[4] }));
      return;
    }
    const linked = relation.exec(line);
    if (!linked) return;
    edges.push(
      edge(`c4-${index}`, linked[2].trim(), linked[3].trim(), linked[4], index, {
        relation: linked[1],
        tail: linked[5],
      }),
    );
  });
  return model(
    'c4',
    [...nodes.values()],
    edges,
    [renderedPropertyLine(lines, 'title', 'Title')],
    capabilities({ connect: true, disconnect: true, edgeLabel: true }),
    'Element',
    'Relationship',
  );
}

function inspectArchitecture(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes = new Map<string, MermaidEditableNode>();
  const edges: MermaidEditableEdge[] = [];
  const texts: MermaidEditableText[] = [];
  const group = new RegExp(`^\\s*group\\s+(${ID})\\([^)]+\\)\\[([^\\]]+)\\]\\s*$`, 'i');
  const declaration = new RegExp(
    `^\\s*service\\s+(${ID})\\(([^)]+)\\)\\[([^\\]]+)\\](?:\\s+in\\s+(${ID}))?\\s*$`,
    'i',
  );
  const relation = new RegExp(
    `^\\s*(${ID})(?::[A-Z])?\\s*(-->|<--|<-->)\\s*(?:[A-Z]:)?(${ID})\\s*$`,
    'i',
  );
  lines.forEach((line, index) => {
    const grouped = group.exec(line);
    if (grouped) {
      texts.push(
        sourceText(`architecture-group-${grouped[1]}`, grouped[2], index, 'bracket-label', false),
      );
      return;
    }
    const declared = declaration.exec(line);
    if (declared) {
      nodes.set(
        declared[1],
        node(declared[1], declared[3], index, { icon: declared[2], group: declared[4] ?? '' }),
      );
      return;
    }
    const linked = relation.exec(line);
    if (linked)
      edges.push(
        edge(`architecture-${index}`, linked[1], linked[3], '', index, { operator: linked[2] }),
      );
  });
  return model(
    'architecture',
    [...nodes.values()],
    edges,
    [],
    capabilities({ connect: true, disconnect: true, properties: false }),
    'Service',
    'Connection',
    texts,
  );
}

const GANTT_FLAGS = new Set(['active', 'done', 'crit', 'milestone']);

function ganttTaskId(parts: readonly string[], line: number): string {
  for (const part of parts) {
    const value = part.trim();
    if (
      GANTT_FLAGS.has(value) ||
      value.startsWith('after ') ||
      /^\d/.test(value) ||
      /^(\d+)(ms|s|m|h|d|w)$/.test(value)
    )
      continue;
    if (safeId(value)) return value;
  }
  return `gantt-task-${line}`;
}

function inspectGantt(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes: MermaidEditableNode[] = [];
  const edges: MermaidEditableEdge[] = [];
  const texts: MermaidEditableText[] = [];
  lines.forEach((line, index) => {
    const section = /^\s*section\s+(.+?)\s*$/i.exec(line);
    if (section) {
      texts.push(sourceText(`gantt-section-${index}`, section[1], index, 'section', true));
      return;
    }
    const match = /^\s*([^:%][^:]*)\s*:\s*(.+?)\s*$/.exec(line);
    if (
      !match ||
      /^(title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker)$/i.test(
        match[1].trim(),
      )
    )
      return;
    const parts = match[2].split(',').map((part) => part.trim());
    const taskId = ganttTaskId(parts, index);
    nodes.push(
      node(taskId, match[1].trim(), index, {
        parts: match[2],
        generatedId: taskId.startsWith('gantt-task-'),
      }),
    );
    const after = parts.find((part) => part.startsWith('after '));
    for (const dependency of after?.slice(6).trim().split(/\s+/).filter(Boolean) ?? []) {
      edges.push(
        edge(`gantt-${index}-${dependency}`, dependency, taskId, '', index, { dependency }),
      );
    }
  });
  return model(
    'gantt',
    nodes,
    edges,
    [
      renderedPropertyLine(lines, 'title', 'Title'),
      propertyLine(lines, 'dateFormat', 'Date format'),
      propertyLine(lines, 'axisFormat', 'Axis format'),
      propertyLine(lines, 'tickInterval', 'Tick interval'),
      propertyLine(lines, 'excludes', 'Excluded dates'),
      propertyLine(lines, 'todayMarker', 'Today marker'),
    ],
    capabilities({ connect: true, disconnect: true }),
    'Task',
    'Dependency',
    texts,
  );
}

function inspectTimeline(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes: MermaidEditableNode[] = [];
  const texts: MermaidEditableText[] = [];
  lines.forEach((line, index) => {
    if (/^\s*title\b/i.test(line)) return;
    const section = /^\s*section\s+(.+?)\s*$/i.exec(line);
    if (section) {
      texts.push(sourceText(`timeline-section-${index}`, section[1], index, 'section', true));
      return;
    }
    if (/^\s*timeline\b/i.test(line) || !line.includes(':')) return;
    const parts = line.split(':').map((part) => part.trim());
    const period = parts.shift() ?? '';
    if (period) {
      texts.push(sourceText(`timeline-period-${index}`, period, index, 'timeline-period', false));
    }
    parts.forEach((label, segment) => {
      if (label)
        nodes.push(
          node(`timeline-${index}-${segment}`, label, index, {
            segment,
            period,
          }),
        );
    });
  });
  return model(
    'timeline',
    nodes,
    [],
    [renderedPropertyLine(lines, 'title', 'Title')],
    capabilities({
      connectionHint: 'Mermaid timelines use chronological order rather than explicit connections.',
    }),
    'Event',
    'Connection',
    texts,
  );
}

function inspectJourney(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes: MermaidEditableNode[] = [];
  const texts: MermaidEditableText[] = [];
  lines.forEach((line, index) => {
    const section = /^\s*section\s+(.+?)\s*$/i.exec(line);
    if (section) {
      texts.push(sourceText(`journey-section-${index}`, section[1], index, 'section', true));
      return;
    }
    if (/^\s*(journey|title)\b/i.test(line)) return;
    const match = /^\s*(.+?)\s*:\s*(\d+)\s*:\s*(.+?)\s*$/.exec(line);
    if (match)
      nodes.push(node(`journey-${index}`, match[1], index, { score: match[2], actors: match[3] }));
  });
  return model(
    'journey',
    nodes,
    [],
    [renderedPropertyLine(lines, 'title', 'Title')],
    capabilities({
      connectionHint:
        'User Journey tasks are ordered within sections and do not have explicit connections.',
    }),
    'Task',
    'Connection',
    texts,
  );
}

function inspectKanban(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes: MermaidEditableNode[] = [];
  const texts: MermaidEditableText[] = [];
  const item = new RegExp(`^(\\s+)(${ID})\\[([^\\]]*)\\]\\s*$`);
  let columnIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const match = item.exec(line);
    if (match) columnIndent = Math.min(columnIndent, match[1].length);
  }
  lines.forEach((line, index) => {
    const match = item.exec(line);
    if (!match) return;
    if (match[1].length === columnIndent) {
      texts.push(sourceText(`kanban-column-${match[2]}`, match[3], index, 'bracket-label', false));
      return;
    }
    if (match[1].length < columnIndent) return;
    nodes.push(node(match[2], match[3], index, { indent: match[1], columnIndent }));
  });
  return model(
    'kanban',
    nodes,
    [],
    [],
    capabilities({
      properties: false,
      connectionHint:
        'Kanban tasks are contained by columns rather than joined by explicit connections.',
    }),
    'Task',
    'Connection',
    texts,
  );
}

function inspectGit(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes: MermaidEditableNode[] = [];
  const texts: MermaidEditableText[] = [];
  lines.forEach((line, index) => {
    const branch = /^\s*branch\s+([^\s]+)\s*$/i.exec(line);
    if (branch) {
      texts.push(
        sourceText(`git-branch-${branch[1]}`, branch[1], index, 'git-branch', false, {
          branch: branch[1],
        }),
      );
      return;
    }
    if (!/^\s*commit\b/i.test(line)) return;
    const custom = /\bid\s*:\s*"([^"]+)"/i.exec(line);
    const label = custom?.[1] ?? `Commit ${nodes.length + 1}`;
    nodes.push(node(`git-${index}`, label, index, { customId: Boolean(custom) }));
  });
  return model(
    'git',
    nodes,
    [],
    [],
    capabilities({
      properties: false,
      connectionHint:
        'Git Graph connections are derived from branch, checkout, and merge commands.',
    }),
    'Commit',
    'Connection',
    texts,
  );
}

function inspectPie(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes: MermaidEditableNode[] = [];
  lines.forEach((line, index) => {
    const match = /^\s*"([^"]+)"\s*:\s*(-?\d+(?:\.\d+)?)\s*$/.exec(line);
    if (match) nodes.push(node(`pie-${index}`, match[1], index, { value: match[2] }));
  });
  return model(
    'pie',
    nodes,
    [],
    [
      renderedPropertyLine(lines, 'title', 'Title'),
      {
        id: 'showData',
        label: 'Show values',
        value: /\bshowData\b/i.test(lines[firstHeaderLine(lines)] ?? ''),
        type: 'boolean',
      },
    ],
    capabilities({
      connectionHint: 'Pie slices are values, so Mermaid does not define connections between them.',
    }),
    'Slice',
    'Connection',
  );
}

function inspectQuadrant(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes: MermaidEditableNode[] = [];
  const texts: MermaidEditableText[] = [];
  lines.forEach((line, index) => {
    const axis = /^\s*(x-axis|y-axis)\s+(.+?)\s*-->\s*(.+?)\s*$/i.exec(line);
    if (axis) {
      texts.push(
        sourceText(`quadrant-${axis[1]}-start`, unquote(axis[2]), index, 'axis-endpoint', false, {
          side: 'start',
        }),
        sourceText(`quadrant-${axis[1]}-end`, unquote(axis[3]), index, 'axis-endpoint', false, {
          side: 'end',
        }),
      );
      return;
    }
    const match = /^\s*"?([^":]+?)"?\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*]\s*$/.exec(line);
    if (match) nodes.push(node(`quadrant-${index}`, match[1], index, { x: match[2], y: match[3] }));
  });
  return model(
    'quadrant',
    nodes,
    [],
    [
      renderedPropertyLine(lines, 'title', 'Title'),
      propertyLine(lines, 'xAxis', 'X axis', 'x-axis'),
      propertyLine(lines, 'yAxis', 'Y axis', 'y-axis'),
      ...[1, 2, 3, 4].map((number) =>
        propertyLine(lines, `quadrant${number}`, `Quadrant ${number}`, `quadrant-${number}`, {
          rendered: true,
          deletable: true,
        }),
      ),
    ],
    capabilities({
      connectionHint: 'Quadrant points are positioned values and do not have explicit connections.',
    }),
    'Point',
    'Connection',
    texts,
  );
}

function parseCsvRow(line: string): string[] | null {
  if (!line.includes(',') || line.trimStart().startsWith('%%')) return null;
  const values = line.split(',').map((value) => unquote(value));
  return values.length === 3 && values.every(Boolean) ? values : null;
}

function inspectSankey(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes = new Map<string, MermaidEditableNode>();
  const edges: MermaidEditableEdge[] = [];
  lines.forEach((line, index) => {
    const row = parseCsvRow(line);
    if (!row || !Number.isFinite(Number(row[2]))) return;
    if (!nodes.has(row[0])) nodes.set(row[0], node(row[0], row[0], index));
    if (!nodes.has(row[1])) nodes.set(row[1], node(row[1], row[1], index));
    edges.push(edge(`sankey-${index}`, row[0], row[1], row[2], index, { labelDeletable: false }));
  });
  return model(
    'sankey',
    [...nodes.values()],
    edges,
    [],
    capabilities({
      addNode: false,
      duplicateNode: false,
      connect: true,
      disconnect: true,
      edgeLabel: true,
      properties: false,
    }),
    'Flow node',
    'Flow',
  );
}

function inspectXy(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes: MermaidEditableNode[] = [];
  const texts: MermaidEditableText[] = [];
  lines.forEach((line, index) => {
    const xAxis = /^\s*x-axis\s+(?:"([^"]+)"\s+)?\[([^\]]*)]\s*$/i.exec(line);
    if (xAxis) {
      if (xAxis[1])
        texts.push(sourceText('xy-x-axis-title', xAxis[1], index, 'quoted-label', false));
      xAxis[2]
        .split(',')
        .map((value) => unquote(value))
        .filter(Boolean)
        .forEach((label, itemIndex) =>
          texts.push(
            sourceText(`xy-x-axis-${itemIndex}`, label, index, 'xy-category', false, {
              itemIndex,
            }),
          ),
        );
      return;
    }
    const yAxis = /^\s*y-axis\s+"([^"]+)"/i.exec(line);
    if (yAxis) {
      texts.push(sourceText('xy-y-axis-title', yAxis[1], index, 'quoted-label', false));
      return;
    }
    const match = /^\s*(bar|line)\s+(\[[^\]]*])\s*$/i.exec(line);
    if (match)
      nodes.push(
        node(
          `xy-${index}`,
          `${match[1][0].toUpperCase()}${match[1].slice(1)} ${nodes.length + 1}`,
          index,
          { series: match[1].toLowerCase(), values: match[2] },
        ),
      );
  });
  return model(
    'xy',
    nodes,
    [],
    [
      renderedPropertyLine(lines, 'title', 'Title'),
      propertyLine(lines, 'xAxis', 'X axis', 'x-axis'),
      propertyLine(lines, 'yAxis', 'Y axis', 'y-axis'),
    ],
    capabilities({
      renameNode: false,
      connectionHint: 'XY series share chart axes and do not have explicit connections.',
    }),
    'Series',
    'Connection',
    texts,
  );
}

function inspectRequirement(lines: readonly string[]): MermaidSourceEditableModel {
  const nodes = new Map<string, MermaidEditableNode>();
  const edges: MermaidEditableEdge[] = [];
  const declaration = new RegExp(
    `^\\s*(requirement|functionalRequirement|interfaceRequirement|performanceRequirement|physicalRequirement|designConstraint|element)\\s+(${ID})\\s*\\{\\s*$`,
    'i',
  );
  const relation = new RegExp(
    `^\\s*(${ID})\\s+-\\s*(contains|copies|derives|satisfies|verifies|refines|traces)\\s+->\\s+(${ID})\\s*$`,
    'i',
  );
  lines.forEach((line, index) => {
    const opened = declaration.exec(line);
    if (opened) {
      const endLine = lines.findIndex(
        (candidate, candidateIndex) => candidateIndex > index && /^\s*}\s*$/.test(candidate),
      );
      const textLine = lines
        .slice(index + 1, endLine >= 0 ? endLine : index + 1)
        .find((candidate) => /^\s*text\s*:/.test(candidate));
      const label = textLine ? textLine.replace(/^\s*text\s*:\s*/, '').trim() : opened[2];
      nodes.set(
        opened[2],
        node(opened[2], label, index, {
          declaration: opened[1],
          endLine: endLine >= 0 ? endLine : index,
        }),
      );
      return;
    }
    const linked = relation.exec(line);
    if (linked)
      edges.push(
        edge(`requirement-${index}`, linked[1], linked[3], linked[2], index, {
          labelDeletable: false,
        }),
      );
  });
  return model(
    'requirement',
    [...nodes.values()],
    edges,
    [],
    capabilities({ connect: true, disconnect: true, edgeLabel: true, properties: false }),
    'Requirement',
    'Relationship',
  );
}

/** Inspect the editable ordinary-statement subset of every gallery grammar. */
export function inspectMermaidSourceAdapter(source: string): MermaidSourceEditableModel | null {
  const lines = linesOf(source);
  const header = lines[firstHeaderLine(lines)]?.trim() ?? '';
  if (/^sequenceDiagram\b/i.test(header)) return inspectSequence(lines);
  if (/^stateDiagram(?:-v2)?\b/i.test(header)) return inspectState(lines);
  if (/^classDiagram\b/i.test(header)) return inspectClass(lines);
  if (/^erDiagram\b/i.test(header)) return inspectEr(lines);
  if (/^mindmap\b/i.test(header)) return inspectMindmap(lines);
  if (/^C4(?:Context|Container|Component|Dynamic|Deployment)\b/i.test(header))
    return inspectC4(lines);
  if (/^architecture-beta\b/i.test(header)) return inspectArchitecture(lines);
  if (/^gantt\b/i.test(header)) return inspectGantt(lines);
  if (/^timeline\b/i.test(header)) return inspectTimeline(lines);
  if (/^journey\b/i.test(header)) return inspectJourney(lines);
  if (/^kanban\b/i.test(header)) return inspectKanban(lines);
  if (/^gitGraph\b/i.test(header)) return inspectGit(lines);
  if (/^pie\b/i.test(header)) return inspectPie(lines);
  if (/^quadrantChart\b/i.test(header)) return inspectQuadrant(lines);
  if (/^sankey(?:-beta)?\b/i.test(header)) return inspectSankey(lines);
  if (/^xychart-beta\b/i.test(header)) return inspectXy(lines);
  if (/^requirementDiagram\b/i.test(header)) return inspectRequirement(lines);
  return null;
}

function rewriteNodeLine(
  source: string,
  node: MermaidEditableNode,
  rewrite: (line: string) => string,
): MermaidSourceEditResult {
  const index = sourceLine(node);
  if (index === null) return failure(source, 'This item can only be changed in Source.');
  const lines = linesOf(source);
  if (!lines[index]) return failure(source, 'The diagram changed before this edit was applied.');
  lines[index] = rewrite(lines[index]);
  return sourceResult(source, lines);
}

export function addAdapterNode(
  source: string,
  model: MermaidSourceEditableModel,
): MermaidSourceEditResult & { nodeId?: string } {
  const id = nextId(
    model.nodes,
    model.kind === 'class' ? 'NewClass' : model.kind === 'er' ? 'NEW_ENTITY' : 'node',
  );
  let result: MermaidSourceEditResult;
  switch (model.kind) {
    case 'sequence':
      result = insertAfterHeader(source, `  participant ${id} as New participant`);
      break;
    case 'state':
      result = insertAfterHeader(source, `  state "New state" as ${id}`);
      break;
    case 'class':
      result = insertAfterHeader(source, `  class ${id}["New class"]`);
      break;
    case 'er':
      result = appendStatement(source, `  ${id} {\n    string name\n  }`);
      break;
    case 'mindmap': {
      const root = model.nodes[0];
      if (!root)
        return { ...failure(source, 'A mind map needs a root topic before adding children.') };
      const rootLine = sourceLine(root) ?? 1;
      const lines = linesOf(source);
      lines.splice(rootLine + 1, 0, `${indentation(lines[rootLine])}  New topic`);
      result = sourceResult(source, lines);
      break;
    }
    case 'c4':
      result = appendStatement(source, `  System(${id}, "New system")`);
      break;
    case 'architecture':
      result = appendStatement(source, `  service ${id}(server)[New service]`);
      break;
    case 'gantt':
      result = appendStatement(source, `  New task :${id}, 1d`);
      break;
    case 'timeline':
      result = appendStatement(source, '  New period : New event');
      break;
    case 'journey':
      result = appendStatement(source, '    New task: 3: User');
      break;
    case 'kanban': {
      const first = model.nodes[0];
      if (!first) {
        result = appendStatement(source, `  todo[To do]\n    ${id}[New task]`);
      } else {
        const line = sourceLine(first) ?? 1;
        const lines = linesOf(source);
        lines.splice(line, 0, `${String(first.origin?.indent ?? '    ')}${id}[New task]`);
        result = sourceResult(source, lines);
      }
      break;
    }
    case 'git':
      result = appendStatement(source, `  commit id: "New commit ${model.nodes.length + 1}"`);
      break;
    case 'pie':
      result = appendStatement(source, '  "New slice" : 1');
      break;
    case 'quadrant':
      result = appendStatement(source, '  "New point": [0.50, 0.50]');
      break;
    case 'xy':
      result = appendStatement(source, '  line [0]');
      break;
    case 'requirement':
      result = appendStatement(
        source,
        `  requirement ${id} {\n    id: ${model.nodes.length + 1}\n    text: New requirement\n    risk: medium\n    verifymethod: test\n  }`,
      );
      break;
    case 'sankey':
      return {
        ...failure(source, 'Sankey nodes are created by adding a flow between two labels.'),
      };
  }
  return result.ok ? { ...result, nodeId: id } : result;
}

export function renameAdapterNode(
  source: string,
  model: MermaidSourceEditableModel,
  selected: MermaidEditableNode,
  label: string,
): MermaidSourceEditResult {
  const next = label.trim();
  if (!next) return failure(source, `${model.nodeNoun} labels cannot be empty.`);
  if (next === selected.label) return failure(source, 'The label is unchanged.');
  switch (model.kind) {
    case 'sequence':
      if (selected.origin?.declaration) {
        return rewriteNodeLine(
          source,
          selected,
          (line) => `${indentation(line)}participant ${selected.id} as ${next}`,
        );
      }
      return insertAfterHeader(source, `  participant ${selected.id} as ${next}`);
    case 'state':
      if (selected.origin?.declaration)
        return rewriteNodeLine(
          source,
          selected,
          (line) => `${indentation(line)}state "${next.replace(/"/g, "'")}" as ${selected.id}`,
        );
      return insertAfterHeader(source, `  state "${next.replace(/"/g, "'")}" as ${selected.id}`);
    case 'class':
      if (selected.origin?.declaration)
        return rewriteNodeLine(
          source,
          selected,
          (line) =>
            `${indentation(line)}class ${selected.id}["${next.replace(/"/g, "'")}"]${/\{\s*$/.test(line) ? ' {' : ''}`,
        );
      return insertAfterHeader(source, `  class ${selected.id}["${next.replace(/"/g, "'")}"]`);
    case 'er': {
      if (!safeId(next))
        return failure(
          source,
          'Entity names must be Mermaid identifiers (letters, numbers, underscores, dots, or dashes).',
        );
      return sourceResult(
        source,
        linesOf(source).map((line) => replaceId(line, selected.id, next)),
      );
    }
    case 'mindmap':
      return rewriteNodeLine(
        source,
        selected,
        () =>
          `${String(selected.origin?.prefix ?? '')}${next}${String(selected.origin?.suffix ?? '')}`,
      );
    case 'c4':
      return rewriteNodeLine(source, selected, (line) =>
        line.replace(/(\(\s*[^,]+\s*,\s*)"[^"]*"/, `$1"${next.replace(/"/g, "'")}"`),
      );
    case 'architecture':
    case 'kanban':
      return rewriteNodeLine(source, selected, (line) =>
        line.replace(/\[[^\]]*]/, `[${next.replace(/]/g, '')}]`),
      );
    case 'gantt':
      return rewriteNodeLine(source, selected, (line) => {
        const colon = line.indexOf(':');
        return `${indentation(line)}${next.replace(/:/g, ' -')} ${line.slice(colon)}`;
      });
    case 'timeline': {
      const timelineRole = selected.origin?.timelineRole;
      if (timelineRole === 'title') {
        return rewriteNodeLine(
          source,
          selected,
          (line) => `${indentation(line)}title ${next.replace(/\r?\n/g, ' ')}`,
        );
      }
      if (timelineRole === 'period') {
        return rewriteNodeLine(source, selected, (line) => {
          const colon = line.indexOf(':');
          if (colon < 0) return line;
          return `${indentation(line)}${next.replace(/:/g, ' -')} ${line.slice(colon)}`;
        });
      }
      const segment = Number(selected.origin?.segment ?? 0);
      return rewriteNodeLine(source, selected, (line) => {
        const parts = line.split(':');
        if (parts[segment + 1] !== undefined) parts[segment + 1] = ` ${next.replace(/:/g, ' -')} `;
        return parts.join(':').replace(/\s+$/, '');
      });
    }
    case 'journey':
      return rewriteNodeLine(source, selected, (line) =>
        line.replace(/^(\s*)[^:]+(?=\s*:)/, `$1${next.replace(/:/g, ' -')}`),
      );
    case 'git':
      return rewriteNodeLine(source, selected, (line) => {
        const safe = next.replace(/"/g, "'");
        return /\bid\s*:/i.test(line)
          ? line.replace(/\bid\s*:\s*"[^"]*"/i, `id: "${safe}"`)
          : `${line.trimEnd()} id: "${safe}"`;
      });
    case 'pie':
      return rewriteNodeLine(source, selected, (line) =>
        line.replace(/"[^"]+"/, `"${next.replace(/"/g, "'")}"`),
      );
    case 'quadrant':
      return rewriteNodeLine(source, selected, (line) =>
        line.replace(/^(\s*)"?[^":]+?"?(?=\s*:)/, `$1"${next.replace(/"/g, "'")}"`),
      );
    case 'sankey': {
      const lines = linesOf(source).map((line) => {
        const row = parseCsvRow(line);
        if (!row) return line;
        if (row[0] === selected.id) row[0] = next;
        if (row[1] === selected.id) row[1] = next;
        return `${row[0]},${row[1]},${row[2]}`;
      });
      return sourceResult(source, lines);
    }
    case 'xy':
      return failure(
        source,
        'Mermaid XY series do not have authored labels; edit the chart title and axes in Properties.',
      );
    case 'requirement': {
      const index = sourceLine(selected);
      const end = Number(selected.origin?.endLine ?? index ?? -1);
      if (index === null || end < index)
        return failure(source, 'This requirement can only be changed in Source.');
      const lines = linesOf(source);
      const textIndex = lines.findIndex(
        (line, lineIndex) => lineIndex > index && lineIndex < end && /^\s*text\s*:/.test(line),
      );
      if (textIndex >= 0) lines[textIndex] = `${indentation(lines[textIndex])}text: ${next}`;
      else lines.splice(index + 1, 0, `${indentation(lines[index])}  text: ${next}`);
      return sourceResult(source, lines);
    }
  }
}

export function duplicateAdapterNode(
  source: string,
  model: MermaidSourceEditableModel,
  selected: MermaidEditableNode,
): MermaidSourceEditResult & { nodeId?: string } {
  if (model.kind === 'sankey')
    return failure(source, 'Duplicate a Sankey flow instead of an implicit flow node.');
  const index = sourceLine(selected);
  if (index === null)
    return failure(
      source,
      `This ${model.nodeNoun.toLowerCase()} can only be duplicated in Source.`,
    );
  const lines = linesOf(source);
  const id = nextId(model.nodes, safeId(selected.id) ? `${selected.id}_copy` : 'node');
  let duplicate = lines[index];
  let insertIndex = index + 1;
  switch (model.kind) {
    case 'sequence':
      duplicate = `  participant ${id} as ${selected.label} copy`;
      break;
    case 'state':
      duplicate = `  state "${selected.label.replace(/"/g, "'")} copy" as ${id}`;
      break;
    case 'class':
      duplicate = `  class ${id}["${selected.label.replace(/"/g, "'")} copy"]`;
      break;
    case 'er':
      duplicate = `  ${id} {\n    string name\n  }`;
      insertIndex = Number(selected.origin?.endLine ?? index) + 1;
      break;
    case 'mindmap':
      duplicate = `${String(selected.origin?.prefix ?? '')}${selected.label} copy${String(selected.origin?.suffix ?? '')}`;
      break;
    case 'c4':
    case 'architecture':
    case 'kanban':
      duplicate = replaceId(duplicate, selected.id, id).replace(
        selected.label,
        `${selected.label} copy`,
      );
      break;
    case 'gantt': {
      const parts = String(selected.origin?.parts ?? '1d');
      const nextParts = selected.origin?.generatedId
        ? `${id}, ${parts}`
        : replaceId(parts, selected.id, id);
      duplicate = `${indentation(duplicate)}${selected.label} copy :${nextParts}`;
      break;
    }
    case 'timeline':
      duplicate = `${String(selected.origin?.period ?? 'New period')} : ${selected.label} copy`;
      break;
    case 'journey':
      duplicate = `${indentation(duplicate)}${selected.label} copy: ${String(selected.origin?.score ?? '3')}: ${String(selected.origin?.actors ?? 'User')}`;
      break;
    case 'git':
      duplicate = `  commit id: "${selected.label.replace(/"/g, "'")} copy"`;
      break;
    case 'pie':
      duplicate = `  "${selected.label.replace(/"/g, "'")} copy" : ${String(selected.origin?.value ?? '1')}`;
      break;
    case 'quadrant':
      duplicate = `  "${selected.label.replace(/"/g, "'")} copy": [${String(selected.origin?.x ?? '0.5')}, ${String(selected.origin?.y ?? '0.5')}]`;
      break;
    case 'xy':
      duplicate = `${indentation(duplicate)}${String(selected.origin?.series ?? 'line')} ${String(selected.origin?.values ?? '[0]')}`;
      break;
    case 'requirement':
      duplicate = `  ${String(selected.origin?.declaration ?? 'requirement')} ${id} {\n    ${selected.origin?.declaration === 'element' ? 'type: system' : `id: ${model.nodes.length + 1}\n    text: ${selected.label} copy\n    risk: medium\n    verifymethod: test`}\n  }`;
      insertIndex = Number(selected.origin?.endLine ?? index) + 1;
      break;
  }
  lines.splice(insertIndex, 0, duplicate);
  const result = sourceResult(source, lines);
  return result.ok ? { ...result, nodeId: id } : result;
}

export function deleteAdapterNode(
  source: string,
  model: MermaidSourceEditableModel,
  selected: MermaidEditableNode,
): MermaidSourceEditResult {
  const index = sourceLine(selected);
  if (index === null)
    return failure(source, `This ${model.nodeNoun.toLowerCase()} can only be deleted in Source.`);
  const lines = linesOf(source);
  if (model.kind === 'mindmap') {
    const baseIndent = indentation(lines[index]).length;
    let end = index + 1;
    while (
      end < lines.length &&
      (!lines[end].trim() || indentation(lines[end]).length > baseIndent)
    )
      end += 1;
    lines.splice(index, end - index);
    return sourceResult(source, lines);
  }
  if (model.kind === 'timeline') {
    const parts = lines[index].split(':');
    const segment = Number(selected.origin?.segment ?? 0);
    if (parts[segment + 1] === undefined)
      return failure(source, 'This timeline event can only be deleted in Source.');
    parts.splice(segment + 1, 1);
    if (parts.length <= 1) lines.splice(index, 1);
    else
      lines[index] = parts
        .map((part) => part.trim())
        .join(' : ')
        .trimEnd();
    return sourceResult(source, lines);
  }
  if (model.kind === 'requirement' || model.kind === 'er') {
    const end = Number(selected.origin?.endLine ?? index);
    lines.splice(index, Math.max(1, end - index + 1));
  } else {
    lines.splice(index, 1);
  }
  if (
    ['sequence', 'state', 'class', 'er', 'c4', 'architecture', 'requirement'].includes(model.kind)
  ) {
    return sourceResult(
      source,
      lines.filter((line) => !referencesId(line, selected.id)),
    );
  }
  if (model.kind === 'gantt') {
    return sourceResult(
      source,
      lines.map((line) =>
        line.replace(
          new RegExp(`after\\s+([^,]*\\b)?${escapedId(selected.id)}\\b\\s*`, 'g'),
          (_match, before: string = '') => (before ? `after ${before.trim()} ` : ''),
        ),
      ),
    );
  }
  if (model.kind === 'sankey') {
    return sourceResult(
      source,
      lines.filter((line) => {
        const row = parseCsvRow(line);
        return !row || (row[0] !== selected.id && row[1] !== selected.id);
      }),
    );
  }
  return sourceResult(source, lines);
}

function mindmapReparent(
  source: string,
  model: MermaidSourceEditableModel,
  parentId: string | null,
  targetId: string,
): MermaidSourceEditResult {
  const parent = parentId ? model.nodes.find((node) => node.id === parentId) : model.nodes[0];
  const target = model.nodes.find((node) => node.id === targetId);
  if (!parent || !target || parent.id === target.id)
    return failure(source, 'Choose two different mind-map topics.');
  const lines = linesOf(source);
  const parentLine = sourceLine(parent);
  const targetLine = sourceLine(target);
  if (parentLine === null || targetLine === null)
    return failure(source, 'This hierarchy can only be changed in Source.');
  const targetIndent = indentation(lines[targetLine]).length;
  let targetEnd = targetLine + 1;
  while (targetEnd < lines.length && indentation(lines[targetEnd]).length > targetIndent)
    targetEnd += 1;
  if (parentLine >= targetLine && parentLine < targetEnd)
    return failure(source, 'A topic cannot become a child of its own descendant.');
  const chunk = lines.splice(targetLine, targetEnd - targetLine);
  const adjustedParentLine = parentLine > targetLine ? parentLine - chunk.length : parentLine;
  const parentIndent = indentation(lines[adjustedParentLine]).length;
  let insertAt = adjustedParentLine + 1;
  while (insertAt < lines.length && indentation(lines[insertAt]).length > parentIndent)
    insertAt += 1;
  const delta = parentIndent + 2 - targetIndent;
  const shifted = chunk.map(
    (line) => `${' '.repeat(Math.max(0, indentation(line).length + delta))}${line.trimStart()}`,
  );
  lines.splice(insertAt, 0, ...shifted);
  return sourceResult(source, lines);
}

export function connectAdapterNodes(
  source: string,
  model: MermaidSourceEditableModel,
  sourceId: string,
  targetId: string,
): MermaidSourceEditResult {
  if (sourceId === targetId) return failure(source, 'Choose two different items.');
  if (model.edges.some((item) => item.source === sourceId && item.target === targetId))
    return failure(source, 'Those items are already connected.');
  switch (model.kind) {
    case 'sequence':
      return appendStatement(source, `  ${sourceId}->>${targetId}: New message`);
    case 'state':
      return appendStatement(source, `  ${sourceId} --> ${targetId} : transition`);
    case 'class':
      return appendStatement(source, `  ${sourceId} --> ${targetId} : relationship`);
    case 'er':
      return appendStatement(source, `  ${sourceId} ||--o{ ${targetId} : relates_to`);
    case 'mindmap':
      return mindmapReparent(source, model, sourceId, targetId);
    case 'c4':
      return appendStatement(source, `  Rel(${sourceId}, ${targetId}, "Uses")`);
    case 'architecture':
      return appendStatement(source, `  ${sourceId}:R --> L:${targetId}`);
    case 'gantt': {
      const sourceNode = model.nodes.find((item) => item.id === sourceId);
      const target = model.nodes.find((item) => item.id === targetId);
      if (!sourceNode || !target) return failure(source, 'One of the tasks no longer exists.');
      const lines = linesOf(source);
      let dependencyId = sourceId;
      if (sourceNode.origin?.generatedId) {
        dependencyId = nextId(model.nodes, 'task');
        const sourceIndex = sourceLine(sourceNode);
        if (sourceIndex === null)
          return failure(source, 'The source task can only be connected in Source.');
        const sourceLineText = lines[sourceIndex];
        const colon = sourceLineText.indexOf(':');
        const prefix = sourceLineText.slice(0, colon + 1);
        const sourceParts = sourceLineText
          .slice(colon + 1)
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
        const idIndex = sourceParts.findIndex((part) => !GANTT_FLAGS.has(part));
        sourceParts.splice(Math.max(0, idIndex), 0, dependencyId);
        lines[sourceIndex] = `${prefix}${sourceParts.join(', ')}`;
      }
      const targetIndex = sourceLine(target);
      if (targetIndex === null)
        return failure(source, 'The target task can only be connected in Source.');
      lines[targetIndex] = ((line: string) => {
        const colon = line.indexOf(':');
        const prefix = line.slice(0, colon + 1);
        const parts = line
          .slice(colon + 1)
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
        const afterIndex = parts.findIndex((part) => part.startsWith('after '));
        if (afterIndex >= 0) parts[afterIndex] = `${parts[afterIndex]} ${dependencyId}`;
        else {
          const duration = parts[parts.length - 1] ?? '1d';
          const flagsAndId = parts.slice(0, -1).filter((part) => !/^\d{4}-\d{2}-\d{2}/.test(part));
          parts.splice(0, parts.length, ...flagsAndId, `after ${dependencyId}`, duration);
        }
        return `${prefix}${parts.join(', ')}`;
      })(lines[targetIndex]);
      return sourceResult(source, lines);
    }
    case 'sankey': {
      const sourceNode = model.nodes.find((item) => item.id === sourceId);
      const targetNode = model.nodes.find((item) => item.id === targetId);
      if (!sourceNode || !targetNode)
        return failure(source, 'The Sankey endpoints no longer exist.');
      return appendStatement(source, `${sourceNode.label},${targetNode.label},1`);
    }
    case 'requirement':
      return appendStatement(source, `  ${sourceId} - satisfies -> ${targetId}`);
    default:
      return failure(
        source,
        model.capabilities.connectionHint ??
          `Mermaid ${model.kind} diagrams do not define explicit connections.`,
      );
  }
}

export function disconnectAdapterEdge(
  source: string,
  model: MermaidSourceEditableModel,
  selected: MermaidEditableEdge,
): MermaidSourceEditResult {
  if (model.kind === 'mindmap') return mindmapReparent(source, model, null, selected.target);
  if (model.kind === 'gantt') {
    const target = model.nodes.find((item) => item.id === selected.target);
    if (!target) return failure(source, 'The dependent task no longer exists.');
    return rewriteNodeLine(source, target, (line) => {
      const pattern = new RegExp(`(after\\s+)([^,]*)`);
      return line
        .replace(pattern, (_match, prefix: string, ids: string) => {
          const remaining = ids.split(/\s+/).filter((id) => id && id !== selected.source);
          return remaining.length ? `${prefix}${remaining.join(' ')}` : '';
        })
        .replace(/,\s*,/g, ',')
        .replace(/:\s*,/, ':');
    });
  }
  const index = sourceLine(selected);
  if (index === null)
    return failure(source, `This ${model.edgeNoun.toLowerCase()} can only be removed in Source.`);
  const lines = linesOf(source);
  lines.splice(index, 1);
  return sourceResult(source, lines);
}

export function setAdapterEdgeLabel(
  source: string,
  model: MermaidSourceEditableModel,
  selected: MermaidEditableEdge,
  label: string,
): MermaidSourceEditResult {
  const next = label.trim();
  const index = sourceLine(selected);
  if (index === null)
    return failure(source, `This ${model.edgeNoun.toLowerCase()} can only be labeled in Source.`);
  const lines = linesOf(source);
  const line = lines[index];
  switch (model.kind) {
    case 'sequence':
    case 'state':
    case 'class':
    case 'er':
      lines[index] = line.replace(/(?:\s*:\s*.*)?$/, next ? ` : ${next.replace(/:/g, ' -')}` : '');
      break;
    case 'c4':
      lines[index] = line.replace(
        /(Rel(?:_[A-Z]+)?\s*\(\s*[^,]+\s*,\s*[^,]+\s*,\s*)"[^"]*"/i,
        `$1"${next.replace(/"/g, "'")}"`,
      );
      break;
    case 'sankey': {
      if (!Number.isFinite(Number(next)) || Number(next) < 0)
        return failure(source, 'A Sankey flow weight must be a non-negative number.');
      const row = parseCsvRow(line);
      if (!row) return failure(source, 'This Sankey row can only be edited in Source.');
      lines[index] = `${row[0]},${row[1]},${next}`;
      break;
    }
    case 'requirement': {
      const allowed = [
        'contains',
        'copies',
        'derives',
        'satisfies',
        'verifies',
        'refines',
        'traces',
      ];
      if (!allowed.includes(next))
        return failure(source, `Requirement relationships must be one of: ${allowed.join(', ')}.`);
      lines[index] = line.replace(/-\s*\w+\s+->/, `- ${next} ->`);
      break;
    }
    default:
      return failure(
        source,
        `Mermaid ${model.kind} ${model.edgeNoun.toLowerCase()} labels are not part of this grammar.`,
      );
  }
  return sourceResult(source, lines);
}

export function setAdapterProperty(
  source: string,
  model: MermaidSourceEditableModel,
  propertyId: string,
  value: string | boolean,
): MermaidSourceEditResult {
  const lines = linesOf(source);
  const headerIndex = firstHeaderLine(lines);
  if (propertyId === 'showData' && model.kind === 'pie') {
    lines[headerIndex] = lines[headerIndex].replace(/\s+showData\b/i, '');
    if (value === true) lines[headerIndex] = `${lines[headerIndex].trimEnd()} showData`;
    return sourceResult(source, lines);
  }
  if (propertyId === 'autonumber' && model.kind === 'sequence') {
    const index = lines.findIndex((line) => /^\s*autonumber\s*$/i.test(line));
    if (value === true && index < 0) lines.splice(headerIndex + 1, 0, '  autonumber');
    if (value === false && index >= 0) lines.splice(index, 1);
    return sourceResult(source, lines);
  }
  const keyword: Record<string, string> = {
    xAxis: 'x-axis',
    yAxis: 'y-axis',
    quadrant1: 'quadrant-1',
    quadrant2: 'quadrant-2',
    quadrant3: 'quadrant-3',
    quadrant4: 'quadrant-4',
  };
  const sourceKeyword = keyword[propertyId] ?? propertyId;
  const matcher = new RegExp(`^\\s*${sourceKeyword}\\b`, 'i');
  const existing = lines.findIndex((line) => matcher.test(line));
  const text = String(value).trim();
  if (!text) {
    if (existing >= 0) lines.splice(existing, 1);
    return sourceResult(source, lines);
  }
  if (propertyId === 'direction' && !DIRECTIONS.includes(text as MermaidFlowchartDirection)) {
    return failure(source, 'Choose a supported diagram direction.');
  }
  const rendered =
    model.kind === 'xy' && propertyId === 'title'
      ? `  title "${text.replace(/"/g, "'")}"`
      : `  ${sourceKeyword} ${text}`;
  if (existing >= 0) lines[existing] = `${indentation(lines[existing])}${rendered.trimStart()}`;
  else lines.splice(headerIndex + 1, 0, rendered);
  return sourceResult(source, lines);
}

/** Update any authored text item exposed by a source adapter. */
export function renameAdapterText(
  source: string,
  model: MermaidSourceEditableModel,
  selected: MermaidEditableText,
  label: string,
): MermaidSourceEditResult {
  const next = label.trim();
  if (!next) return failure(source, 'A Mermaid text label cannot be empty.');
  if (next === selected.label) return failure(source, 'The label is unchanged.');

  if (selected.target === 'node') {
    const target = model.nodes.find((node) => node.id === selected.targetId);
    return target
      ? renameAdapterNode(source, model, target, next)
      : failure(source, 'The selected Mermaid node no longer exists.');
  }
  if (selected.target === 'edge') {
    const target = model.edges.find((edge) => edge.id === selected.targetId);
    return target
      ? setAdapterEdgeLabel(source, model, target, next)
      : failure(source, 'The selected Mermaid connection no longer exists.');
  }
  if (selected.target === 'property') {
    return setAdapterProperty(source, model, selected.targetId, next);
  }

  const index = sourceLine(selected);
  if (index === null) return failure(source, 'This label can only be changed in Source.');
  const lines = linesOf(source);
  const line = lines[index];
  switch (selected.origin?.role) {
    case 'section':
      lines[index] = `${indentation(line)}section ${next.replace(/\r?\n/g, ' ')}`;
      break;
    case 'bracket-label':
      lines[index] = line.replace(/\[[^\]]*]/, `[${next.replace(/]/g, '')}]`);
      break;
    case 'line-content':
      lines[index] = `${indentation(line)}${next.replace(/\r?\n/g, ' ')}`;
      break;
    case 'after-colon': {
      const colon = line.indexOf(':');
      if (colon < 0) return failure(source, 'This label can only be changed in Source.');
      lines[index] = `${line.slice(0, colon + 1)} ${next.replace(/\r?\n/g, ' ')}`;
      break;
    }
    case 'timeline-period': {
      const colon = line.indexOf(':');
      if (colon < 0) return failure(source, 'This timeline period can only be changed in Source.');
      lines[index] = `${indentation(line)}${next.replace(/:/g, ' -')} ${line.slice(colon)}`;
      break;
    }
    case 'git-branch': {
      if (!safeId(next)) return failure(source, 'Choose a Mermaid-safe branch name.');
      const previous = String(selected.origin?.branch ?? selected.label);
      return sourceResult(
        source,
        lines.map((candidate) =>
          /^\s*(branch|checkout|merge)\b/i.test(candidate)
            ? replaceId(candidate, previous, next)
            : candidate,
        ),
      );
    }
    case 'axis-endpoint': {
      const match = /^(\s*(?:x-axis|y-axis)\s+)(.+?)(\s*-->\s*)(.+?)\s*$/i.exec(line);
      if (!match) return failure(source, 'This axis label can only be changed in Source.');
      lines[index] =
        selected.origin?.side === 'start'
          ? `${match[1]}${next}${match[3]}${match[4]}`
          : `${match[1]}${match[2]}${match[3]}${next}`;
      break;
    }
    case 'quoted-label':
      if (!/"[^"]*"/.test(line))
        return failure(source, 'This label can only be changed in Source.');
      lines[index] = line.replace(/"[^"]*"/, `"${next.replace(/"/g, "'")}"`);
      break;
    case 'xy-category': {
      const match = /^(.*\[)([^\]]*)(].*)$/.exec(line);
      if (!match) return failure(source, 'This category can only be changed in Source.');
      const values = match[2].split(',').map((value) => value.trim());
      const itemIndex = Number(selected.origin?.itemIndex ?? -1);
      if (itemIndex < 0 || itemIndex >= values.length)
        return failure(source, 'This category can only be changed in Source.');
      values[itemIndex] = next.replace(/[,\]]/g, ' ');
      lines[index] = `${match[1]}${values.join(', ')}${match[3]}`;
      break;
    }
    default:
      return failure(source, 'This label can only be changed in Source.');
  }
  return sourceResult(source, lines);
}

/** Remove an authored text label only when its source construct permits it safely. */
export function deleteAdapterText(
  source: string,
  model: MermaidSourceEditableModel,
  selected: MermaidEditableText,
): MermaidSourceEditResult {
  if (!selected.deletable) {
    return failure(source, 'This label is required by its Mermaid source construct.');
  }
  if (selected.target === 'node') {
    const target = model.nodes.find((node) => node.id === selected.targetId);
    return target
      ? deleteAdapterNode(source, model, target)
      : failure(source, 'The selected Mermaid node no longer exists.');
  }
  if (selected.target === 'edge') {
    const target = model.edges.find((edge) => edge.id === selected.targetId);
    return target
      ? setAdapterEdgeLabel(source, model, target, '')
      : failure(source, 'The selected Mermaid connection no longer exists.');
  }
  if (selected.target === 'property') {
    return setAdapterProperty(source, model, selected.targetId, '');
  }
  const index = sourceLine(selected);
  if (index === null) return failure(source, 'This label can only be removed in Source.');
  const lines = linesOf(source);
  lines.splice(index, 1);
  return sourceResult(source, lines);
}
