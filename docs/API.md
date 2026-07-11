# Squisq API Reference

> Reference for the seven published packages and their subpath exports. Types
> and signatures below are transcribed from source; when in doubt, the `.d.ts`
> files under each package's `dist/` are the ground truth.

---

## Table of Contents

- [`@bendyline/squisq` (Core)](#bendylinesquisq-core)
  - [Schemas](#subpath-schemas)
  - [Doc / Story](#subpath-doc)
  - [Spatial](#subpath-spatial)
  - [Storage](#subpath-storage)
  - [Markdown](#subpath-markdown)
  - [Timing](#subpath-timing)
  - [Random](#subpath-random)
  - [Generate](#subpath-generate)
  - [Transform](#subpath-transform)
  - [Versions](#subpath-versions)
  - [JSON Form](#subpath-jsonform)
  - [Image Edit](#subpath-imageedit)
  - [Icons](#subpath-icons)
  - [Recommend](#subpath-recommend)
- [`@bendyline/squisq-react`](#bendylinesquisq-react)
- [`@bendyline/squisq-formats`](#bendylinesquisq-formats)
- [`@bendyline/squisq-editor-react`](#bendylinesquisq-editor-react)
- [`@bendyline/squisq-video`](#bendylinesquisq-video)
- [`@bendyline/squisq-video-react`](#bendylinesquisq-video-react)
- [`@bendyline/squisq-cli`](#bendylinesquisq-cli)

---

## `@bendyline/squisq` (Core)

Headless utilities — schemas, templates, spatial math, markdown, storage,
timing, transforms, version history, JSON forms, image-edit, icons, and content
recommendation. Zero framework dependencies; runs in the browser and Node.

The root entry (`@bendyline/squisq`) re-exports every subpath barrel below
(except `icon-marker`, whose symbols are also surfaced through `./icons`).

### Subpath: Schemas

**Import:** `@bendyline/squisq/schemas`

#### Doc & Block

````ts
/** A complete visual doc for an article. */
interface Doc {
  articleId: string;
  duration: number; // total seconds (sum of audio segments)
  blocks: Block[];
  audio: AudioTrack;
  captions?: CaptionTrack;
  startBlock?: StartBlockConfig; // resting/cover block shown before playback
  persistentLayers?: PersistentLayerConfig;
  themeId?: string; // resolved at render time via resolveTheme()
  meta?: { generatedAt?: string; generatedBy?: string; version?: number };
  frontmatter?: Record<string, unknown>; // YAML frontmatter from source markdown
  customTemplates?: CustomTemplateDefinition[]; // from `squisq-custom-templates`
  customThemes?: Theme[]; // from `squisq-custom-themes`
  diagnostics?: DocDiagnostic[]; // structural problems found while building
  documentMedia?: MediaClip[]; // document-spanning timed media (anchor=document)
}

type DocBlock = Block | TemplateBlock; // use isTemplateBlock() to narrow

interface Block {
  id: string;
  startTime: number; // seconds from start
  duration: number; // seconds visible
  audioSegment: number; // 0-indexed
  layers?: Layer[]; // template-derived blocks omit this and compute on demand
  transition?: Transition;
  template?: string; // template that generated this block
  autoTemplate?: boolean; // true when template was content-auto-picked
  title?: string;
  // markdown-driven hierarchy
  children?: Block[];
  contents?: MarkdownBlockNode[];
  sourceHeading?: MarkdownHeading;
  templateOverrides?: Record<string, string>; // from `{[tpl key=value]}`
  templateData?: Record<string, unknown>; // from a ```json data / ```yaml data fence
  // block-level metadata from Pandoc `{#id .class key=value}`
  x?: number;
  y?: number;
  connectsTo?: BlockConnection[];
  classes?: string[];
  metadata?: Record<string, string>;
  media?: MediaClip[]; // body-level `{[audio…]}` / `{[video…]}` clips
}

interface BlockConnection {
  target: string; // another block's id
  type?: string; // e.g. "flow", "requires"
}

interface DocDiagnostic {
  severity: 'error' | 'warning';
  code: string; // e.g. 'unknown-template', 'duplicate-id'
  message: string;
  blockId?: string;
  line?: number; // 1-based line in markdown source
}

interface StartBlockConfig {
  title: string;
  subtitle?: string;
  heroSrc?: string;
  heroAlt?: string;
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
  heroCredit?: string;
  heroLicense?: string;
}
````

#### Layer Types

Layers carry their visual data in a nested `content` object (not flat fields).
The discriminated union has **eight** members:

```ts
type Layer =
  | ImageLayer
  | TextLayer
  | ShapeLayer
  | PathLayer
  | MapLayer
  | VideoLayer
  | TableLayer
  | TreeLayer;

interface BaseLayer {
  id: string;
  position: Position;
  animation?: Animation;
}

interface ImageLayer extends BaseLayer {
  type: 'image';
  content: {
    src: string;
    alt: string;
    fit?: 'cover' | 'contain' | 'fill';
    credit?: string;
    license?: string;
    treatment?: ImageTreatment; // theme-derived photographic grade
    blur?: number; // gaussian blur radius (px)
  };
}

interface TextLayer extends BaseLayer {
  type: 'text';
  content: {
    text: string; // plain-text source of truth (PDF/markdown export, a11y, SVG fallback)
    html?: string; // optional sanitized inline HTML; rendered via <foreignObject>
    style: TextStyle;
  };
}

interface ShapeLayer extends BaseLayer {
  type: 'shape';
  content: {
    shape: 'rect' | 'circle' | 'line';
    fill?: string;
    fillOpacity?: number;
    gradient?: LinearGradient;
    pattern?: ShapePattern; // dots | grid | diagonal
    filter?: ShapeFilter; // 'noise' film grain
    stroke?: string;
    strokeWidth?: number;
    borderStyle?: BorderStyle; // 'solid' | 'dashed' | 'dotted'
    borderRadius?: number;
  };
}

interface PathLayer extends BaseLayer {
  type: 'path';
  content: {
    d: string; // SVG path `d` (absolute viewBox coords)
    shapeKind?: string; // named shape (e.g. 'diamond', 'star') re-derived from position box
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    fillOpacity?: number;
    gradient?: LinearGradient;
    borderStyle?: BorderStyle;
    dasharray?: string;
    startMarker?: MarkerStyle;
    endMarker?: MarkerStyle;
  };
}

interface MapLayer extends BaseLayer {
  type: 'map';
  content: {
    center: { lat: number; lng: number };
    zoom: number; // 0–18
    style: MapTileStyle; // 'terrain' | 'satellite' | 'road' | 'toner' | 'watercolor'
    markers?: MapMarker[];
    staticSrc?: string; // pre-rendered still (for reliable video export)
    showAttribution?: boolean; // default true
  };
}

interface VideoLayer extends BaseLayer {
  type: 'video'; // always muted; narration provides audio
  content: {
    src: string;
    posterSrc?: string;
    alt: string;
    fit?: 'cover' | 'contain' | 'fill';
    clipStart: number;
    clipEnd: number;
    sourceDuration?: number;
    startAt?: number; // block-relative start (seconds)
    spillover?: boolean; // keep playing past the block's end
    credit?: string;
    license?: string;
  };
}

interface TableLayer extends BaseLayer {
  type: 'table';
  content: {
    headers: string[];
    rows: string[][];
    align?: (('left' | 'right' | 'center') | null)[];
    style: TableLayerStyle;
  };
}

interface Position {
  x: number | string; // pixels or percentage string ("50%")
  y: number | string;
  width?: number | string;
  height?: number | string;
  anchor?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

interface TextStyle {
  fontSize: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color: string;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  shadow?: boolean;
  background?: string;
  backgroundOpacity?: number;
  backgroundGradient?: LinearGradient;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: BorderStyle;
  padding?: number;
  maxLines?: number;
}

interface Animation {
  type: AnimationType;
  duration?: number; // seconds (defaults to block duration)
  delay?: number; // seconds
  easing?: string;
  direction?: 'in' | 'out'; // Ken Burns zoom
  panDirection?: 'left' | 'right' | 'up' | 'down';
}

type AnimationType =
  | 'none'
  | 'fadeIn'
  | 'fadeOut'
  | 'slowZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'panLeft'
  | 'panRight'
  | 'typewriter';

interface LinearGradient {
  from: string;
  to: string;
  angle?: number;
}
type BorderStyle = 'solid' | 'dashed' | 'dotted';
type MarkerStyle = 'none' | 'arrow' | 'open' | 'diamond' | 'circle' | 'square';

interface ImageTreatment {
  type: 'none' | 'mono' | 'duotone' | 'warm' | 'cool';
  strength?: number; // 0..1, default 0.6
  color?: string; // duotone tint
}
```

Readers still interpret the historical serialized `content.arrow` field, but
it is no longer part of `PathLayer`; new code uses `startMarker` / `endMarker`.

#### Audio & Captions

```ts
interface AudioTrack {
  segments: AudioSegment[];
}
interface AudioSegment {
  src: string;
  name: string;
  duration: number;
  startTime: number;
}
interface CaptionTrack {
  phrases: CaptionPhrase[];
  generatedAt?: string;
  version: number;
}
interface CaptionPhrase {
  text: string;
  startTime: number;
  endTime: number;
  audioSegment: number;
  words?: CaptionWord[];
}
interface CaptionWord {
  text: string;
  startTime: number;
  endTime: number;
}
```

#### Template Types

Template blocks are a **flat** discriminated union — each input interface
extends `BaseTemplateBlock` and carries a `template` discriminant plus its own
fields. There is no nested `input` object.

```ts
type TemplateBlock =
  | TitleBlockInput
  | SectionHeaderInput
  | StatHighlightInput
  | QuoteBlockInput
  | FactCardInput
  | TwoColumnInput
  | DateEventInput
  | ImageWithCaptionInput
  | LeftFeatureInput
  | RightFeatureInput
  | MapBlockInput
  | FullBleedQuoteInput
  | ListBlockInput
  | PhotoGridInput
  | DefinitionCardInput
  | ComparisonBarInput
  | PullQuoteInput
  | VideoWithCaptionInput
  | VideoPullQuoteInput
  | DataTableInput
  | DiagramBlockInput
  | RawLayersInput /* layout */
  | DrawingBlockInput;

// Fields common to every template block:
interface BaseTemplateBlock {
  id: string;
  duration: number;
  audioSegment: number;
  transition?: Transition;
  useBottomLayer?: boolean; // default true
  useTopLayer?: boolean; // default true
  sourceStartTime?: number;
  sourceDuration?: number;
  imageTreatment?: 'none' | 'mono' | 'duotone' | 'warm' | 'cool';
}

function isTemplateBlock(block: DocBlock): block is TemplateBlock;

type TemplateFunction = (input: TemplateBlock, context: TemplateContext) => Layer[];

interface TemplateContext {
  viewport: ViewportConfig;
  theme: Theme;
  blockIndex: number;
  totalBlocks: number;
  layout: LayoutHints;
  orientation: ViewportOrientation;
  children?: Block[]; // used by container templates (diagram, drawing, layout)
}
```

##### Built-in Template Block Inputs

Required fields are shown without `?`. Every template also inherits the
`BaseTemplateBlock` fields above. `colorScheme` is a theme colour-scheme name
(`string`); `ambientMotion` is `'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight'`.

| Template           | Required                                                                | Optional                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `title`            | `title`                                                                 | `subtitle`, `backgroundColor`                                                                                                   |
| `sectionHeader`    | `title`                                                                 | `colorScheme`, `imageSrc`, `imageAlt`, `ambientMotion`                                                                          |
| `statHighlight`    | `stat`, `description`                                                   | `detail`, `colorScheme`, `accentImage`                                                                                          |
| `quote`            | `quote`                                                                 | `attribution`, `accentImage`                                                                                                    |
| `factCard`         | `fact`, `explanation`                                                   | `source`, `accentImage`                                                                                                         |
| `twoColumn`        | `left {label, sublabel?}`, `right {label, sublabel?}`                   | `header`, `leftColor`, `rightColor`                                                                                             |
| `dateEvent`        | `date`, `description`                                                   | `footer`, `mood` (`neutral`\|`somber`\|`celebratory`), `accentImage`                                                            |
| `imageWithCaption` | `imageSrc`, `imageAlt`                                                  | `caption`, `captionPosition` (`bottom`\|`top`\|`center`), `ambientMotion`, `isTitle`, `subtitle`, `imageCredit`, `imageLicense` |
| `leftFeature`      | `imageSrc`                                                              | `imageAlt`, `imageWidth`, `imageHeight`, `title`, `body`                                                                        |
| `rightFeature`     | `imageSrc`                                                              | `imageAlt`, `imageWidth`, `imageHeight`, `title`, `body`                                                                        |
| `map`              | `center {lat, lng}`, `zoom`                                             | `mapStyle`, `title`, `caption`, `markers`, `ambientMotion`, `staticSrc`                                                         |
| `fullBleedQuote`   | `text`                                                                  | `colorScheme`                                                                                                                   |
| `list`             | `items[]`                                                               | `title`, `colorScheme`, `accentImage`                                                                                           |
| `photoGrid`        | `images[] {src, alt, credit?, license?}`                                | `caption`, `ambientMotion`                                                                                                      |
| `definitionCard`   | `term`, `definition`                                                    | `origin`, `colorScheme`, `accentImage`                                                                                          |
| `comparisonBar`    | `leftLabel`, `leftValue`, `rightLabel`, `rightValue`                    | `unit`, `colorScheme`                                                                                                           |
| `pullQuote`        | `text`, `backgroundImage {src, alt, credit?, license?}`                 | `attribution`, `ambientMotion`                                                                                                  |
| `videoWithCaption` | `videoSrc`, `videoAlt`, `clipStart`, `clipEnd`                          | `posterSrc`, `sourceDuration`, `caption`, `captionPosition`, `videoCredit`, `videoLicense`                                      |
| `videoPullQuote`   | `text`, `backgroundVideo {src, posterSrc?, alt, clipStart, clipEnd, …}` | `attribution`                                                                                                                   |
| `dataTable`        | `headers[]`, `rows[][]`                                                 | `title`, `align`, `colorScheme`                                                                                                 |
| `diagram`          | — (nodes/edges come from child headings)                                | `title`, `colorScheme`, `nodeShape`, `edgeStyle`, `startStyle`, `endStyle`, `lineStyle`                                         |
| `layout`           | — (`Layer[]` authored via the Scene engine, children-driven)            | —                                                                                                                               |
| `drawing`          | — (shapes come from child headings)                                     | `title`, `colorScheme`, `fill`, `stroke`                                                                                        |

`AccentImage = { src, alt, position, ambientMotion?, credit?, license? }` where
`position` is `'left-strip' | 'right-strip' | 'bottom-strip' | 'corner-inset'`.

#### Viewport & Theme

```ts
interface ViewportConfig {
  width: number;
  height: number;
  name: string;
}

const VIEWPORT_PRESETS: {
  landscape: { width: 1920; height: 1080; name: '16:9 Landscape' };
  portrait: { width: 1080; height: 1920; name: '9:16 Portrait' };
  square: { width: 1080; height: 1080; name: '1:1 Square' };
  standard: { width: 1440; height: 1080; name: '4:3 Standard' };
};
type ViewportPreset = keyof typeof VIEWPORT_PRESETS;
type ViewportOrientation = 'landscape' | 'portrait' | 'square';

function getViewport(v: ViewportPreset | ViewportConfig): ViewportConfig;
function getViewportOrientation(v: ViewportConfig): ViewportOrientation;
function getAspectRatioString(v: ViewportConfig): string;
function calculateFontScale(v: ViewportConfig): number;
```

The Theme system is large; the key surface is:

```ts
interface Theme {
  /* colors, typography, style, renderStyle, colorSchemes, persistentLayers, … */
}

const THEMES: Readonly<Record<string, Theme>>; // 11 deeply frozen built-ins
const DEFAULT_THEME: Theme;
const DEFAULT_THEME_ID: string;

interface ThemeRegistry {
  register(theme: Theme): void;
  unregister(id: string): boolean;
  get(id: string): Theme | undefined;
  list(): Theme[];
}

function createThemeRegistry(initialThemes?: readonly Theme[]): ThemeRegistry;
function resolveTheme(themeId?: string, registry?: ThemeRegistry): Theme;
function createTheme(base: Theme, overrides: DeepPartial<Theme>): Theme;
function compileTheme(partial: Partial<Theme>, opts?: CompileOptions): Theme;
function getAvailableThemes(registry?: ThemeRegistry): string[];
function getThemeSummaries(registry?: ThemeRegistry): {
  id: string;
  name: string;
  description?: string;
}[];
function validateTheme(theme: unknown): ValidationResult;
```

> Built-in theme ids: `standard` (default), `standard-dark`, `documentary`,
> `minimalist`, `bold`, `morning-light`, `tech-dark`, `magazine`, `cinematic`,
> `warm-earth`, `gezellig`. Custom themes do not mutate process-global state:
> keep host themes in a caller-owned
> `ThemeRegistry`, or put portable themes on `Doc.customThemes`. For doc-scoped
> resolution, use `resolveThemeForDoc(doc, id?, registry?)` from
> `@bendyline/squisq/doc`; document definitions take precedence over the
> explicit registry and built-ins.

#### Media & Layout

```ts
interface MediaProvider {
  resolveUrl(src: string): string | Promise<string>;
}

interface MediaClip {
  id: string;
  src: string;
  kind: 'audio' | 'video';
  startAt: number; // block-relative (or document-relative when anchor='document'); default 0
  clipStart?: number;
  clipEnd?: number;
  spillover?: boolean; // keep playing past the block's end
  anchor: 'block' | 'document'; // default 'block'
  sourceLine?: number; // 1-based authoring line, for round-tripping edits
}

// resolve authored clips into an absolute-timed schedule
function resolveMediaSchedule(doc: Doc): ScheduledClip[];
function getDocPlaybackDuration(doc: Doc): number;

type LayoutStrategy = 'absolute' | 'stack-vertical' | 'stack-horizontal' | 'grid' | 'flow';
interface LayoutHints {
  strategy?: LayoutStrategy;
  columns?: number;
  gap?: number;
  padding?: number;
}
```

---

### Subpath: Doc

**Import:** `@bendyline/squisq/doc` — the template registry, all 24 templates,
markdown↔doc conversion, canonical layer materialization, and
theme/validation helpers.

#### Doc ↔ Markdown Conversion

```ts
function markdownToDoc(markdownDoc: MarkdownDocument, options?: MarkdownToDocOptions): Doc;
function docToMarkdown(doc: Doc): MarkdownDocument;

interface MarkdownToDocOptions {
  articleId?: string; // default 'markdown-doc'
  defaultTemplate?: string; // default 'sectionHeader'
  defaultDuration?: number; // default 5 (seconds)
  generateId?: (heading: MarkdownHeading, index: number) => string;
  generateCoverBlock?: boolean; // default true — cover from first H1
  captionsGeneratedAt?: string; // omit to keep conversion deterministic
  autoTemplates?: boolean; // default true — content-aware auto template picking
}
```

> `markdownToDoc` never throws for content problems: it records findings on
> `doc.diagnostics` and degrades gracefully. It is fully deterministic — the
> same markdown always produces the same Doc.

#### Layer Resolution

```ts
function materializeBlockLayers(
  block: DocBlock,
  options?: MaterializeBlockLayersOptions,
): BlockLayerMaterialization;

interface MaterializeBlockLayersOptions {
  theme?: Theme;
  viewport?: ViewportConfig;
  persistentLayers?: PersistentLayerConfig | false; // undefined inherits the theme
  blockIndex?: number;
  totalBlocks?: number;
  customTemplates?: readonly CustomTemplateDefinition[];
  failureMode?: 'fallback' | 'empty'; // default 'fallback'
}

interface BlockLayerMaterialization {
  layers: Layer[];
  source: 'authored' | 'template' | 'fallback' | 'empty';
  diagnostic?: LayerMaterializationDiagnostic;
}

function expandDocBlocks(blocks: DocBlock[], options?: ExpandDocBlocksOptions): Block[];
function fallbackBlockLayers(block: Block, context: TemplateContext): Layer[]; // graceful-degradation card
```

`materializeBlockLayers` is the single layer-resolution contract used by
on-demand UI and timed expansion. It resolves authored layers, built-in and
document-scoped custom templates, theme render-style, and persistent layers.
Template failures are returned as structured diagnostics without hidden console
output. The default visible fallback keeps previews and playback readable;
`failureMode: 'empty'` is the explicit opt-out. Theme persistent layers are
inherited by default and `persistentLayers: false` disables them.

`expandDocBlocks` adds timeline scheduling and transitions around the canonical
materializer. Its `persistentLayers`, `failureMode`, and `customTemplates`
options have identical semantics, and `onDiagnostic` receives failures with the
source block and block index.

#### Template Registry

```ts
const templateRegistry: TemplateRegistry;
const CONTAINER_TEMPLATES: ReadonlySet<string>; // diagram, drawing, layout

function resolveTemplateName(name: string): string;
function getAvailableTemplates(): string[];
function hasTemplate(name: string): boolean;
function isContainerTemplate(name: string): boolean;

// Merge doc-defined custom templates into a runtime registry (no global mutation)
function buildRegistry(custom?: readonly CustomTemplateDefinition[]): RuntimeTemplateRegistry;
```

All 23 built-in templates register at import time under their canonical short
ids. `resolveTemplateName` continues to read legacy ids such as `titleBlock`
and `diagramNode`, while the compatibility table itself remains internal.

> There is no global `registerTemplate()`. Custom templates travel with the doc
> (`Doc.customTemplates`, from the `squisq-custom-templates` frontmatter key) and
> are merged via `buildRegistry(custom)`.

#### Theme Resolution & Validation

```ts
function resolveThemeForDoc(
  doc: Doc | null | undefined,
  explicitId?: string,
  registry?: ThemeRegistry,
): Theme;
function validateMarkdownSource(
  source: string,
  options?: ValidateOptions,
): MarkdownValidationResult;
function validateMarkdownDoc(
  markdownDoc: MarkdownDocument,
  options?: ValidateOptions,
): MarkdownValidationResult;

interface ValidateOptions {
  assets?: Iterable<string>;
  extraTemplates?: string[];
}
interface MarkdownValidationResult {
  diagnostics: DocDiagnostic[];
  errorCount: number;
  warningCount: number;
  doc: Doc;
}
```

#### Custom-Template & Custom-Theme Frontmatter Codecs

```ts
function readCustomTemplatesFromFrontmatter(
  fm: Record<string, unknown>,
): CustomTemplateDefinition[];
function writeCustomTemplatesToFrontmatter(
  fm: Record<string, unknown>,
  defs: CustomTemplateDefinition[],
): Record<string, unknown>;
function readCustomThemesFromFrontmatter(fm: Record<string, unknown>): Theme[];
function writeCustomThemesToFrontmatter(
  fm: Record<string, unknown>,
  themes: Theme[],
): Record<string, unknown>;
const FRONTMATTER_CUSTOM_TEMPLATES_KEY: 'squisq-custom-templates';
const FRONTMATTER_CUSTOM_THEMES_KEY: 'squisq-custom-themes';
```

#### Data Fences, Audio Mapping & Animation

```ts
function isDataFence(node: MarkdownNode): boolean;
function parseDataFence(node: MarkdownNode): DataFenceParseResult;
function parseYamlSubset(text: string): unknown; // top-level scalars, inline arrays, block sequences
function findFirstTable(nodes: MarkdownBlockNode[]): TableNode | undefined;
function extractTableData(table: TableNode): ExtractedTableData;
function resolveAudioMapping(doc: Doc, container: ContentContainer): Promise<Doc>;

function getAnimationStyle(
  animation: Animation | undefined,
  currentTime?: number,
): { className: string; style: object };
function getTransitionClass(
  type: TransitionType,
  entering: boolean,
  direction?: TransitionDirection,
): string;
```

---

### Subpath: Spatial

**Import:** `@bendyline/squisq/spatial`

```ts
// Coordinates comes from @bendyline/squisq/schemas
function haversineDistance(from: Coordinates, to: Coordinates): number; // kilometres
function calculateBearing(from: Coordinates, to: Coordinates): number; // degrees (0=north, 90=east)

function encodeGeohash(lat: number, lng: number, precision?: number): string; // default precision 9
function decodeGeohash(hash: string): { lat: number; lng: number; latErr: number; lngErr: number };
function getNeighbors(hash: string): string[]; // 8 surrounding cells
function getGeohash4Neighbors(geohash4: string): string[];
function getGeohashPrefix(geohash: string, precision: number): string;
function geohashToHierarchicalPath(geohash4: string): string;
function getGeohashPath(from: string, to: string, precision?: number): string[]; // default precision 4
function geohashOverlapsBounds(hash: string, bounds: BoundingBox): boolean;
```

---

### Subpath: Storage

**Import:** `@bendyline/squisq/storage`

```ts
interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

class MemoryStorageAdapter implements StorageAdapter {} // in-memory Map
class LocalStorageAdapter implements StorageAdapter {} // window.localStorage
class LocalForageAdapter implements StorageAdapter {
  constructor(store: LocalForageLike, options?: LocalForageAdapterOptions);
}
```

`ContentContainer` is the file-bundle abstraction that documents, media, and
`.versions/` snapshots live inside:

```ts
interface ContentContainer {
  read(path: string): Promise<string | null>;
  readBinary(path: string): Promise<ArrayBuffer | null>;
  write(path: string, content: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  // …see ContentEntry for entry metadata
}

class MemoryContentContainer implements ContentContainer {}
class ScopedContentContainer implements ContentContainer {} // sub-path view of another container
function scopeContainer(container: ContentContainer, prefix: string): ScopedContentContainer;
function findDocumentPath(container: ContentContainer): Promise<string | null>;
function createMediaProviderFromContainer(
  container: ContentContainer,
  basePath?: string,
): MediaProvider;
```

---

### Subpath: Markdown

**Import:** `@bendyline/squisq/markdown`

#### Parse & Stringify

```ts
function parseMarkdown(source: string, options?: ParseOptions): MarkdownDocument;
function stringifyMarkdown(doc: MarkdownDocument, options?: StringifyOptions): string;

interface ParseOptions {
  gfm?: boolean; // default true — tables, strikethrough, task lists, autolinks, footnotes
  math?: boolean; // default true — $…$ and $$…$$
  directive?: boolean; // default true — :::container, ::leaf, :text
  parseHtml?: boolean; // default true — raw HTML → HtmlNode sub-DOM
  frontmatter?: boolean; // default true — YAML --- blocks
}

interface StringifyOptions {
  gfm?: boolean; // default true
  math?: boolean; // default true
  directive?: boolean; // default true
  bullet?: '-' | '*' | '+'; // default '-'
  bulletOrdered?: '.' | ')'; // default '.'
  emphasis?: '*' | '_'; // default '*'
  strong?: '*' | '_'; // default '*'
  rule?: '-' | '*' | '_'; // default '-'
  fence?: '`' | '~'; // default '`'
  setext?: boolean; // default false
}
```

#### AST

`MarkdownDocument` is the root (`{ type: 'root'; children: MarkdownBlockNode[];
metadata?: Record<string, unknown> }`). The AST has 40+ node interfaces split
into `MarkdownBlockNode` / `MarkdownInlineNode` unions, plus an HTML sub-DOM
(`HtmlElement`, `HtmlText`, `HtmlComment`) and a `TemplateAnnotationNode`
(`{ type: 'templateAnnotation'; template: string; attributes: Record<string,string> }`).

#### Frontmatter, HTML, Tree Utilities

```ts
function parseFrontmatter(source: string): { frontmatter: Record<string, unknown>; body: string };
function setFrontmatterValues(source: string, values: Record<string, unknown>): string;
function inferDocumentTitle(doc: MarkdownDocument): string | undefined; // prefers frontmatter.title
function readFrontmatterThemeId(fm: Record<string, unknown>): string | undefined; // squisq-theme → themeId → theme

function parseHtmlToNodes(html: string, policy?: HtmlPolicy): HtmlNode[];
function stringifyHtmlNodes(nodes: HtmlNode[]): string;
function sanitizeHtmlNodes(nodes: HtmlNode[]): HtmlNode[];
function sanitizeUrl(url: string): string;

function walkMarkdownTree(node: MarkdownNode, visitor: (node: MarkdownNode) => void): void;
function findNodesByType(root: MarkdownDocument, type: string): MarkdownNode[];
function getChildren(node: MarkdownNode): MarkdownNode[];
function extractPlainText(node: MarkdownNode): string;
function countNodes(root: MarkdownNode): number;
function createDocument(...children: MarkdownBlockNode[]): MarkdownDocument;

// Pandoc/annotation attribute helpers
function parsePandocAttrTokens(inner: string): HeadingAttributes;
function serializePandocAttributes(attrs: HeadingAttributes): string;
function matchTrailingTemplateAnnotation(text: string): TrailingAnnotationMatch | null;
function parseTimeSeconds(value: string): number | null; // "02:15", "1500ms", "8"
```

---

### Subpath: Timing

**Import:** `@bendyline/squisq/timing` — narration / reading-time estimation.

```ts
const DEFAULT_WORDS_PER_SECOND = 2.5;

function estimateReadingTime(text: string, options?: ReadingTimeOptions): ReadingTimeEstimate;
function estimateNarrationTime(text: string, options?: NarrationTimeOptions): NarrationTimeEstimate;
function estimateNarrationDuration(text: string, wordsPerSecond?: number): number;
function calculatePrefixDuration(prefix: string, wordsPerSecond?: number): number;
function estimateTimeFromText(text: string, charOffset: number, totalDuration: number): number;
function countSpokenWords(text: string): number;
function estimateSpokenWordCount(token: string): number;

interface ReadingTimeOptions {
  wordsPerMinute?: number;
} // default 200
interface ReadingTimeEstimate {
  words: number;
  minutes: number;
  seconds: number;
}
interface NarrationTimeOptions {
  wordsPerSecond?: number;
} // default 2.5
interface NarrationTimeEstimate {
  spokenWords: number;
  minutes: number;
  seconds: number;
}
```

---

### Subpath: Random

**Import:** `@bendyline/squisq/random` — a deterministic Mulberry32 PRNG.

```ts
class SeededRandom {
  constructor(seed: number); // seed 0 is remapped to 0xdeadbeef
  next(): number; // [0, 1)
  nextInt(max: number): number; // [0, max)
  nextIntRange(min: number, max: number): number; // [min, max)
  nextBool(probability?: number): boolean; // default 0.5
  pick<T>(array: T[]): T | undefined;
  pickRequired<T>(array: T[]): T; // throws if empty
  pickMultiple<T>(array: T[], count: number): T[];
  shuffle<T>(array: T[]): T[]; // in place
  shuffled<T>(array: readonly T[]): T[]; // new copy
  pickWeighted<T>(items: { item: T; weight: number }[]): T | undefined;
  getState(): number;
  derive(modifier: string | number): SeededRandom;
}

function hashString(str: string): number; // djb2, unsigned 32-bit
```

---

### Subpath: Generate

**Import:** `@bendyline/squisq/generate` — content extraction only.
`extractContent` / `stripMarkdown` output shapes are a frozen external
contract. Build slides with `markdownToDoc` + `applyTransform`.

```ts
function extractContent(text: string, options?: ExtractionOptions): ExtractionResult;
function stripMarkdown(markdown: string): string;
function mapElementToBlock(element: ExtractedElement, options: MapOptions): TemplateBlock;

type ExtractionType =
  | 'stat'
  | 'date'
  | 'quote'
  | 'comparison'
  | 'fact'
  | 'impactLine'
  | 'list'
  | 'definition';

interface ExtractionOptions {
  minConfidence?: number;
  types?: ExtractionType[];
  maxPerType?: number;
}
interface ExtractedElement {
  type: ExtractionType;
  text: string;
  confidence: number;
  sourcePosition: number;
  endPosition: number;
  data: /* typed per ExtractionType */ unknown;
}
interface ExtractionResult {
  elements: ExtractedElement[];
  sourceLength: number;
  stats: Record<string, number>;
}
```

---

### Subpath: Transform

**Import:** `@bendyline/squisq/transform` — the slideshow transform pipeline.

```ts
function applyTransform(
  doc: Doc,
  style: TransformStyleInput,
  options?: TransformOptions,
): TransformResult;

type TransformStyleInput = TransformStyleId | TransformStyleConfig;

interface TransformStyleRegistry {
  register(style: TransformStyleConfig): void;
  unregister(id: string): boolean;
  get(id: string): TransformStyleConfig | undefined;
  list(): TransformStyleConfig[];
}

const DEFAULT_TRANSFORM_STYLE_ID = 'documentary';
function createTransformStyleRegistry(
  initialStyles?: readonly TransformStyleConfig[],
): TransformStyleRegistry;
function resolveTransformStyle(
  style: TransformStyleInput,
  registry?: TransformStyleRegistry,
): TransformStyleConfig; // unknown id → default
function getTransformStyleIds(registry?: TransformStyleRegistry): string[];
function getTransformStyleSummaries(registry?: TransformStyleRegistry): TransformStyleSummary[];

function analyzeBlocks(blocks: Block[], options?: ExtractionOptions): AnalyzedBlock[];
function extractDocImages(blocks: Block[]): TransformImage[];

interface TransformOptions {
  seed?: number;
  images?: TransformImage[];
  themeId?: string;
  overrides?: Partial<TransformStyleConfig>;
  registry?: TransformStyleRegistry;
}
interface TransformResult {
  doc: Doc;
  stats: { totalInputBlocks: number; transformedBlocks: number; insertedBlocks: number };
}
```

Built-in style ids: `documentary` (default), `magazine`, `data-driven`,
`narrative`, `minimal`. Custom definitions are either passed directly to
`applyTransform()` or resolved through an explicit caller-owned registry; no
transform call mutates process-global state. The historical persisted value
`dataDriven` remains readable and resolves to `data-driven`; APIs and editor
writes expose only the canonical kebab-case id.

---

### Subpath: Versions

**Import:** `@bendyline/squisq/versions` — document version history. Snapshots
live inside the doc's `ContentContainer` at `.versions/<basename>.<timestamp>.md`,
so they ride along through ZIP serialization.

```ts
class DocumentVersionManager {
  constructor(container: ContentContainer, options?: { basename?: string });
  saveVersion(options?: SaveVersionOptions): Promise<SaveVersionResult>;
  listVersions(): Promise<Version[]>; // newest-first
  readVersion(version: Version | string): Promise<string | null>;
  revertToVersion(
    version: Version | string,
    options?: RevertOptions,
  ): Promise<{ reverted: boolean; snapshotted: Version | null }>;
  pruneVersions(policy: PrunePolicy): Promise<Version[]>;
  coalesceVersions(options?: CoalesceOptions): Promise<Version[]>;
}

// Standalone equivalents (each takes the container as first arg):
function saveVersion(container, options?): Promise<SaveVersionResult>;
function listVersions(container, basename?): Promise<Version[]>;
function readVersion(container, version): Promise<string | null>;
function revertToVersion(
  container,
  version,
  options?,
): Promise<{ reverted: boolean; snapshotted: Version | null }>;
function pruneVersions(container, policy, basename?): Promise<Version[]>;
function coalesceVersions(container, options?, basename?): Promise<Version[]>;

interface Version {
  path: string;
  basename: string;
  timestamp: Date;
  size: number;
  collision: number;
}
type PrunePolicy =
  | { type: 'keep-last-n'; n: number }
  | { type: 'older-than'; date: Date }
  | { type: 'predicate'; keep: (v: Version, all: Version[]) => boolean };
interface CoalesceOptions {
  windowMs?: number;
} // default 60_000
```

---

### Subpath: JSON Form

**Import:** `@bendyline/squisq/jsonForm` — headless logic shared by `<JsonView>`
(react) and `<JsonEditor>` (editor-react). Zero React deps.

```ts
function chooseControl(schema: SquisqAnnotatedSchema): ControlKind;
function evaluateWhen(when: SquisqWhen, rootData: unknown): boolean;
function resolveFlag(flag: boolean | SquisqWhen | undefined, rootData: unknown): boolean;
function inferSchema(
  sample: unknown,
  options?: { additionalSamples?: readonly unknown[] },
): SquisqAnnotatedSchema;

// JSON Pointer helpers
function getByPointer(data: unknown, path: string): unknown;
function setByPointer<T>(data: T, path: string, value: unknown): T;
function resolveRef(
  schema: SquisqAnnotatedSchema,
  root: SquisqAnnotatedSchema,
): SquisqAnnotatedSchema | undefined;

type ControlKind =
  | 'text'
  | 'multiline'
  | 'richtext'
  | 'color'
  | 'date'
  | 'time'
  | 'datetime'
  | 'slider'
  | 'stepper'
  | 'segmented'
  | 'radio'
  | 'combobox'
  | 'toggle'
  | 'checkbox'
  | 'card'
  | 'card-stack'
  | 'chip-bin'
  | 'tabs'
  | 'group';

interface SquisqHints {
  control?: ControlKind;
  label?: string;
  help?: string;
  placeholder?: string;
  width?: 'full' | 'half' | 'third' | 'auto';
  hidden?: boolean | SquisqWhen;
  disabled?: boolean | SquisqWhen;
  required?: boolean;
  itemLabel?: string | { fromField: string };
  addLabel?: string;
  removeLabel?: string;
  step?: number;
  enumLabels?: Record<string, string>;
}
interface SquisqWhen {
  field: string;
  equals?: unknown;
  oneOf?: readonly unknown[];
  matches?: string;
  truthy?: boolean;
}
// SquisqAnnotatedSchema is a structural JSON Schema subset carrying an optional `squisq: SquisqHints`.
```

---

### Subpath: Image Edit

**Import:** `@bendyline/squisq/imageEdit` — layered raster authoring schema,
sidecar persistence, and version history (mirrors `versions/` over JSON state).

```ts
interface ImageEditDoc {
  version: 1;
  canvas: ImageEditCanvas;
  layers: ImageEditLayer[];
  meta?: ImageEditMeta;
}
type ImageEditLayerKind = 'image' | 'text' | 'shape' | 'path';

// immutable state helpers
function createEmptyImageEditDoc(
  width: number,
  height: number,
  options?: { background?: string; sourcePath?: string; now?: Date },
): ImageEditDoc;
function addLayer(doc, layer): ImageEditDoc;
function removeLayer(doc, layerId): ImageEditDoc;
function reorderLayer(doc, layerId, toIndex): ImageEditDoc;
function updateLayer(doc, layerId, patch): ImageEditDoc;
function setCanvas(doc, canvas): ImageEditDoc;

// persistence + export
function readImageEditDoc(container, filename?): Promise<ImageEditDoc | null>; // default 'state.json'
function writeImageEditDoc(container, doc, filename?): Promise<void>;
function exportImageEditDoc(doc, container, options?: ImageEditExportOptions): Promise<Blob>; // png|jpeg|webp
function buildSvgString(doc, container): Promise<string>;

// version history (parallels versions/; shares Version / PrunePolicy / CoalesceOptions)
class ImageEditVersionManager {
  /* saveVersion / listVersions / readVersion / revertToVersion / pruneVersions / coalesceVersions */
}
```

---

### Subpath: Icons

**Import:** `@bendyline/squisq/icons` — FontAwesome Free catalog + resolution.

```ts
const ICONS: IconEntry[]; // FontAwesome Free catalog
type IconFamily = 'brands' | 'solid' | 'regular';
interface IconEntry {
  name: string;
  family: IconFamily;
  label: string;
  keywords: string;
  unicode: string;
}

function looksLikeIconToken(token: string): boolean;
function resolveIcon(token: string): IconEntry | null;
function canonicalIconToken(entry: IconEntry): string; // shortest unambiguous token
function iconGlyph(entry: IconEntry): string; // rendered Unicode char
function suggestIcons(query: string, limit?: number): IconSuggestion[]; // default limit 50

// inline icon markers (also on the dedicated `@bendyline/squisq/icon-marker` subpath)
function iconMarker(family: IconFamily, name: string): string;
function hasIconMarker(value: string): boolean;
function stripIconMarkers(value: string): string;
function splitIconMarkers(value: string): IconTextRun[];
function iconClass(family: IconFamily, name: string): string; // e.g. 'fa-solid fa-rocket'
```

---

### Subpath: Recommend

**Import:** `@bendyline/squisq/recommend` — block-content profiler + template
recommendations for the editor's template picker.

```ts
function profileBlockContents(nodes: MarkdownBlockNode[]): BlockContentProfile;
function recommendTemplatesForBlock(
  profile: BlockContentProfile,
  allNames: readonly string[],
): RecommendationResult;

interface BlockContentProfile {
  hasImage: boolean;
  imageCount: number;
  hasVideo: boolean;
  hasBlockquote: boolean;
  hasList: boolean;
  hasTable: boolean;
  hasDate: boolean;
  hasNumberHighlight: boolean;
  wordCount: number;
}
interface RecommendationResult {
  recommended: string[];
  rest: string[];
}
```

---

## `@bendyline/squisq-react`

React component library for rendering docs, blocks, and controls. Depends on
`@bendyline/squisq` (core).

**Import:** `@bendyline/squisq-react`
**Styles:** `@bendyline/squisq-react/styles`
**Standalone bundle:** `@bendyline/squisq-react/standalone` (IIFE) and
`@bendyline/squisq-react/standalone-source` (the bundle as a string).

### Components

#### `DocPlayer`

Main document player. Pass **either** a parsed `doc` **or** raw `markdown`
(parsed + converted internally); `doc` wins when both are given. When neither is
supplied the player renders a minimal themed empty state instead of crashing.
`basePath` is optional and defaults to `'.'`.

> **v1.5 breaking:** the old `script` prop is now `doc`, and the `audioProvider`
> prop is now `audioController` (its type `AudioProvider` was renamed to
> `AudioController`). A new `markdown?: string` prop lets you pass source text
> directly: `<DocPlayer markdown={src} />`.

```ts
interface DocPlayerProps {
  doc?: Doc; // wins over `markdown` when both are given
  markdown?: string; // parsed via markdownToDoc(parseMarkdown(markdown)) when `doc` is absent
  basePath?: string; // default '.'
  renderMode?: boolean; // default false — headless capture mode
  onRenderAPIReady?: (api: SquisqRenderAPI | null) => void;
  autoPlay?: boolean; // default false
  onEnded?: () => void;
  onTimeUpdate?: (time: number) => void;
  audioController?: AudioController;
  showControls?: boolean; // default true
  showScrubber?: boolean; // default false (only when showControls=false)
  muted?: boolean; // default false
  captionsEnabled?: boolean; // default true
  onCaptionsToggle?: (enabled: boolean) => void;
  onPlaybackStateChange?: (state: PlaybackState) => void;
  onControlsReady?: (controls: PlaybackActions & { play(): void; pause(): void }) => void;
  isFullscreen?: boolean; // default false
  onFullscreenToggle?: () => void;
  onBlockMarkers?: (markers: BlockMarker[]) => void;
  forceViewport?: ViewportConfig;
  theme?: Theme; // default DEFAULT_THEME
  surface?: SurfaceScheme | 'auto';
  displayMode?: DisplayMode; // default 'video'
  captionStyle?: CaptionStyle; // default 'standard'
  enableSwipe?: boolean; // default true — drag-to-swipe navigation in slideshow mode
}
```

#### `BlockRenderer`

SVG-based renderer for a single (expanded) block. Its default viewport is
1920×1080; import the shared `VIEWPORT_PRESETS.landscape` value from
`@bendyline/squisq/doc` when a caller needs that configuration explicitly.

```ts
interface BlockRendererProps {
  block: Block;
  blockTime: number;
  basePath: string;
  isEntering?: boolean;
  isExiting?: boolean;
  transition?: Transition;
  viewport?: { width: number; height: number };
  isPlaying?: boolean;
}
```

#### Other components

| Component              | Summary                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `DocPlayerWithSidebar` | `DocPlayer` composed with `DocControlsSidebar`.                       |
| `LinearDocView`        | Scrollable/printable render of all blocks (`LinearDocViewProps`).     |
| `MarkdownRenderer`     | Renders `MarkdownBlockNode[]` as React (`MarkdownRendererProps`).     |
| `CaptionOverlay`       | Standard caption overlay bound to `CaptionTrack` + `currentTime`.     |
| `SocialCaptionOverlay` | Large centered TikTok/Reels-style word-by-word captions.              |
| `DocProgressBar`       | Block progress indicator with seek.                                   |
| `DocControlsOverlay`   | Floating play/pause + prev/next over the player.                      |
| `DocControlsBottom`    | Bottom bar with progress + counter.                                   |
| `DocControlsSidebar`   | Side panel with block thumbnails.                                     |
| `DocControlsSlideshow` | Minimal slideshow controls (arrows + counter).                        |
| `InlineVideoPlayer`    | Native `<video>` wrapper resolving `src`/`poster` via `MediaContext`. |
| `InlineAudioPlayer`    | Native `<audio>` wrapper resolving `src` via `MediaContext`.          |
| `JsonView`             | Read-only viewer for a JSON value bound to a Squisq-annotated schema. |

```ts
interface LinearDocViewProps {
  doc?: Doc; // wins over `markdown` when both are given
  markdown?: string; // parsed internally when `doc` is absent (empty container otherwise)
  basePath?: string;
  viewport?: ViewportConfig;
  theme?: Theme; // default DEFAULT_THEME
  surface?: SurfaceScheme | 'auto';
  thinMargins?: boolean;
  imageDisplayMode?: ImageDisplayMode; // 'inline' (default) | 'thumbnail'
  className?: string;
}

interface JsonViewProps {
  schema: SquisqAnnotatedSchema;
  value: unknown;
  theme?: Theme; // default DEFAULT_THEME
  surface?: SurfaceScheme | 'auto';
  density?: 'comfortable' | 'compact'; // default 'comfortable'
  className?: string;
}
```

### Layers

SVG layer components used internally by `BlockRenderer`, exported for custom
rendering. There are **eight**: `ImageLayer`, `TextLayer`, `ShapeLayer`,
`PathLayer`, `VideoLayer`, `TableLayer`, `MapLayer`, `TreeLayer`. Each takes
`{ layer, viewport, blockTime }` (image/video/map also take `basePath`; video
also takes `isPlaying`).

### Timed-Media

```ts
// One hidden <audio>/<video> per scheduled clip; seeks/plays those active at currentTime.
interface MediaClipLayerProps {
  schedule: ScheduledClip[];
  currentTime: number;
  isPlaying: boolean;
  basePath: string;
  renderMode?: boolean; // default false
}
function MediaClipLayer(props: MediaClipLayerProps): JSX.Element;

interface MediaScheduleController {
  renderClips: ScheduledClip[];
  activeIds: Set<string>;
}
function useMediaSchedule(schedule: ScheduledClip[], currentTime: number): MediaScheduleController;
```

### Hooks

```ts
function useDocPlayback(
  script: Doc | null,
  currentTime: number,
  options?: {
    viewport?: ViewportConfig;
    theme?: Theme;
    onSeek?: (time: number) => void;
  },
): PlaybackState & PlaybackActions;
function useAudioSync(
  audioRef: RefObject<HTMLAudioElement>,
  audioTrack: AudioTrack | undefined,
  basePath?: string,
): AudioController;
function useViewportOrientation(): {
  viewport: ViewportConfig;
  orientation: ViewportOrientation;
  windowSize: { width: number; height: number };
};
function useAutoSurface(enabled: boolean): SurfaceScheme; // live-tracks prefers-color-scheme

// Media context
const MediaContext: React.Context<MediaProvider | null>;
function useMediaProvider(): MediaProvider | null;
function useMediaUrl(relativePath: string, basePath: string): string;
```

### Types & Utilities

```ts
type DisplayMode = 'video' | 'slideshow' | 'linear' | 'page';
type CaptionStyle = 'standard' | 'social';
type CaptionMode = 'off' | 'standard' | 'social';
type ControlsLayout = 'overlay' | 'sidebar' | 'bottom';
type ImageDisplayMode = 'inline' | 'thumbnail';

interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  currentBlockIndex: number;
  totalBlocks: number;
  docProgress: number;
  hasCaptions: boolean;
  captionsEnabled: boolean;
  captionMode: CaptionMode;
  currentBlock: Block | null; /* … */
}
interface PlaybackActions {
  toggle(): void;
  restart(): void;
  seekTo(time: number): void;
  setCaptionsEnabled(enabled: boolean): void;
  cycleCaptionMode(): void;
  toggleFullscreen?(): void;
}
interface BlockMarker {
  block: Block;
  index: number;
  position: number;
  title: string;
  isSectionStart: boolean;
}

// v1.5: the audio-controller type was renamed from `AudioProvider` to `AudioController`.
type AudioController = AudioState & AudioActions;
interface SquisqRenderAPI {
  seekTo(time: number): Promise<void>;
  getDuration(): number;
  getBlocks(): RenderBlockInfo[];
  getAudioSegments(): RenderAudioSegmentInfo[];
  getCaptions(): RenderCaptionInfo[];
  getChapters(): RenderChapterInfo[];
  showCover(): Promise<void>;
  hideCover(): Promise<void>;
  hasCoverBlock(): boolean;
}
function formatTime(seconds: number): string; // "M:SS"
function getAnimationStyle(
  animation: Animation | undefined,
  currentTime?: number,
): { className: string; style: object };
function getTransitionClass(
  type: TransitionType,
  entering: boolean,
  direction?: TransitionDirection,
): string;
```

### Styles & Standalone Bundle

```ts
interface MountOptions {
  mode?: 'slideshow' | 'static';
  basePath?: string;
  images?: Record<string, string>;
  audio?: Record<string, string>;
  theme?: Theme;
  autoPlay?: boolean;
  renderMode?: boolean;
  captionStyle?: 'standard' | 'social';
}
interface SquisqPlayerHandle {
  readonly element: Element;
  readonly renderAPI: Promise<SquisqRenderAPI | null>;
  getRenderAPI(): SquisqRenderAPI | null;
  unmount(): void;
}
```

Import `@bendyline/squisq-react/styles` for the DocPlayer animation + `<JsonView>`
stylesheet. `@bendyline/squisq-react/standalone-source` exports a single
constant, `PLAYER_BUNDLE: string` — an IIFE that boots a complete player into a
host page (consumed by `formats/html` and `squisq-cli`). The runtime IIFE at
`@bendyline/squisq-react/standalone` exposes a global `SquisqPlayer` with
`mount`, `getHandle`, `unmount`, and `version`. `mount()` returns an
instance-scoped `SquisqPlayerHandle`; in render mode, await
`handle.renderAPI`. `getHandle(element)` retrieves that exact mounted instance.

---

## `@bendyline/squisq-formats`

Document format converters. Uses `MarkdownDocument` from core as the pivot
representation: imports parse a file into a `MarkdownDocument` (plus extracted
assets via the `xxxToContainer` variants), exports serialize from one.
Conversions preserve structure and most of the flavor of a document — they are
**not** lossless round-trips. Convenience `docToXxx` / `xxxToDoc` wrappers
convert through `MarkdownDocument`.

Every export that accepts `themeId` (DOCX, PDF, EPUB, PPTX, plain HTML) falls
back to the doc's frontmatter theme (`squisq-theme` / `themeId` / `theme` keys)
when the option is omitted.

> The package root (`@bendyline/squisq-formats`) re-exports the common
> converters. `./container`, the plain-HTML/bundle functions (including
> `collectLinkRefs`), `docxToContainer`, `pdfToContainer`, `PdfPageSize`, and
> the image utilities (`inferMimeType`, `arrayBufferToBase64DataUrl`,
> `extractFilename`) are **subpath-only**.

### Subpath: DOCX

**Import:** `@bendyline/squisq-formats/docx`

Import covers headings (style + outline-level detection), paragraphs, inline
formatting (bold, italic, strikethrough, inline code), hyperlinks, lists,
tables, blockquotes, code blocks, footnotes, and — with `extractImages` —
embedded images as data URIs. `docxToContainer` always extracts images,
writing them under `images/` in the returned container. On export, images are
only embedded when provided via `options.images`; otherwise they render as
placeholder text.

```ts
function markdownDocToDocx(
  doc: MarkdownDocument,
  options?: DocxExportOptions,
): Promise<ArrayBuffer>;
function docToDocx(doc: Doc, options?: DocxExportOptions): Promise<ArrayBuffer>;
function docxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options?: DocxImportOptions,
): Promise<MarkdownDocument>;
function docxToDoc(data: ArrayBuffer | Blob, options?: DocxImportOptions): Promise<Doc>;
function docxToContainer(
  data: ArrayBuffer | Blob,
  options?: DocxImportOptions,
): Promise<ContentContainer>;

interface DocxExportOptions {
  title?: string;
  author?: string;
  description?: string;
  defaultFont?: string; // default 'Calibri'
  defaultFontSize?: number; // default 11
  themeId?: string;
  themeRegistry?: ThemeRegistry;
  images?: Map<string, { data: ArrayBuffer | Uint8Array; contentType: string }>;
}
interface DocxImportOptions {
  extractImages?: boolean;
} // default false
```

### Subpath: PDF

**Import:** `@bendyline/squisq-formats/pdf`

Export uses pdf-lib (standard 14 fonts — `themeId` affects colors only).
Import uses pdfjs-dist with heuristic structure detection (headings by font
size relative to `bodyFontSize`, plus the `detect*` flags below) — results are
best-effort. `pdfToMarkdownDoc` is text-only; `pdfToContainer` additionally
extracts embedded images to `images/` in the returned container. Extracted
images are placed **by page** — each image is inserted after the last content
block that originated from its page (image-only pages fall back to the nearest
preceding page with content, or the document end). Placement is page-level
only; vertical ordering within a page is not yet recovered. Image extraction
needs a browser canvas to encode pixel data to PNG — **under Node it is skipped**
with a single `console.warn` and no images are emitted. Call
`configurePdfWorker` before importing in environments that need an explicit
pdf.js worker URL.

```ts
function markdownDocToPdf(doc: MarkdownDocument, options?: PdfExportOptions): Promise<ArrayBuffer>;
function docToPdf(doc: Doc, options?: PdfExportOptions): Promise<ArrayBuffer>;
function pdfToMarkdownDoc(
  data: ArrayBuffer | Uint8Array | Blob,
  options?: PdfImportOptions,
): Promise<MarkdownDocument>;
function pdfToDoc(data: ArrayBuffer | Uint8Array | Blob, options?: PdfImportOptions): Promise<Doc>;
function pdfToContainer(
  data: ArrayBuffer | Uint8Array | Blob,
  options?: PdfImportOptions,
): Promise<ContentContainer>;
function configurePdfWorker(workerSrc: string): void;

type PdfPageSize = 'letter' | 'a4';
interface PdfExportOptions {
  title?: string;
  author?: string;
  pageSize?: PdfPageSize; // default 'letter'
  margin?: number; // default 72 (points)
  defaultFontSize?: number; // default 11
  themeId?: string; // colours only (pdf-lib standard fonts)
  themeRegistry?: ThemeRegistry;
}
interface PdfImportOptions {
  bodyFontSize?: number;
  detectTables?: boolean; // default true
  detectCodeBlocks?: boolean; // default true
  detectBlockquotes?: boolean; // default true
  detectLinks?: boolean; // default true
}
```

### Subpath: OOXML

**Import:** `@bendyline/squisq-formats/ooxml` — shared infrastructure for all
Office Open XML formats (DOCX, PPTX, XLSX).

```ts
// package reader
function openPackage(data: ArrayBuffer | Blob, options?: OoxmlOpenOptions): Promise<OoxmlPackage>;
function getPartRelationships(pkg: OoxmlPackage, partPath: string): Promise<Relationship[]>;
function getPartXml(pkg: OoxmlPackage, partPath: string): Promise<Document | null>;
function getPartBinary(pkg: OoxmlPackage, partPath: string): Promise<ArrayBuffer | null>;
function getCoreProperties(pkg: OoxmlPackage): Promise<CoreProperties>;

// package writer
function createPackage(): OoxmlPackageBuilder; // addPart / addBinaryPart / addRelationship / setCoreProperties / toBlob / toArrayBuffer

// XML utilities
function xmlDeclaration(): string;
function escapeXml(text: string): string;
function attrString(attrs?: Record<string, string | undefined>): string;
function selfClosingElement(tag: string, attrs?): string;
function xmlElement(tag: string, attrs?, ...children: string[]): string;
function textElement(tag: string, attrs?, text?: string): string;
```

`OoxmlOpenOptions` is `ZipSafetyLimits`; DOCX, PPTX, and XLSX import option
types inherit the same fields. All part access above shares one JSZip-backed,
actual-byte budget. Repeated reads are cached and charged once. Content-types
metadata is capped at 1 MiB and each relationships part at 4 MiB before DOM
parsing, independently of the larger allowance for document/media parts.
`OoxmlPackage` is opaque and can only be created by `openPackage()`; its JSZip
archive is intentionally not exposed, so advanced callers cannot bypass the
bounded part readers.

```ts
interface ZipSafetyLimits {
  maxEntries?: number; // default 10,000; includes directory records
  maxEntryUncompressedBytes?: number; // default maxUncompressedBytes
  maxUncompressedBytes?: number; // default 512 MiB, aggregate actual output
  maxCompressionRatio?: number; // default 1,000:1 per member
}
```

Archive failures throw `ZipSafetyError` with `code` plus optional `path`,
`limit`, `actual`, and `cause`. The class/types are exported from the package
root and `/ooxml`. Codes: `invalid-limit`, `invalid-archive`, `unsafe-path`,
`invalid-entry-metadata`, `too-many-entries`, `entry-too-large`,
`archive-too-large`, `compression-ratio-exceeded`, `size-mismatch`,
`crc-mismatch`, and `decompression-failed`.

Plus ~40 namespace / content-type / relationship constants (`NS_WML`, `NS_PML`,
`NS_SML`, `NS_DRAWINGML`, `REL_IMAGE`, `REL_SLIDE`, `CONTENT_TYPE_DOCX_DOCUMENT`,
`CONTENT_TYPE_PPTX_SLIDE`, `CONTENT_TYPE_XLSX_WORKBOOK`, …).

### Subpath: EPUB

**Import:** `@bendyline/squisq-formats/epub` — EPUB 3 export (no import).
Chapters split at H1/H2 boundaries; images embedded when provided; audio +
`audioSegments` enable EPUB 3 Media Overlays (SMIL).

```ts
function markdownDocToEpub(
  doc: MarkdownDocument,
  options?: EpubExportOptions,
): Promise<ArrayBuffer>;
function docToEpub(doc: Doc, options?: EpubExportOptions): Promise<ArrayBuffer>;

interface EpubExportOptions {
  title?: string; // default 'Untitled'
  author?: string;
  description?: string;
  language?: string; // BCP-47, default 'en'
  publisher?: string;
  themeId?: string;
  themeRegistry?: ThemeRegistry;
  images?: Map<string, ArrayBuffer>;
  coverImage?: ArrayBuffer; // JPEG or PNG
  audio?: Map<string, ArrayBuffer>;
  audioSegments?: AudioSegment[];
  totalDuration?: number;
}
```

### Subpath: PPTX

**Import:** `@bendyline/squisq-formats/pptx`

PPTX export and import are both implemented. Import reads slide order from
`ppt/presentation.xml`, converting each slide's title, body (as a bullet list),
and tables (`<a:tbl>`).

**Slide-image extraction (v1.5):** import can now extract slide-level embedded
images — the bitmaps referenced by a slide's `<p:pic>` shapes — into `images/`
as image nodes. `pptxToContainer` returns a `ContentContainer` with those files
and forces `extractImages: true`; `pptxToMarkdownDoc` leaves it off by default
(so the markdown never carries dangling image references with no backing
container). Honest limits: only slide-level `<p:pic>` bitmaps are extracted —
**layout/master images, charts, SmartArt, and picture-fills are not**.

```ts
function markdownDocToPptx(
  doc: MarkdownDocument,
  options?: PptxExportOptions,
): Promise<ArrayBuffer>;
function docToPptx(doc: Doc, options?: PptxExportOptions): Promise<ArrayBuffer>;
function pptxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options?: PptxImportOptions,
): Promise<MarkdownDocument>;
function pptxToDoc(data: ArrayBuffer | Blob, options?: PptxImportOptions): Promise<Doc>;
function pptxToContainer(
  data: ArrayBuffer | Blob,
  options?: PptxImportOptions,
): Promise<ContentContainer>; // forces extractImages: true

interface PptxExportOptions {
  title?: string;
  author?: string;
  description?: string;
  slideBreak?: 'h1' | 'h2' | 'heading'; // default 'h2'
  defaultFont?: string; // default 'Calibri'
  defaultFontSize?: number; // default 18
  themeId?: string;
  themeRegistry?: ThemeRegistry;
  images?: Map<string, ArrayBuffer>;
}
interface PptxImportOptions {
  extractImages?: boolean; // default false (pptxToMarkdownDoc); forced true in pptxToContainer
}
```

### Subpath: CSV

**Import:** `@bendyline/squisq-formats/csv` — a self-contained RFC-4180
converter (not OOXML). Both directions are implemented. Import produces a
single-table `MarkdownDocument`; export serializes **one** table node — the
first by default, or `options.tableIndex` (zero-based) to select another. An
explicit out-of-range `tableIndex` throws; a table-less document exports to an
empty string.

```ts
function parseCsv(text: string, delimiter?: string): string[][]; // default ','
function csvToMarkdownDoc(
  data: ArrayBuffer | Blob | string,
  options?: CsvImportOptions,
): Promise<MarkdownDocument>;
function csvToDoc(data: ArrayBuffer | Blob | string, options?: CsvImportOptions): Promise<Doc>;
function markdownDocToCsv(doc: MarkdownDocument, options?: CsvExportOptions): string;

interface CsvImportOptions {
  delimiter?: string;
  hasHeader?: boolean;
} // defaults ',' , true
interface CsvExportOptions {
  delimiter?: string; // default ','
  tableIndex?: number; // default 0 (first table)
}
```

### Subpath: XLSX

**Import:** `@bendyline/squisq-formats/xlsx` — both directions are implemented
(v1.5). Export is **tables-only fidelity**: every markdown `table` node becomes
one worksheet, named after the nearest preceding heading (auto-named
`Sheet1`, `Sheet2`, … otherwise; sheet names are sanitized and capped at 31
chars). All non-table content is dropped. Cells matching a plain-number pattern
are written as numeric cells; everything else as inline strings. A document with
no tables yields a single empty (but valid, openable) sheet — export never
throws. Import turns each worksheet grid back into a markdown table.

> **v1.5 breaking:** `markdownDocToXlsx` / `docToXlsx` now return
> `Promise<ArrayBuffer>` (previously `Promise<Blob>`, and previously threw
> `"XLSX export is not yet implemented"`).

```ts
function xlsxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options?: XlsxImportOptions,
): Promise<MarkdownDocument>;
function xlsxToDoc(data: ArrayBuffer | Blob, options?: XlsxImportOptions): Promise<Doc>;
function markdownDocToXlsx(
  doc: MarkdownDocument,
  options?: XlsxExportOptions,
): Promise<ArrayBuffer>;
function docToXlsx(doc: Doc, options?: XlsxExportOptions): Promise<ArrayBuffer>;

interface XlsxImportOptions {
  sheet?: number | string; // 0-based index or sheet name; default: all sheets
}
interface XlsxExportOptions {
  title?: string; // core properties
  author?: string; // core properties
  sheetNamePrefix?: string; // default 'Sheet' — used when no heading precedes a table
}
```

### Subpath: HTML

**Import:** `@bendyline/squisq-formats/html` — two families: the interactive
player export (`docToHtml` / `docToHtmlZip`, which inline `PLAYER_BUNDLE`), and
the static plain-HTML export (`markdownDocToPlainHtml` and bundle variants).
Plus HTML import.

```ts
// Interactive player export
function docToHtml(doc: Doc, options: HtmlExportOptions): string; // single self-contained file
function docToHtmlZip(doc: Doc, options: HtmlZipExportOptions): Promise<Blob>; // multi-file ZIP + audio
function collectImagePaths(doc: Doc): Set<string>;
function inferMimeType(filename: string): string;
function arrayBufferToBase64DataUrl(buffer: ArrayBuffer, mimeType: string): string;
function extractFilename(path: string): string;

interface HtmlExportOptions {
  playerScript: string; // PLAYER_BUNDLE from @bendyline/squisq-react/standalone-source
  images?: Map<string, ArrayBuffer>;
  audio?: Map<string, ArrayBuffer>; // ZIP only
  mode?: 'slideshow' | 'static'; // default 'slideshow'
  title?: string; // default 'Squisq Document'
  autoPlay?: boolean; // default false
  themeId?: string;
  themeRegistry?: ThemeRegistry;
}
interface HtmlZipExportOptions extends HtmlExportOptions {}

// Static plain-HTML export
function markdownDocToPlainHtml(doc: MarkdownDocument, options?: PlainHtmlExportOptions): string;
function markdownDocsToPlainHtmlBundle(options: PlainHtmlBundleOptions): Promise<Blob>;
function markdownDocsToHtmlBundle(options: HtmlBundleOptions): Promise<Blob>; // player-embedded multi-doc bundle
function collectLinkRefs(doc: MarkdownDocument): Set<string>;

// HTML import
function htmlToMarkdownDocSync(html: string, options?: HtmlImportOptions): MarkdownDocument;
function htmlToMarkdownDoc(
  data: ArrayBuffer | Uint8Array | string,
  options?: HtmlImportOptions,
): Promise<MarkdownDocument>;
function htmlToMarkdown(html: string, options?: HtmlImportOptions): string;

interface PlainHtmlExportOptions {
  title?: string;
  images?: Map<string, string>; // src URL → emitted URL
  links?: Map<string, string>; // href URL → emitted URL (e.g. .md → .html)
  theme?: Theme; // wins over themeId, then doc frontmatter themeId
  themeId?: string;
  themeRegistry?: ThemeRegistry;
  iconsCss?: string; // inline FontAwesome CSS instead of a CDN <link>
  htmlPolicy?: HtmlPolicy; // default 'sanitize'
}
interface HtmlImportOptions {
  sanitize?: boolean;
} // default true
```

### Subpath: Container

**Import:** `@bendyline/squisq-formats/container` — `ContentContainer` ↔ ZIP.

```ts
function containerToZip(container: ContentContainer): Promise<Blob>;
function zipToContainer(
  zipData: ArrayBuffer | Uint8Array | Blob,
  options?: ZipSafetyLimits,
): Promise<MemoryContentContainer>;
```

`zipToContainer` skips directories and rejects path-traversal (absolute paths,
backslashes, `..` segments). It applies the same defaults and structured
`ZipSafetyError` contract documented under OOXML above. Reads use JSZip's
incremental stream, enforce per-entry/aggregate actual-byte and compression
ratio bounds while inflating, and release each member cache after the
`MemoryContentContainer` takes its owned copy.

JSZip pause is cooperative: a failure prevents future compressed-input ticks,
while pako may synchronously finish the current tick. Any chunks emitted after
the failure are discarded and are never retained or written.

### Subpath: Registry & `convert()`

**Import:** `@bendyline/squisq-formats/registry` (also re-exported from the
package root). A uniform, format-agnostic front door over every converter.

**Mental model.** Each format is a `FormatDefinition` that knows how to _import_
raw bytes into core's `MarkdownDocument` (the pivot representation) and/or
_export_ a normalized input back out. `convert()` ties it together: it
normalizes any source into a `Doc` (+ `MarkdownDocument` + `ContentContainer`),
optionally applies a theme/transform, then hands off to the target format's
exporter. Every result comes back as the same `ConversionResult` shape —
`bytes` + `mimeType` + `suggestedFilename` + `warnings`. The per-format
functions (`markdownDocToDocx`, `pptxToMarkdownDoc`, …) still exist for direct
use; the registry is the layer that makes them interchangeable. Converter
modules are loaded lazily via `import()`, so pulling in the registry never
eagerly bundles a heavy converter.

```ts
async function convert(
  source: ConvertSource,
  to: FormatId,
  options?: ConvertOptions,
): Promise<ConversionResult>;

type ConvertSource =
  | { kind: 'bytes'; data: ArrayBuffer | Uint8Array; filename?: string }
  | {
      kind: 'markdown';
      markdown: string | MarkdownDocument;
      container?: ContentContainer;
      baseName?: string;
    }
  | { kind: 'doc'; doc: Doc; container?: ContentContainer; baseName?: string };

interface ConvertOptions {
  registry?: FormatRegistry; // defaults to defaultRegistry()
  from?: FormatId; // explicit source format (skips extension/byte sniffing)
  themeId?: string; // applied only when the doc has no theme of its own
  themeRegistry?: ThemeRegistry; // explicit host-owned custom themes
  transformStyle?: TransformStyleInput; // applied before export
  transformRegistry?: TransformStyleRegistry; // resolves custom transform ids
  autoTemplates?: boolean; // content-aware auto-templating when deriving a Doc from markdown
  title?: string; // title hint for exporters that support one (epub, html)
  resolvePlayerScript?: () => Promise<string>; // required for player-embedding HTML export
  formatOptions?: Record<FormatId, Record<string, unknown>>; // per-format escape hatch
}

interface ConversionResult {
  bytes: Uint8Array;
  mimeType: string;
  suggestedFilename: string; // `<baseName>.<ext>`
  warnings: string[]; // non-fatal notes (may be empty)
}

// Format definitions + registry
interface FormatDefinition {
  id: FormatId;
  label: string;
  mimeType: string;
  extensions: readonly string[];
  importDoc?(data: ArrayBuffer, options: ConvertOptions): Promise<MarkdownDocument>;
  importContainer?(data: ArrayBuffer, options: ConvertOptions): Promise<ContentContainer>;
  exportDoc?(input: NormalizedInput, options: ConvertOptions): Promise<ConversionResult>;
}
interface FormatRegistry {
  register(def: FormatDefinition): void;
  get(id: FormatId): FormatDefinition | undefined;
  byExtension(ext: string): FormatDefinition | undefined;
  list(): FormatDefinition[];
}
function createRegistry(): FormatRegistry; // empty; register() is last-write-wins by id
function defaultRegistry(): FormatRegistry; // preloaded with every built-in format
function defaultFormats(): FormatDefinition[];

type FormatId = string;
const BUILTIN_FORMAT_IDS: readonly [
  'md',
  'docx',
  'pdf',
  'pptx',
  'xlsx',
  'csv',
  'html',
  'htmlzip',
  'epub',
  'dbk',
];
```

**Errors.** Every failure path throws a structured `ConversionError` with a
stable machine-readable `code` (never string-matched messages) plus an optional
human `hint` and the underlying `cause`.

```ts
type ConversionErrorCode =
  | 'unknown-format' // no format registered for the id
  | 'unsupported-input' // source format is export-only
  | 'unsupported-output' // target format is import-only
  | 'invalid-input' // bytes were not a readable file of the detected kind
  | 'missing-dependency' // a required capability wasn't provided (see below)
  | 'conversion-failed'; // the underlying converter threw

class ConversionError extends Error {
  readonly code: ConversionErrorCode;
  readonly format?: FormatId;
  readonly hint?: string;
}
```

**Player-embedding HTML export (`html` / `htmlzip`).** These entries embed the
standalone player, so they need the player IIFE bundle. Pass `resolvePlayerScript`;
without it `convert()` throws `ConversionError` with `code:
'missing-dependency'` and a hint. The bundle lives in `@bendyline/squisq-react`:

```ts
const result = await convert({ kind: 'markdown', markdown: src }, 'html', {
  resolvePlayerScript: () =>
    import('@bendyline/squisq-react/standalone-source').then((m) => m.PLAYER_BUNDLE),
});
```

Byte sources are format-sniffed by magic bytes + filename extension (`%PDF`,
the ZIP magic — with `[Content_Types].xml` disambiguating docx/pptx/xlsx vs a
`.dbk` container — else assumed UTF-8 markdown); pass `from` to skip sniffing.

---

## `@bendyline/squisq-editor-react`

Rich markdown editor shell with Raw (Monaco), WYSIWYG (Tiptap), Preview, and
block/timeline layouts, plus an image editor and browser recorder.

**Import:** `@bendyline/squisq-editor-react`
**Styles:** `@bendyline/squisq-editor-react/styles`
**Peer dependencies:** `react`, `react-dom`, and `monaco-editor` (**optional** —
only needed if you use the Raw/Monaco editor surface; the WYSIWYG and Preview
views work without it).

### `EditorShell`

The top-level component. Its props interface is large; the notable props:

> **v1.5 breaking:** the shell's `theme` prop is now `colorScheme` (type
> `EditorTheme` → `EditorColorScheme`). It picks the editor chrome's light/dark
> UI, distinct from the document `Theme`. `RawEditor`'s own `theme` prop was
> likewise renamed to `monacoTheme`.

```ts
interface EditorShellProps {
  initialMarkdown?: string; // default ''
  initialView?: EditorView; // default 'wysiwyg'
  articleId?: string; // default 'untitled'
  basePath?: string; // default '/'
  onChange?: (source: string) => void;
  colorScheme?: EditorColorScheme; // 'light' | 'dark', default 'light'
  className?: string;
  height?: string; // default '100vh'
  minHeight?: string; // set min+max → auto-grow mode
  maxHeight?: string;
  // Content container & media
  mediaProvider?: MediaProvider | null; // enables the Files panel
  workspaceContainer?: ContentContainer | null; // doc folder: audio map, versions, siblings, sidecars
  showFilesToggle?: boolean; // default: true when mediaProvider was passed
  // Versioning
  allowVersioning?: boolean; // default false
  versionBasename?: string;
  versioningPrunePolicy?: PrunePolicy; // default keep-last-50
  versioningAutoSaveIdleMs?: number; // default 5000; 0 disables
  onSaveVersion?: (result: SaveVersionResult) => void;
  // Recording, mentions, links
  allowRecording?: boolean; // default true (needs mediaProvider)
  mentionProvider?: MentionProvider | null;
  documentLinkProvider?: DocumentLinkProvider | null;
  // Panels & layout
  inlinePreview?: boolean;
  inlinePreviewWidth?: number; // default 320
  outline?: boolean;
  outlineWidth?: number; // omit → responsive 260–460px
  showStatusBar?: boolean; // default true
  showPlayTab?: boolean; // default true
  blockTags?: boolean; // default true
  imageDisplayMode?: ImageDisplayMode; // 'inline' (default) | 'thumbnail'
  thinMargins?: boolean;
  fullWidth?: boolean;
  // File-kind / read-only / image mode
  fileName?: string;
  language?: string;
  readOnly?: boolean;
  imageSrc?: string;
  imageAlt?: string;
  imageMode?: 'view' | 'edit';
  imageEditorContainer?: ContentContainer;
  onImageExport?: (blob: Blob, format: 'png' | 'jpeg' | 'webp') => void;
  // Theming & view preferences
  themeInheritance?: ThemeInheritance; // default 'fonts'
  themeOverride?: Theme | null;
  uxFont?: string; // font stack for the editor chrome (toolbar/tabs/status bar)
  viewPreferences?: ViewPreferences;
  onViewPreferencesChange?: (prefs: ViewPreferences) => void;
  // Toolbar slots & chat-composer mode
  toolbarSlotLeft?: ReactNode;
  toolbarSlotAfterActions?: ReactNode;
  toolbarSlotRight?: ReactNode;
  placeholder?: string;
  submitOnEnter?: () => void;
}
```

### Context

```ts
function EditorProvider(props: EditorProviderProps): JSX.Element;
function useEditorContext(): EditorContextValue; // markdown/doc state, theme, versioning, insertion helpers

type EditorView = 'raw' | 'wysiwyg' | 'preview';
type EditorColorScheme = 'light' | 'dark'; // v1.5: renamed from `EditorTheme`
type EditorMode = 'markdown' | 'code' | 'image';
type LayoutMode = 'document' | 'block' | 'timeline';
type ThemeInheritance = 'none' | 'fonts' | 'fonts-colors';
```

`EditorContextValue` is flat — it extends `EditorState` (e.g. `markdownSource`,
`markdownDoc`, `doc`, `activeView`, `parseError`) and `EditorActions` (e.g.
`setMarkdownSource`, `setEditorSource`, `setActiveView`, `setLayoutMode`), plus
the live `tiptapEditor` / `monacoEditor` instances.

### Individual editors & panels

`RawEditor` (Monaco), `WysiwygEditor` (Tiptap), `PreviewPanel`,
`PlainHtmlPreview`, `Toolbar`, `StatusBar`, `ViewSwitcher`, `ViewMenuPanel`,
`OutlinePanel`, `MediaBin`, `TooltipLayer`, `FolderView`, plus:

- `PreviewSettingsProvider`, `PreviewToolbarControls`, `usePreviewSettings`
- `ThemePicker`, `ThemeCustomizerPanel`, `TemplatePicker`, `templateLabel`
- `TransitionPicker` + catalog (`TRANSITION_GROUPS`, `TRANSITION_ENTRIES`, `transitionLabel`, `findTransitionEntry`)
- `DocumentSettingsDialog`, `LinkDialog`, `EmojiPicker` (+ `PICKER_CATEGORIES`, `ALL_PICKER_ENTRIES`, `searchPickerEntries`)
- `VersionHistoryPanel`, `InlinePreviewGutter`, `DropZoneOverlay`, `BlockPropertiesPopover`
- `JsonEditor` — editable form for JSON bound to a Squisq-annotated schema (embeds `WysiwygEditor` for `richtext`)

`RawEditor` takes a `monacoTheme?: string` prop (default `'vs'`; accepts
Monaco's built-in ids `'vs'` / `'vs-dark'` / `'hc-black'`, transparently mapped
to Squisq-tinted variants, or a host-defined Monaco theme) — distinct from the
shell's `colorScheme`.

### Monaco loader & custom theme / template providers

```ts
// Share the load-once Monaco bootstrap when embedding RawEditor-like surfaces.
function useMonacoLoader(): UseMonacoLoaderResult;

// Custom themes — provider stack over doc frontmatter + a browser-local library.
function CustomThemeProvider(props: CustomThemeProviderProps): JSX.Element;
function useCustomThemes(): CustomThemeContextValue;
function useDocCustomThemes(): DocCustomThemes;

// Custom templates — the parallel provider stack.
function CustomTemplateProvider(props: CustomTemplateProviderProps): JSX.Element;
function useCustomTemplates(): CustomTemplateContextValue;
function useDocCustomTemplates(): DocCustomTemplates;
```

### Block-at-a-time / Timeline primitives

Reusable over any `(source, setSource)` pair, no `EditorShell` dependency:

```ts
function useBlockNavigator(
  source: string,
  setSource: (s: string) => void,
  opts?: { enabled?: boolean },
): BlockNavigator;
function BlockCardView(props: BlockCardViewProps): JSX.Element;
function TimelineTrack(props: TimelineTrackProps): JSX.Element;

// pure source-slicing
function getBlockSlices(fullSource: string): BlockSlice[];
function spliceBlock(fullSource: string, range: BlockRange, newText: string): string;
function lineToOffset(source: string, line: number): number;
function offsetToLine(source: string, offset: number): number;
function sliceIndexAtOffset(slices: BlockSlice[], offset: number): number;

// line-level write-back for timeline edits
function formatSeconds(seconds: number): string;
function setBlockDurationInSource(source: string, line: number, seconds: number): string | null;
function setMediaClipInSource(source: string, line: number, patch: MediaClipPatch): string | null;
```

Plus block-property (Pandoc-attr) read/write helpers used by
`BlockPropertiesPopover`: `readBlockAttrsParams`, `readBlockAttrsValue`,
`setBlockAttrsValue`, and `summarizeBlockProps` — and heading-transition
read/write helpers used by `TransitionPicker`: `readHeadingLineTransition`,
`setHeadingLineTransition`, `readBlockAttrsTransition`,
`setHeadingAttrsTransition`, and the `EMPTY_TRANSITION` constant
(`HeadingTransitionAttrs` / `TransitionFields` types).

### File-kind & drag-and-drop

```ts
function resolveFileKind(fileName?: string, language?: string): FileKind; // { mode: 'markdown'|'code'|'image'; language }
function detectLanguageFromFileName(fileName: string): string | null;

function useFileDrop(opts: {
  onDrop: (files: File[], target: DropTarget) => void;
  enabled?: boolean;
}): UseFileDropResult;
function classifyFile(file: { name: string; type: string }): FileCategory; // 'media'|'text'|'unknown'
function partitionFiles(files: File[]): { media: File[]; text: File[] };
```

Plus `processMediaFiles`, `processTextFile`, and `processTextFiles` — upload
dropped media into a `MediaProvider` / read dropped text files into strings.

### Bridge & Tiptap extensions

```ts
function markdownToTiptap(markdown: string): string; // markdown → Tiptap HTML
function tiptapToMarkdown(html: string): string; // Tiptap HTML → markdown
function buildPreviewDoc(doc: Doc): Doc; // shared block-flattening builder (parsed doc → preview slides)

const HeadingWithTemplate: Extension; // recognises `{[tpl key=value]}` in headings, round-trips
```

### Diagram editor

ASCII `diagram` fences are the authored format. `AsciiDiagramExtension` mounts
an interactive `AsciiDiagramWidget` over qualifying fences while keeping the
fence text as the source of truth. The public surface includes
`DiagramCanvas`, `DiagramCommand`, `DiagramData`, `DiagramNode`, `DiagramEdge`,
`useAsciiDiagramData`, `asciiDiagramToCanvas`, `applyAsciiDiagramCommand`,
`replaceAsciiFenceText`, the pure node/edge operations, paste gate, and
position/source-visibility helpers. The obsolete React Flow-derived
`DiagramRFNode` / `DiagramRFEdge` names were removed.

Legacy heading-based `{[diagram]}` documents still render through core, but
their former `DiagramExtension`, `DiagramWidget`, `useDiagramData`, and heading
command exports are no longer an editable canvas API.

### Recorder (`src/recorder`)

`RecorderModal`, `RecorderButton`, `RecorderPanel` — configure-and-capture UI
built on `MediaRecorder` + `getUserMedia`/`getDisplayMedia`.

```ts
function useMediaRecorder(options?: UseMediaRecorderOptions): UseMediaRecorderResult; // source defaults to 'mic'
function useStreamPreview(stream: MediaStream | null): RefObject<HTMLVideoElement>;
function getCaptureKind(source: RecorderSource): CaptureKind;

function requestMicStream(): Promise<MediaStream>;
function requestCameraStream(options?: CameraStreamOptions): Promise<MediaStream>;
function requestScreenStream(options?: ScreenStreamOptions): Promise<ScreenStreamHandle>; // optional mic mix

function resolveFormat(kind: CaptureKind): ResolvedFormat;
function supportsMediaRecorder(): boolean;
function supportsUserMedia(): boolean;
function supportsDisplayMedia(): boolean;
function buildFilename(kind: CaptureKind, format: ResolvedFormat): string;

// narration timing sidecar (so resolveAudioMapping auto-links the recording)
function buildTimingJson(sourceText: string, durationSec: number): TimingJson;
function encodeTimingJson(timing: TimingJson): Uint8Array;
function timingPathFor(audioRelativePath: string): string; // `${path}.timing.json`
```

### Image editor

`ImageEditor`, `ImageViewer`, `useImageEditor`, `imageEditorReducer`,
`initialImageEditorState`, plus state types `ImageEditorState`,
`ImageEditorAction`, `ImageEditorTool`, `CanvasRect`. Pairs with the
`<basename>_files/` sidecar convention and `core/imageEdit`.

---

## `@bendyline/squisq-video`

Cross-runtime render-HTML, timeline, and quality helpers plus a browser-only
ffmpeg.wasm encoder. Node video export uses `framesToMp4Native` or
`framesToMp4NativeBytes` from `@bendyline/squisq-cli/api`.

**Import:** `@bendyline/squisq-video`

```ts
// Generate a self-contained HTML page that mounts the standalone player in
// renderMode (images/audio embedded as base64 data URIs). Headless callers use
// SquisqPlayer.getHandle(root).renderAPI for frame capture.
function generateRenderHtml(doc: Doc, options: RenderHtmlOptions): string;

// Encode PNG frame screenshots in a browser runtime via ffmpeg.wasm
// (H.264 + optional AAC). Throws a clear unsupported-runtime error in Node.
function framesToMp4Wasm(
  frames: Uint8Array[],
  audio: Uint8Array | null,
  options?: VideoExportOptions,
): Promise<EncoderResult>;
interface FfmpegWasmLoadConfig {
  coreURL?: string;
  wasmURL?: string;
  workerURL?: string;
  classWorkerURL?: string;
}

function resolveDimensions(options: VideoExportOptions): { width: number; height: number };
function validateVideoExportOptions(options: VideoExportOptions): void;
const fetchFile: typeof import('@ffmpeg/util').fetchFile; // re-export

// Target H.264 bitrate = width * height * preset.bitsPerPixel. Single source of
// truth shared by every WebCodecs encode path (draft/normal/high → 2/4/8 bpp).
function bitrateForQuality(q: VideoQuality, width: number, height: number): number;

// AAC mux flags that pad short audio before `-shortest`, preserving the full
// video timeline while trimming narration that runs beyond it.
function ffmpegAudioMuxArgs(bitrate: string | number): string[];

const QUALITY_PRESETS: Record<VideoQuality, QualityPreset>; // draft/normal/high → ffmpeg preset + crf + bitsPerPixel + audioBitrate
const ORIENTATION_DIMENSIONS: Record<VideoOrientation, { width: number; height: number }>;

type VideoQuality = 'draft' | 'normal' | 'high';
type VideoOrientation = 'landscape' | 'portrait';
interface QualityPreset {
  preset: string; // ffmpeg -preset (ultrafast / medium / slow)
  crf: number; // ffmpeg -crf (28 / 23 / 18)
  bitsPerPixel: number; // WebCodecs bitrate targeting (2 / 4 / 8)
  audioBitrate: number; // target AAC bits/sec (96k / 128k / 192k)
}
interface EncoderResult {
  data: Uint8Array;
  duration: number;
}

// Flatten a doc's narration + timed-media audio into absolute-timed clips.
// Pure and Node-testable; the single source of truth the browser MP4 export
// uses to place audio (and the exact schedule math the CLI mix path replicates).
// `coverPreRoll` (default 0) shifts every start to keep audio in sync with a
// silent cover pre-roll. Returns [] for a doc with no audio.
function computeAudioTimeline(doc: Doc, coverPreRoll?: number): AudioTimelineClip[];
interface AudioTimelineClip {
  src: string; // path relative to the doc's media dir (mp3/webm/mp4/…)
  startSec: number; // absolute second on the export timeline
  sourceInSec: number; // in-point within the source file
  durationSec: number; // trimmed played length
}

interface VideoExportOptions {
  fps?: number; // default 30
  width?: number; // default per orientation
  height?: number;
  quality?: VideoQuality; // default 'normal'
  orientation?: VideoOrientation; // default 'landscape'
  onProgress?: (percent: number, phase: string) => void;
}

interface RenderHtmlOptions {
  playerScript: string; // PLAYER_BUNDLE IIFE source
  images?: Map<string, ArrayBuffer>;
  audio?: Map<string, ArrayBuffer>;
  width?: number; // default 1920
  height?: number; // default 1080
  captionStyle?: 'standard' | 'social';
}
```

---

## `@bendyline/squisq-video-react`

React components for browser-based video export (WebCodecs primary, ffmpeg.wasm
worker fallback). Depends on `@bendyline/squisq-video`, `@bendyline/squisq-react`,
`mp4-muxer`, and `html2canvas`.

**Import:** `@bendyline/squisq-video-react`

**v1.5:** the browser MP4 export now muxes an **audio** track (narration + timed
media) — previously the exported video was silent. Audio problems never fail the
export; the video always completes and the result reports whether audio made it
in (see `audioIncluded` / `audioSkippedReason` below). `playerScript` is now
**optional** on every surface — the browser path captures frames from a live
in-page `DocPlayer`, so the IIFE bundle is only forwarded for CLI/Playwright-style
pipelines. A new `defaultConfig?: Partial<VideoExportConfig>` prop seeds the
modal's initial settings and is merged as a base into the export config.

### Components

```ts
interface VideoExportButtonProps {
  doc: Doc;
  playerScript?: string; // optional; only for CLI/Playwright pipelines
  mediaProvider?: MediaProvider;
  images?: Map<string, ArrayBuffer>;
  audio?: Map<string, ArrayBuffer>;
  defaultConfig?: Partial<VideoExportConfig>; // seeds + merges into export config
  label?: string; // default 'Export Video'
  style?: React.CSSProperties;
  disabled?: boolean;
}
function VideoExportButton(props: VideoExportButtonProps): JSX.Element;

interface VideoExportModalProps {
  doc: Doc;
  playerScript?: string; // optional; only for CLI/Playwright pipelines
  mediaProvider?: MediaProvider;
  images?: Map<string, ArrayBuffer>;
  audio?: Map<string, ArrayBuffer>;
  defaultConfig?: Partial<VideoExportConfig>; // seeds initial selections; explicit props win
  onClose: () => void;
}
function VideoExportModal(props: VideoExportModalProps): JSX.Element;
```

### Hooks

```ts
function useVideoExport(): VideoExportResult;
function useFrameCapture(): FrameCaptureHandle;

type VideoExportState = 'idle' | 'preparing' | 'capturing' | 'encoding' | 'complete' | 'error';
interface VideoExportConfig {
  quality?: VideoQuality; // default 'normal'
  fps?: number; // default 30
  orientation?: VideoOrientation; // default 'landscape'
  images?: Map<string, ArrayBuffer>;
  audio?: Map<string, ArrayBuffer>;
  mediaProvider?: MediaProvider;
  captionMode?: CaptionMode; // default 'off'
  playerScript?: string; // unused by the browser export path; kept for CLI/Playwright
  ffmpegWasm?: FfmpegWasmLoadConfig; // optional self-hosted fallback assets
}
interface FfmpegWasmLoadConfig {
  coreURL?: string;
  wasmURL?: string;
  workerURL?: string;
  classWorkerURL?: string;
}
interface VideoExportResult {
  state: VideoExportState;
  progress: number;
  phase: string;
  duration: number;
  backend: 'webcodecs' | 'ffmpeg-wasm' | null;
  downloadUrl: string | null;
  fileSize: number;
  audioIncluded: boolean; // whether an audio track was muxed into the MP4
  audioSkippedReason: string | null; // null = doc had no audio; string = a capability/runtime shortfall
  error: string | null;
  elapsed: number;
  estimatedRemaining: number;
  startExport(doc: Doc, config: VideoExportConfig): Promise<void>;
  cancel(): void;
  reset(): void;
}

interface FrameCaptureHandle {
  init(
    doc: Doc,
    renderOptions: Omit<RenderHtmlOptions, 'playerScript'>,
    captionMode?: CaptionMode,
  ): Promise<number>;
  captureFrame(time: number): Promise<ImageBitmap>;
  destroy(): void;
}
```

### Encoder utilities

```ts
function supportsWebCodecs(): boolean; // VideoEncoder/VideoFrame present
function supportsWebCodecsH264(config: EncoderConfig): Promise<boolean>; // H.264 config supported
function supportsWebCodecsAac(sampleRate?: number, channels?: number): Promise<boolean>; // AAC audio encode supported (defaults to the export sample rate / channels)
// EncoderConfig: { width, height, fps, quality }
function createEncoder(config: EncoderConfig): MainThreadEncoder; // throws if WebCodecs unavailable
interface EncoderConfig {
  width: number;
  height: number;
  fps: number;
  quality: VideoQuality;
}
interface MainThreadEncoder {
  encodeFrame(bitmap: ImageBitmap, frameIndex: number): Promise<void>;
  addAudioChunk?(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): Promise<ArrayBuffer>;
  close(): void;
}
```

---

## `@bendyline/squisq-cli`

Command-line tool and programmatic API for converting Squisq documents and
rendering them to MP4.

**Install:** `npm install -g @bendyline/squisq-cli`

### CLI Commands

#### `squisq convert <input>`

Convert a document to one or more formats. Input can now be a **binary**
document as well as markdown: `.md`, `.docx`, `.pptx`, `.pdf`, `.xlsx`, `.csv`,
`.html`, a `.zip`/`.dbk` container, or a folder. Output formats now include
`md`, `xlsx`, `csv`, and `mp4` alongside the originals.

| Option                | Description                                                                      | Default       |
| --------------------- | -------------------------------------------------------------------------------- | ------------- |
| `-o, --output <file>` | **Single** output file; format inferred from its extension                       | —             |
| `-d, --output-dir`    | Output directory (multi-format mode)                                             | same as input |
| `-f, --formats`       | Comma-separated: `docx, pptx, pdf, html, htmlzip, epub, dbk, md, xlsx, csv, mp4` | default set   |
| `-t, --theme`         | Squisq theme id (built-in or in-doc custom)                                      | none          |
| `--transform`         | Transform style before export (documentary, magazine, …)                         | none          |
| `--no-auto-templates` | Disable content-aware auto template picking                                      | (auto on)     |

> **v1.5 breaking flag change:** `-o` is now the **single-file** output
> (`squisq convert in.md -o out.docx`, format inferred from the extension). The
> old `-o` output-**directory** behavior moved to `-d, --output-dir`. `-o`
> cannot be combined with `--formats`. A bare `convert <input>` with no
> `-o`/`--formats` writes a default set to the output dir that
> deliberately excludes `md`/`xlsx`/`csv`/`mp4`.

The `html` / `htmlzip` formats embed the standalone player (static mode); the
`htmlzip` output is written as `<name>.html.zip`. `dbk` re-serializes the input
container as a ZIP.

#### `squisq video <input> [output]`

Render a document to MP4 (Playwright headless frame capture + native ffmpeg
encode). In addition to markdown/container/folder input, accepts a pre-built
Doc as a `.json` file.

| Option                 | Description                                         | Default       |
| ---------------------- | --------------------------------------------------- | ------------- |
| `-o, --output`         | Output MP4 path (also accepted as a positional arg) | `<input>.mp4` |
| `--fps`                | Frames per second (1–120)                           | 30            |
| `--quality`            | draft, normal, or high                              | normal        |
| `--orientation`        | landscape or portrait                               | landscape     |
| `--captions`           | off, standard, or social                            | off           |
| `-t, --theme`          | Squisq theme id to apply                            | none          |
| `--transform`          | Transform style to apply before rendering           | none          |
| `--cover-preroll`      | Seconds of cover-slide pre-roll before the story    | 2             |
| `--width` / `--height` | Dimension overrides                                 | auto          |
| `--no-auto-templates`  | Disable auto template pick                          | (auto on)     |

**Requires:** ffmpeg and Playwright (chromium). ffmpeg is resolved from the
`SQUISQ_FFMPEG` env var, then `PATH`, then an optionally-installed `ffmpeg-static`
package. Run `squisq doctor` to check the toolchain.

#### `squisq doctor`

Preflight check for the video toolchain: reports the resolved ffmpeg path,
version, and which source it came from (env / PATH / `ffmpeg-static`) — with an
actionable install hint when missing — attempts a headless Chromium launch, and
reports the Node version.

#### `squisq validate <input>`

Structurally validate a `.md` file, `.zip`/`.dbk` container, or folder. Reports
unknown templates (with did-you-mean), unparsed `{[…]}`, malformed heading
attributes, unresolved connections, duplicate ids, bad data fences, and missing
asset references — with line numbers.

| Option     | Description                               |
| ---------- | ----------------------------------------- |
| `--json`   | Emit diagnostics as machine-readable JSON |
| `--strict` | Exit non-zero on warnings too             |

Diagnostics are reported at three severities — `error`, `warning`, and `info`
(the info tier is counted and shown separately). Exit codes depend on **errors**
only: `0` clean, warnings-only, or info-only; `1` errors (or any warning with
`--strict`); `2` input unreadable.

### Programmatic API

**Import:** `@bendyline/squisq-cli/api`

The API surfaces a pre-bound `convert()` — a thin wrapper over
`@bendyline/squisq-formats`' `convert()` that injects the CLI's format registry
(every built-in exporter plus the CLI-only `mp4` format) and a default
`resolvePlayerScript` (so HTML/player-embedding exports work out of the box).
Both are overridable via `options`. `createCliRegistry()` returns that same
registry for direct use.

```ts
// Pre-bound convert(): CLI registry (+ mp4) + default player script injected.
function convert(
  source: ConvertSource,
  to: FormatId, // 'docx' | 'pdf' | 'pptx' | 'xlsx' | 'csv' | 'html' | 'epub' | 'md' | 'mp4' | …
  options?: CliConvertOptions,
): Promise<ConversionResult>;
type CliConvertOptions = Omit<ConvertOptions, 'formatOptions'> & {
  formatOptions?: ConvertOptions['formatOptions'] & { mp4?: Mp4FormatOptions };
};
interface Mp4FormatOptions {
  fps?: number;
  quality?: VideoQuality;
  orientation?: VideoOrientation;
  coverPreRoll?: number;
}
function createCliRegistry(): FormatRegistry; // defaultRegistry() + the mp4 exporter
// Re-exports: ConversionError, the ConvertSource/ConvertOptions/ConversionResult/
// FormatId/FormatRegistry/FormatDefinition/NormalizedInput types, plus readInput.

// Encode already-captured PNG frames with native FFmpeg. The bytes variant
// returns the MP4 in memory; the path variant writes directly to outputPath.
function framesToMp4Native(
  ffmpegPath: string,
  frames: Uint8Array[],
  audio: Uint8Array | null,
  outputPath: string,
  options?: VideoExportOptions,
): Promise<void>;
function framesToMp4NativeBytes(
  ffmpegPath: string,
  frames: Uint8Array[],
  audio: Uint8Array | null,
  options?: VideoExportOptions,
): Promise<Uint8Array>;

function renderDocToMp4(
  doc: Doc,
  container: MemoryContentContainer,
  options: RenderDocToMp4Options,
): Promise<RenderDocToMp4Result>;

interface RenderDocToMp4Options {
  outputPath: string;
  fps?: number; // default 30
  quality?: 'draft' | 'normal' | 'high'; // default 'normal'
  orientation?: 'landscape' | 'portrait'; // default 'landscape'
  width?: number;
  height?: number;
  captionStyle?: 'standard' | 'social';
  coverPreRoll?: number; // seconds shown only when a cover exists, default 0
  onProgress?: (phase: string, percent: number) => void;
}
interface RenderDocToMp4Result {
  duration: number;
  frameCount: number;
  outputPath: string;
}

// Extract JPEG thumbnails from the first frame of an MP4.
function extractThumbnails(options: ExtractThumbnailsOptions): Promise<void>;
interface ExtractThumbnailsOptions {
  videoPath: string;
  outputDir: string;
  slug: string;
  sizes: ThumbnailSpec[];
  force?: boolean;
}
interface ThumbnailSpec {
  name: string;
  width: number;
  height: number;
  filter: string;
}

// Read a .md file, .zip/.dbk container, folder, or Doc .json into a container.
function readInput(inputPath: string): Promise<ReadInputResult>;
interface ReadInputResult {
  container: MemoryContentContainer;
  markdownDoc: MarkdownDocument | null; // null when input is a Doc JSON file
  doc?: Doc; // present when input is .json or the container holds doc.json
}

// Re-exports
export { MemoryContentContainer } from '@bendyline/squisq/storage';
export type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
```

`renderDocToMp4` requires Playwright chromium and ffmpeg on PATH.
