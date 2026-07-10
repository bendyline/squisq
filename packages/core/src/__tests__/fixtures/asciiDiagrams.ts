/**
 * Shared ASCII-diagram fixtures for the codec test suites (parse, render
 * fixpoint, detection corpus, pipeline). Positive fixtures are the parse
 * contract; the negative corpus is the detection contract.
 */

export const TWO_BOX_VERTICAL = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    │',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

export const TWO_BOX_VERTICAL_ASCII = [
  '+--------+',
  '| Alpha  |',
  '+---+----+',
  '    |',
  '    v',
  '+--------+',
  '| Beta   |',
  '+--------+',
].join('\n');

export const TWO_BOX_HORIZONTAL_ASCII = [
  '+--------+     +--------+',
  '| Input  | --> | Output |',
  '+--------+     +--------+',
].join('\n');

export const TWO_BOX_HORIZONTAL_UNICODE = [
  '┌────────┐     ┌────────┐',
  '│ Input  │────►│ Output │',
  '└────────┘     └────────┘',
].join('\n');

export const UNDIRECTED = [
  '┌────────┐     ┌────────┐',
  '│ Left   │─────│ Right  │',
  '└────────┘     └────────┘',
].join('\n');

export const BIDIRECTIONAL = [
  '┌───────┐         ┌───────┐',
  '│ Peer  │◄───────►│ Peer  │',
  '└───────┘         └───────┘',
].join('\n');

export const FAN_OUT_COLUMNS = [
  '┌──────────────────────┐',
  '│        Source        │',
  '└──────┬───────┬───────┘',
  '       │       │',
  '       ▼       ▼',
  '   ┌─────┐ ┌─────┐',
  '   │ One │ │ Two │',
  '   └─────┘ └─────┘',
].join('\n');

export const FAN_OUT_BUS = [
  '┌──────────────────────┐',
  '│        Source        │',
  '└──────────┬───────────┘',
  '     ┌─────┴─────┐',
  '     ▼           ▼',
  '  ┌─────┐     ┌─────┐',
  '  │ One │     │ Two │',
  '  └─────┘     └─────┘',
].join('\n');

export const PARALLEL_DUPES = [
  '┌────────────────┐',
  '│     Wide A     │',
  '└──┬──────────┬──┘',
  '   │          │',
  '   ▼          ▼',
  '┌────────────────┐',
  '│     Wide B     │',
  '└────────────────┘',
].join('\n');

/** The canonical AI-style nested diagram: container + 2×3 children + column edges. */
export const NESTED_CONTAINER = [
  '┌────────────────────────────────────────────────┐',
  '│                 Data Pipeline                  │',
  '│                                                │',
  '│   ┌────────┐    ┌─────────┐    ┌────────┐      │',
  '│   │ Ingest │    │ Enrich  │    │ Export │      │',
  '│   └───┬────┘    └────┬────┘    └───┬────┘      │',
  '│       │              │             │           │',
  '│       ▼              ▼             ▼           │',
  '│   ┌────────┐    ┌─────────┐    ┌────────┐      │',
  '│   │ Raw    │    │ Silver  │    │ Gold   │      │',
  '│   └────────┘    └─────────┘    └────────┘      │',
  '└────────────────────────────────────────────────┘',
].join('\n');

export const CONTAINER_EMBEDDED_TITLE = [
  '┌─── Cluster ────┐',
  '│  ┌──────────┐  │',
  '│  │ Worker   │  │',
  '│  └──────────┘  │',
  '└────────────────┘',
].join('\n');

export const MULTILINE_LABELS = [
  '┌──────────────┐      ┌──────────────┐',
  '│ molen-kernel │      │ molen-client │',
  '│ headless sim │      │ three.js     │',
  '│ no DOM       │      │ cameras      │',
  '└──────┬───────┘      └──────────────┘',
  '       │',
  '       ▼',
  '┌──────────────┐',
  '│    Worker    │',
  '└──────────────┘',
].join('\n');

/** `├──┤` interior dividers are indistinguishable from stacked shared-border boxes → two nodes. */
export const SECTIONED_CARD = [
  '┌──────────┐',
  '│ Header   │',
  '├──────────┤',
  '│ Body     │',
  '└──────────┘',
].join('\n');

export const STACKED_SHARED_BORDER_ASCII = [
  '+-------+',
  '| Upper |',
  '+-------+',
  '| Lower |',
  '+-------+',
].join('\n');

export const EDGE_LABEL = [
  '┌────────┐             ┌────────┐',
  '│ Client │──auth──────►│ Server │',
  '└────────┘             └────────┘',
].join('\n');

export const EDGE_LABEL_SPACED = [
  '┌────────┐               ┌────────┐',
  '│ Client │── auth flow ─►│ Server │',
  '└────────┘               └────────┘',
].join('\n');

export const DUPLICATE_LABELS = [
  '┌───────┐     ┌───────┐',
  '│ Cache │     │ Cache │',
  '└───────┘     └───────┘',
].join('\n');

export const ROUNDED_AND_DOUBLE = [
  '╭────────╮      ╔════════╗',
  '│ Round  │      ║ Double ║',
  '╰────────╯      ╚════════╝',
].join('\n');

export const SINGLE_BOX = ['┌────────┐', '│ Alone  │', '└────────┘'].join('\n');

/** Every positive fixture the fixpoint suite must survive. */
export const POSITIVE_FIXTURES: Record<string, string> = {
  TWO_BOX_VERTICAL,
  TWO_BOX_VERTICAL_ASCII,
  TWO_BOX_HORIZONTAL_ASCII,
  TWO_BOX_HORIZONTAL_UNICODE,
  UNDIRECTED,
  BIDIRECTIONAL,
  FAN_OUT_COLUMNS,
  FAN_OUT_BUS,
  PARALLEL_DUPES,
  NESTED_CONTAINER,
  CONTAINER_EMBEDDED_TITLE,
  MULTILINE_LABELS,
  SECTIONED_CARD,
  STACKED_SHARED_BORDER_ASCII,
  EDGE_LABEL,
  EDGE_LABEL_SPACED,
  DUPLICATE_LABELS,
  ROUNDED_AND_DOUBLE,
};

// ---------------------------------------------------------------------------
// Negative corpus — all of these must be REJECTED by detectAsciiDiagram.
// ---------------------------------------------------------------------------

export const NEG_MARKDOWN_TABLE = [
  '| Name  | Role     |',
  '|-------|----------|',
  '| Ada   | Engineer |',
  '| Grace | Admiral  |',
].join('\n');

export const NEG_PSQL_TABLE = [
  '+----+-------+',
  '| id | name  |',
  '+----+-------+',
  '| 1  | Alice |',
  '+----+-------+',
  '| 2  | Bob   |',
  '+----+-------+',
].join('\n');

export const NEG_MYSQL_TABLE = [
  '+----------+----------+---------+',
  '| Database | Table    | Rows    |',
  '+----------+----------+---------+',
  '| app      | users    | 1042    |',
  '| app      | sessions | 98213   |',
  '+----------+----------+---------+',
].join('\n');

export const NEG_SHELL_PIPES = [
  'cat access.log | grep 500 | awk "{print $7}" | sort | uniq -c',
  'ps aux | head -20',
  'docker ps -a | wc -l',
].join('\n');

export const NEG_TS_UNION = [
  'type Result<T> =',
  '  | { ok: true; value: T }',
  '  | { ok: false; error: Error };',
  'const x: A | B | C = pick();',
].join('\n');

export const NEG_SQL_DDL = [
  'CREATE TABLE users (',
  '  id INTEGER PRIMARY KEY,',
  '  name TEXT NOT NULL,',
  '  created_at TIMESTAMP',
  ');',
].join('\n');

export const NEG_FILE_TREE = [
  'src/',
  '├── components/',
  '│   ├── App.tsx',
  '│   └── Button.tsx',
  '└── utils/',
  '    └── math.ts',
].join('\n');

export const NEG_YAML = [
  'services:',
  '  web:',
  '    image: nginx',
  '    ports:',
  '      - "80:80"',
].join('\n');

export const NEG_LOG_COLUMNS = [
  '2026-01-01 │ INFO  │ started',
  '2026-01-02 │ WARN  │ disk low',
  '2026-01-03 │ ERROR │ crashed',
].join('\n');

export const NEG_PROSE_HEAVY = [
  'This paragraph explains the architecture in detail before showing it.',
  'There is a great deal of text here that is not part of any box at all,',
  'and the actual diagram below is a small part of the overall content.',
  'More prose lines continue to pad this out considerably, adding noise',
  'that should push the loose-content ratio well past the threshold.',
  '┌───┐ ┌───┐',
  '│ A │ │ B │',
  '└───┘ └───┘',
  'And afterwards even more explanation text follows the tiny diagram,',
  'ensuring that the fence is mostly prose rather than mostly diagram.',
].join('\n');

export const NEGATIVE_FIXTURES: Record<string, string> = {
  NEG_MARKDOWN_TABLE,
  NEG_PSQL_TABLE,
  NEG_MYSQL_TABLE,
  NEG_SHELL_PIPES,
  NEG_TS_UNION,
  NEG_SQL_DDL,
  NEG_FILE_TREE,
  NEG_YAML,
  NEG_LOG_COLUMNS,
  NEG_PROSE_HEAVY,
  SINGLE_BOX,
};
