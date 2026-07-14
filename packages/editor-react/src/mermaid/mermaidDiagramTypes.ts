/** Curated starter gallery for the diagram grammars supported by Mermaid 11.16. */

export type MermaidDiagramCategory = 'Structure' | 'Planning' | 'Data';

export type MermaidDiagramPreview =
  | 'flowchart'
  | 'sequence'
  | 'state'
  | 'class'
  | 'er'
  | 'mindmap'
  | 'c4'
  | 'architecture'
  | 'gantt'
  | 'timeline'
  | 'journey'
  | 'kanban'
  | 'git'
  | 'pie'
  | 'quadrant'
  | 'sankey'
  | 'xy'
  | 'requirement';

export interface MermaidDiagramType {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly category: MermaidDiagramCategory;
  readonly preview: MermaidDiagramPreview;
  readonly starter: string;
  /** Mermaid marks this grammar as beta or otherwise experimental. */
  readonly badge?: 'Beta' | 'Experimental';
}

const lines = (...source: string[]) => source.join('\n');

export const MERMAID_DIAGRAM_TYPES: readonly MermaidDiagramType[] = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    description: 'Processes, decisions, and connected shapes.',
    category: 'Structure',
    preview: 'flowchart',
    starter: lines(
      'flowchart LR',
      '  start["Start"] --> decision{"Ready?"}',
      '  decision -->|Yes| done["Done"]',
      '  decision -->|No| start',
    ),
  },
  {
    id: 'sequence',
    label: 'Sequence',
    description: 'Messages exchanged between participants over time.',
    category: 'Structure',
    preview: 'sequence',
    starter: lines(
      'sequenceDiagram',
      '  participant Client',
      '  participant Service',
      '  Client->>Service: Request',
      '  Service-->>Client: Response',
    ),
  },
  {
    id: 'state',
    label: 'State',
    description: 'States, transitions, choices, and lifecycles.',
    category: 'Structure',
    preview: 'state',
    starter: lines(
      'stateDiagram-v2',
      '  [*] --> Idle',
      '  Idle --> Working : start',
      '  Working --> Idle : finish',
      '  Working --> [*] : stop',
    ),
  },
  {
    id: 'class',
    label: 'Class',
    description: 'Classes, members, inheritance, and relationships.',
    category: 'Structure',
    preview: 'class',
    starter: lines(
      'classDiagram',
      '  class Animal {',
      '    +String name',
      '    +speak()',
      '  }',
      '  Animal <|-- Dog',
      '  Dog : +fetch()',
    ),
  },
  {
    id: 'entity-relationship',
    label: 'Entity Relationship',
    description: 'Entities, cardinality, and data relationships.',
    category: 'Structure',
    preview: 'er',
    starter: lines(
      'erDiagram',
      '  CUSTOMER ||--o{ ORDER : places',
      '  ORDER ||--|{ LINE_ITEM : contains',
      '  PRODUCT ||--o{ LINE_ITEM : appears_in',
    ),
  },
  {
    id: 'mindmap',
    label: 'Mind Map',
    description: 'Ideas arranged radially around a central topic.',
    category: 'Structure',
    preview: 'mindmap',
    starter: lines(
      'mindmap',
      '  root((Project))',
      '    Product',
      '      Research',
      '      Design',
      '    Delivery',
      '      Build',
      '      Launch',
    ),
  },
  {
    id: 'c4-context',
    label: 'C4 Context',
    description: 'People, systems, containers, and dependencies.',
    category: 'Structure',
    preview: 'c4',
    badge: 'Experimental',
    starter: lines(
      'C4Context',
      '  title System context',
      '  Person(user, "User")',
      '  System(app, "Application")',
      '  System_Ext(api, "External API")',
      '  Rel(user, app, "Uses")',
      '  Rel(app, api, "Calls")',
    ),
  },
  {
    id: 'architecture',
    label: 'Architecture',
    description: 'Cloud services, resources, groups, and ports.',
    category: 'Structure',
    preview: 'architecture',
    badge: 'Beta',
    starter: lines(
      'architecture-beta',
      '  group api(cloud)[API]',
      '  service client(internet)[Client]',
      '  service server(server)[Service] in api',
      '  service db(database)[Database] in api',
      '  client:R --> L:server',
      '  server:R --> L:db',
    ),
  },
  {
    id: 'gantt',
    label: 'Gantt',
    description: 'Tasks, dependencies, milestones, and dates.',
    category: 'Planning',
    preview: 'gantt',
    starter: lines(
      'gantt',
      '  title Project plan',
      '  dateFormat YYYY-MM-DD',
      '  section Build',
      '  Design :done, design, 2026-01-01, 3d',
      '  Implement :active, build, after design, 5d',
      '  Ship :milestone, after build, 0d',
    ),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'Events and milestones arranged chronologically.',
    category: 'Planning',
    preview: 'timeline',
    starter: lines(
      'timeline',
      '  title Product launch',
      '  Q1 : Research',
      '  Q2 : Build : Test',
      '  Q3 : Launch',
    ),
  },
  {
    id: 'journey',
    label: 'User Journey',
    description: 'Experiences, actors, stages, and satisfaction.',
    category: 'Planning',
    preview: 'journey',
    starter: lines(
      'journey',
      '  title Customer journey',
      '  section Discover',
      '    Find product: 5: Customer',
      '    Compare options: 3: Customer',
      '  section Buy',
      '    Checkout: 4: Customer',
    ),
  },
  {
    id: 'kanban',
    label: 'Kanban',
    description: 'Work items organized into workflow columns.',
    category: 'Planning',
    preview: 'kanban',
    starter: lines(
      'kanban',
      '  todo[To do]',
      '    task1[Plan the work]',
      '  doing[In progress]',
      '    task2[Build the feature]',
      '  done[Done]',
      '    task3[Ship it]',
    ),
  },
  {
    id: 'git-graph',
    label: 'Git Graph',
    description: 'Branches, commits, merges, and releases.',
    category: 'Planning',
    preview: 'git',
    starter: lines(
      'gitGraph',
      '  commit id: "Plan"',
      '  branch feature',
      '  checkout feature',
      '  commit id: "Build"',
      '  checkout main',
      '  merge feature',
      '  commit id: "Ship"',
    ),
  },
  {
    id: 'pie',
    label: 'Pie Chart',
    description: 'A compact part-to-whole comparison.',
    category: 'Data',
    preview: 'pie',
    starter: lines(
      'pie showData',
      '  title Work allocation',
      '  "Build" : 45',
      '  "Test" : 30',
      '  "Plan" : 25',
    ),
  },
  {
    id: 'quadrant',
    label: 'Quadrant',
    description: 'Items positioned against two dimensions.',
    category: 'Data',
    preview: 'quadrant',
    starter: lines(
      'quadrantChart',
      '  title Impact and effort',
      '  x-axis Low effort --> High effort',
      '  y-axis Low impact --> High impact',
      '  "Quick win": [0.25, 0.80]',
      '  "Big bet": [0.75, 0.85]',
    ),
  },
  {
    id: 'sankey',
    label: 'Sankey',
    description: 'Weighted flows between sources and destinations.',
    category: 'Data',
    preview: 'sankey',
    badge: 'Beta',
    starter: lines(
      'sankey-beta',
      '  Source,Process,80',
      '  Source,Loss,20',
      '  Process,Output,70',
      '  Process,Waste,10',
    ),
  },
  {
    id: 'xy-chart',
    label: 'XY Chart',
    description: 'Bar and line series on numeric axes.',
    category: 'Data',
    preview: 'xy',
    badge: 'Beta',
    starter: lines(
      'xychart-beta',
      '  title "Delivery trend"',
      '  x-axis [Jan, Feb, Mar, Apr]',
      '  y-axis "Items" 0 --> 100',
      '  bar [30, 55, 70, 90]',
      '  line [25, 45, 75, 85]',
    ),
  },
  {
    id: 'requirement',
    label: 'Requirement',
    description: 'Requirements, elements, risks, and verification.',
    category: 'Data',
    preview: 'requirement',
    starter: lines(
      'requirementDiagram',
      '  requirement secure_auth {',
      '    id: 1',
      '    text: Users must authenticate',
      '    risk: high',
      '    verifymethod: test',
      '  }',
      '  element app {',
      '    type: system',
      '  }',
      '  app - satisfies -> secure_auth',
    ),
  },
];

export const DEFAULT_MERMAID_DIAGRAM_TYPE = MERMAID_DIAGRAM_TYPES[0];

export function mermaidDiagramMarkdown(source: string): string {
  return `\n\`\`\`mermaid\n${source}\n\`\`\`\n`;
}
