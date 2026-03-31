# Squisq API Reference

> Auto-generated reference for the published packages and their subpath exports.

---

## Table of Contents

- [`@bendyline/squisq` (Core)](#bendylinesquisq-core)
  - [Schemas](#subpath-schemas)
  - [Doc](#subpath-doc)
  - [Spatial](#subpath-spatial)
  - [Storage](#subpath-storage)
  - [Markdown](#subpath-markdown)
- [`@bendyline/squisq-react`](#bendylinesquisq-react)
  - [Components](#react-components)
  - [Layers](#react-layers)
  - [Hooks](#react-hooks)
  - [Context & Types](#react-context--types)
  - [Utilities](#react-utilities)
  - [Styles](#react-styles)
- [`@bendyline/squisq-formats`](#bendylinesquisq-formats)
  - [DOCX](#subpath-docx)
  - [PDF](#subpath-pdf)
  - [OOXML](#subpath-ooxml)
  - [PPTX](#subpath-pptx)
  - [XLSX (stub)](#subpath-xlsx-stub)
- [`@bendyline/squisq-editor-react`](#bendylinesquisq-editor-react)
  - [Components](#editor-components)
  - [Context](#editor-context)
  - [Bridge Utilities](#editor-bridge-utilities)
- [`@bendyline/squisq-cli`](#bendylinesquisq-cli)
  - [Programmatic API](#cli-programmatic-api)
  - [CLI Commands](#cli-commands)

---

## `@bendyline/squisq` (Core)

Headless utilities — schemas, templates, spatial math, markdown, and storage. Zero framework dependencies.

### Subpath: Schemas

**Import:** `@bendyline/squisq/schemas`

#### Coordinate & Geometry Types

```ts
interface Coordinates {
  latitude: number;
  longitude: number;
}

interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}
```

#### Doc Types

```ts
interface Doc {
  title?: string;
  blocks: DocBlock[];
  viewport?: ViewportConfig;
  theme?: ThemeColors;
  audio?: AudioConfig;
  metadata?: DocMetadata;
}

type DocBlock = Block | TemplateBlock;

interface Block {
  layers: Layer[];
  duration?: number;
  transition?: BlockTransition;
  notes?: string;
}

interface BlockTransition {
  type: 'fade' | 'slide' | 'none';
  duration?: number; // ms
}

interface DocMetadata {
  author?: string;
  created?: string; // ISO date
  modified?: string; // ISO date
  tags?: string[];
  description?: string;
}

interface AudioConfig {
  src: string;
  syncPoints?: AudioSyncPoint[];
}

interface AudioSyncPoint {
  time: number; // seconds
  blockIndex: number;
}
```

#### Layer Types

```ts
/** Discriminated union of all layer types */
type Layer = ImageLayer | TextLayer | ShapeLayer | MapLayer | VideoLayer | TableLayer;

/** Common fields shared by all layers */
interface BaseLayer {
  position: Position;
  animation?: Animation;
  opacity?: number;
  visible?: boolean;
  zIndex?: number;
}

interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string;
  alt?: string;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none';
}

interface TextLayer extends BaseLayer {
  type: 'text';
  content: string;
  textStyle?: TextStyle;
}

interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: 'rectangle' | 'circle' | 'ellipse' | 'line' | 'polygon';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  points?: Array<{ x: number; y: number }>;
  cornerRadius?: number;
}

interface VideoLayer extends BaseLayer {
  type: 'video';
  videoSrc: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  poster?: string;
}

interface MapLayer extends BaseLayer {
  type: 'map';
  center: Coordinates;
  zoom?: number;
  markers?: MapMarker[];
  mapStyle?: string;
  tileUrl?: string;
  bounds?: BoundingBox;
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

interface TableLayerStyle {
  headerBackground: string;
  headerColor: string;
  cellBackground: string;
  cellColor: string;
  borderColor: string;
  fontSize: number;
  fontFamily?: string;
  headerFontFamily?: string;
  borderRadius?: number;
}

interface Position {
  x: number; // 0–100 percentage
  y: number;
  width: number;
  height: number;
  rotation?: number; // degrees
}

interface TextStyle {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  padding?: number;
  textDecoration?: string;
  fontStyle?: string;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  whiteSpace?: string;
  overflow?: 'visible' | 'hidden' | 'ellipsis';
}

interface Animation {
  type: 'fadeIn' | 'slideIn' | 'zoomIn' | 'typewriter' | 'none';
  duration?: number; // ms
  delay?: number; // ms
  easing?: string;
}

interface MapMarker {
  position: Coordinates;
  label?: string;
  color?: string;
}
```

#### Template Types

```ts
/** Discriminated union — use isTemplateBlock() to narrow */
interface TemplateBlock {
  template: string;
  input: TemplateBlockInput;
  duration?: number;
  transition?: BlockTransition;
  notes?: string;
}

function isTemplateBlock(block: DocBlock): block is TemplateBlock;

type TemplateFunction = (input: TemplateBlockInput, context: TemplateContext) => Layer[];

interface TemplateContext {
  viewport: ViewportConfig;
  theme: ThemeColors;
  blockIndex: number;
  totalBlocks: number;
}
```

##### Built-in Template Block Inputs

| Template            | Key Input Fields                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `titleBlock`        | `title`, `subtitle?`, `backgroundImage?`, `backgroundGradient?`                              |
| `textBlock`         | `heading?`, `body`, `backgroundImage?`                                                       |
| `imageBlock`        | `src`, `alt?`, `caption?`, `objectFit?`                                                      |
| `twoColumnBlock`    | `leftContent`, `rightContent`, `heading?`                                                    |
| `quoteBlock`        | `quote`, `attribution?`, `backgroundImage?`                                                  |
| `statHighlight`     | `value`, `label`, `description?`, `trend?`, `trendDirection?`                                |
| `timelineBlock`     | `events[]` (each: `date`, `title`, `description?`)                                           |
| `comparisonBlock`   | `items[]` (each: `title`, `features[]`), `heading?`                                          |
| `mapBlock`          | `center`, `zoom?`, `markers?`, `tileUrl?`, `heading?`                                        |
| `videoBlock`        | `src`, `poster?`, `caption?`, `autoplay?`, `loop?`                                           |
| `codeBlock`         | `code`, `language?`, `heading?`, `theme?`                                                    |
| `chartBlock`        | `chartType`, `data`, `heading?`, `description?`                                              |
| `bulletListBlock`   | `heading?`, `items[]`, `icon?`, `backgroundImage?`                                           |
| `numberedListBlock` | `heading?`, `items[]`, `startNumber?`                                                        |
| `tableBlock`        | `heading?`, `headers[]`, `rows[][]`                                                          |
| `calloutBlock`      | `type` (`info`/`warning`/`success`/`error`), `heading?`, `body`                              |
| `dividerBlock`      | `style?` (`solid`/`dashed`/`dotted`/`gradient`), `color?`                                    |
| `videoWithCaption`  | `videoSrc`, `videoAlt`, `clipStart`, `clipEnd`, `caption?`, `captionPosition?`, `posterSrc?` |
| `videoPullQuote`    | `text`, `attribution?`, `backgroundVideo` (with `src`, `clipStart`, `clipEnd`)               |
| `dataTable`         | `title?`, `headers[]`, `rows[][]`, `align?`, `colorScheme?`                                  |

> All template inputs extend a common `TemplateBlockInput` base with optional `backgroundGradient`, `backgroundImage`, and `backgroundColor`.

#### Viewport & Theme

```ts
interface ViewportConfig {
  width: number; // Default: 1920
  height: number; // Default: 1080
  aspectRatio?: string; // e.g. '16:9'
  responsive?: boolean;
}

interface ThemeColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  surface?: string;
  text?: string;
  textSecondary?: string;
  border?: string;
  error?: string;
  success?: string;
  warning?: string;
}
```

#### Layout & Media

```ts
interface LayoutHints {
  strategy?: LayoutStrategy;
  columns?: number;
  gap?: number;
  padding?: number;
}

type LayoutStrategy = 'absolute' | 'stack-vertical' | 'stack-horizontal' | 'grid' | 'flow';

interface MediaProvider {
  resolveUrl(src: string): string | Promise<string>;
}
```

#### Persistent Layer Types

```ts
interface PersistentLayer extends Layer {
  scope: 'global' | 'range';
  startBlock?: number;
  endBlock?: number;
}
```

#### Schema Constants & Helpers

```ts
const DEFAULT_VIEWPORT: ViewportConfig; // { width: 1920, height: 1080 }
const DEFAULT_THEME: ThemeColors;
const DEFAULT_ANIMATION_DURATION: number; // 500
const DEFAULT_BLOCK_DURATION: number; // 5000

function createDoc(overrides?: Partial<Doc>): Doc;
function createBlock(overrides?: Partial<Block>): Block;
function createLayer(type: Layer['type'], overrides?: Partial<Layer>): Layer;
function createTextLayer(content: string, position: Position, style?: Partial<TextStyle>): Layer;
function createImageLayer(src: string, position: Position, alt?: string): Layer;
function createPosition(overrides?: Partial<Position>): Position;
```

---

### Subpath: Doc

**Import:** `@bendyline/squisq/doc`

#### Doc ↔ Markdown Conversion

```ts
function markdownToDoc(markdown: string): Doc;
function docToMarkdown(doc: Doc): string;
```

#### Template Resolution

```ts
function getLayers(block: DocBlock, context: TemplateContext): Layer[];
function expandDocBlocks(doc: Doc): Block[];
```

> `getLayers` resolves a `TemplateBlock` through its template function, or returns a plain `Block`'s layers directly.
> `expandDocBlocks` converts every block in a doc to a plain `Block` by evaluating templates against the doc's viewport/theme.

#### Template Registry

```ts
function registerTemplate(name: string, fn: TemplateFunction): void;
function getTemplate(name: string): TemplateFunction | undefined;
function getTemplateNames(): string[];
```

All 17 built-in templates are registered at import time. Custom templates can be added via `registerTemplate`.

#### Animation Utilities

```ts
function getAnimationCSS(animation: Animation, index: number): string;
function getBlockAnimationDelay(blockIndex: number, layerIndex: number): number;
```

---

### Subpath: Spatial

**Import:** `@bendyline/squisq/spatial`

```ts
function haversineDistance(
  point1: Coordinates,
  point2: Coordinates,
  unit?: 'km' | 'miles' | 'meters' | 'feet',
): number;

function geohashEncode(latitude: number, longitude: number, precision?: number): string;
function geohashDecode(hash: string): { latitude: number; longitude: number };
function geohashNeighbor(hash: string, direction: [number, number]): string;
function geohashNeighbors(hash: string): string[];
function geohashBBox(hash: string): [number, number, number, number];
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

class MemoryStorageAdapter implements StorageAdapter {
  /* in-memory Map */
}
class LocalStorageAdapter implements StorageAdapter {
  /* window.localStorage */
}
class LocalForageAdapter implements StorageAdapter {
  /** Wraps a localforage-compatible instance */
  constructor(store: LocalForageLike);
}
```

---

### Subpath: Markdown

**Import:** `@bendyline/squisq/markdown`

#### Parse & Stringify

```ts
function parseMarkdown(source: string, options?: MarkdownParseOptions): MarkdownDocument;
function stringifyMarkdown(doc: MarkdownDocument, options?: MarkdownStringifyOptions): string;

interface MarkdownParseOptions {
  gfm?: boolean; // Default: true — GitHub Flavored Markdown tables, strikethrough, etc.
}

interface MarkdownStringifyOptions {
  bullet?: '-' | '*' | '+'; // Default: '-'
  listItemIndent?: 'one' | 'tab'; // Default: 'one'
  emphasis?: '_' | '*'; // Default: '*'
  strong?: '__' | '**'; // Default: '**'
  rule?: '-' | '_' | '*'; // Default: '-'
}
```

#### AST Types

```ts
interface MarkdownDocument {
  type: 'root';
  children: MarkdownNode[];
  metadata?: Record<string, unknown>; // YAML frontmatter
}

type MarkdownNode =
  | HeadingNode
  | ParagraphNode
  | TextNode
  | EmphasisNode
  | StrongNode
  | InlineCodeNode
  | CodeBlockNode
  | BlockquoteNode
  | ListNode
  | ListItemNode
  | LinkNode
  | ImageNode
  | ThematicBreakNode
  | HtmlNode
  | TableNode
  | TableRowNode
  | TableCellNode
  | DeleteNode
  | BreakNode
  | TemplateAnnotationNode;

interface HeadingNode {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: MarkdownNode[];
}
interface ParagraphNode {
  type: 'paragraph';
  children: MarkdownNode[];
}
interface TextNode {
  type: 'text';
  value: string;
}
interface EmphasisNode {
  type: 'emphasis';
  children: MarkdownNode[];
}
interface StrongNode {
  type: 'strong';
  children: MarkdownNode[];
}
interface InlineCodeNode {
  type: 'inlineCode';
  value: string;
}
interface CodeBlockNode {
  type: 'code';
  value: string;
  lang?: string;
  meta?: string;
}
interface BlockquoteNode {
  type: 'blockquote';
  children: MarkdownNode[];
}
interface ListNode {
  type: 'list';
  ordered: boolean;
  start?: number;
  children: ListItemNode[];
}
interface ListItemNode {
  type: 'listItem';
  children: MarkdownNode[];
  checked?: boolean;
}
interface LinkNode {
  type: 'link';
  url: string;
  title?: string;
  children: MarkdownNode[];
}
interface ImageNode {
  type: 'image';
  url: string;
  alt?: string;
  title?: string;
}
interface ThematicBreakNode {
  type: 'thematicBreak';
}
interface HtmlNode {
  type: 'html';
  value: string;
}
interface TableNode {
  type: 'table';
  align?: Array<'left' | 'center' | 'right' | null>;
  children: TableRowNode[];
}
interface TableRowNode {
  type: 'tableRow';
  children: TableCellNode[];
}
interface TableCellNode {
  type: 'tableCell';
  children: MarkdownNode[];
}
interface DeleteNode {
  type: 'delete';
  children: MarkdownNode[];
}
interface BreakNode {
  type: 'break';
}
interface TemplateAnnotationNode {
  type: 'templateAnnotation';
  template: string;
  attributes: Record<string, string>;
}
```

#### Tree Utilities

```ts
function walkMarkdownTree(node: MarkdownNode, visitor: (node: MarkdownNode) => void): void;
function findNodes(root: MarkdownDocument, type: string): MarkdownNode[];
function getTextContent(node: MarkdownNode): string;
```

#### HTML Parsing

```ts
function htmlToMarkdownDoc(html: string): MarkdownDocument;
function markdownDocToHtml(doc: MarkdownDocument): string;
```

---

## `@bendyline/squisq-react`

React component library for rendering docs, blocks, and controls. Depends on `@bendyline/squisq` (core).

**Import:** `@bendyline/squisq-react`  
**Styles:** `@bendyline/squisq-react/styles`

### React Components

#### `DocPlayer`

Main document player. Renders a doc as a slideshow or continuous scroll.

```ts
interface DocPlayerProps {
  doc: Doc;
  width?: number | string;
  height?: number | string;
  autoplay?: boolean; // Default: false
  loop?: boolean; // Default: false
  showControls?: boolean; // Default: true
  controlsVariant?: 'overlay' | 'bottom' | 'sidebar' | 'slideshow';
  className?: string;
  style?: React.CSSProperties;
  onBlockChange?: (index: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  mediaProvider?: MediaProvider;
  initialBlock?: number;
}
```

#### `BlockRenderer`

SVG-based renderer for a single block.

```ts
interface BlockRendererProps {
  block: DocBlock;
  viewport: ViewportConfig;
  theme?: ThemeColors;
  blockIndex?: number;
  totalBlocks?: number;
  className?: string;
  mediaProvider?: MediaProvider;
}
```

#### `CaptionOverlay`

Displays block notes/captions as a translucent overlay.

```ts
interface CaptionOverlayProps {
  text: string;
  position?: 'top' | 'bottom';
  visible?: boolean;
  className?: string;
}
```

#### `DocProgressBar`

Block progress indicator.

```ts
interface DocProgressBarProps {
  current: number;
  total: number;
  onSeek?: (index: number) => void;
  className?: string;
}
```

#### Control Components

| Component              | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `DocControlsOverlay`   | Floating play/pause, prev/next over the player      |
| `DocControlsBottom`    | Bottom bar with progress, play/pause, block counter |
| `DocControlsSidebar`   | Side panel with block thumbnails                    |
| `DocControlsSlideshow` | Minimal slideshow controls (arrows + counter)       |

All accept `className?: string` and receive playback state via context.

#### `DocPlayerWithSidebar`

Composite component combining `DocPlayer` with `DocControlsSidebar`.

#### `LinearDocView`

Renders all doc blocks vertically in a scrollable layout.

```ts
interface LinearDocViewProps {
  doc: Doc;
  basePath?: string;
  viewport?: ViewportConfig;
  className?: string;
  theme?: Theme;
}
```

Renders template-annotated blocks as SVG cards using `getLayers()`, preserving heading hierarchy in a scrollable layout.

#### `MarkdownRenderer`

Renders a markdown string or `MarkdownDocument` as React elements.

```ts
interface MarkdownRendererProps {
  source?: string;
  doc?: MarkdownDocument;
  className?: string;
}
```

### React Layers

Layer components used internally by `BlockRenderer`. Can be used standalone for custom rendering.

| Component    | Props Summary                                                        |
| ------------ | -------------------------------------------------------------------- |
| `ImageLayer` | `layer: Layer`, `viewport: ViewportConfig`, `mediaProvider?`         |
| `TextLayer`  | `layer: Layer`, `viewport: ViewportConfig`                           |
| `ShapeLayer` | `layer: Layer`, `viewport: ViewportConfig`                           |
| `VideoLayer` | `layer: Layer`, `viewport: ViewportConfig`, `mediaProvider?`         |
| `MapLayer`   | `layer: Layer`, `viewport: ViewportConfig`                           |
| `TableLayer` | `layer: TableLayer`, `viewport: ViewportConfig`, `blockTime: number` |

### React Hooks

#### `useDocPlayback`

Manages block-by-block playback state.

```ts
function useDocPlayback(doc: Doc, options?: PlaybackOptions): PlaybackState & PlaybackActions;

interface PlaybackOptions {
  autoplay?: boolean;
  loop?: boolean;
  initialBlock?: number;
}

interface PlaybackState {
  currentBlock: number;
  isPlaying: boolean;
  totalBlocks: number;
  progress: number; // 0–1 within current block
}

interface PlaybackActions {
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  previous(): void;
  goToBlock(index: number): void;
}
```

#### `useAudioSync`

Synchronises playback with an audio track.

```ts
function useAudioSync(audioConfig?: AudioConfig): {
  audioRef: React.RefObject<HTMLAudioElement>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  play(): void;
  pause(): void;
  seek(time: number): void;
  getBlockForTime(time: number): number;
};
```

#### `useViewportOrientation`

Returns `'landscape' | 'portrait'` based on container or window size.

```ts
function useViewportOrientation(
  containerRef?: React.RefObject<HTMLElement>,
): 'landscape' | 'portrait';
```

### React Context & Types

#### `MediaContext`

```ts
const MediaContext: React.Context<MediaProvider | null>;

function AudioProvider(props: { config: AudioConfig; children: ReactNode }): JSX.Element;
```

### React Utilities

```ts
// Re-exported from @bendyline/squisq/doc
function getAnimationCSS(animation: Animation, index: number): string;
function getBlockAnimationDelay(blockIndex: number, layerIndex: number): number;

// Map tile helpers
function getTileUrl(x: number, y: number, z: number, template?: string): string;
function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number };
function tileToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number };
```

### React Styles

Import `@bendyline/squisq-react/styles` to include the default animation stylesheet (`doc-animations.css`).

---

## `@bendyline/squisq-formats`

Document format converters. Uses `MarkdownDocument` from core as the pivot representation.

### Subpath: DOCX

**Import:** `@bendyline/squisq-formats/docx`

```ts
async function markdownDocToDocx(doc: MarkdownDocument, options?: DocxExportOptions): Promise<Blob>;

async function docxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options?: DocxImportOptions,
): Promise<MarkdownDocument>;

// Convenience wrappers that convert through MarkdownDocument
async function docToDocx(doc: Doc, options?: DocxExportOptions): Promise<Blob>;
async function docxToDoc(data: ArrayBuffer | Blob, options?: DocxImportOptions): Promise<Doc>;

// Import to a ContentContainer with markdown + extracted images
async function docxToContainer(
  data: ArrayBuffer | Blob,
  options?: DocxImportOptions,
): Promise<ContentContainer>;

interface DocxExportOptions {
  title?: string;
  author?: string;
  description?: string;
  styles?: DocxStyleOverrides;
  /** Apply a Squisq theme (colors + typography) to headings. */
  themeId?: string;
  /** Pre-resolved images keyed by markdown image URL — embedded as binary parts in the .docx. */
  images?: Map<string, { data: ArrayBuffer | Uint8Array; contentType: string }>;
}

interface DocxImportOptions {
  extractImages?: boolean; // Default: false
}
```

### Subpath: PDF

**Import:** `@bendyline/squisq-formats/pdf`

```ts
async function markdownDocToPdf(
  doc: MarkdownDocument,
  options?: PdfExportOptions,
): Promise<Uint8Array>;

async function pdfToMarkdownDoc(
  data: ArrayBuffer | Uint8Array,
  options?: PdfImportOptions,
): Promise<MarkdownDocument>;

// Convenience wrappers
async function docToPdf(doc: Doc, options?: PdfExportOptions): Promise<Uint8Array>;
async function pdfToDoc(data: ArrayBuffer | Uint8Array, options?: PdfImportOptions): Promise<Doc>;

// Import to a ContentContainer with markdown + extracted images
async function pdfToContainer(
  data: ArrayBuffer | Uint8Array | Blob,
  options?: PdfImportOptions,
): Promise<ContentContainer>;

function configurePdfWorker(workerSrc: string): void;

interface PdfExportOptions {
  title?: string;
  author?: string;
  fontSize?: number; // Default: 12
  margin?: number; // Default: 72 (points)
  pageSize?: 'letter' | 'a4'; // Default: 'letter'
}

interface PdfImportOptions {
  /** Hint for body font size (points). Text larger than this is treated as a heading. */
  bodyFontSize?: number;
  /** Detect tables from column-aligned text. Default: true. */
  detectTables?: boolean;
  /** Detect code blocks from monospace fonts. Default: true. */
  detectCodeBlocks?: boolean;
  /** Detect blockquotes from indentation. Default: true. */
  detectBlockquotes?: boolean;
  /** Detect URLs in text and convert to links. Default: true. */
  detectLinks?: boolean;
}
```

### Subpath: OOXML

**Import:** `@bendyline/squisq-formats/ooxml`

Shared infrastructure for all Office Open XML formats (DOCX, PPTX, XLSX).

#### Package Reader

```ts
async function openPackage(data: ArrayBuffer | Blob): Promise<OoxmlPackage>;
async function getPartRelationships(pkg: OoxmlPackage, partPath: string): Promise<Relationship[]>;
async function getPartXml(pkg: OoxmlPackage, partPath: string): Promise<Document | null>;
async function getPartBinary(pkg: OoxmlPackage, partPath: string): Promise<ArrayBuffer | null>;
async function getCoreProperties(pkg: OoxmlPackage): Promise<CoreProperties>;

interface OoxmlPackage {
  parts: Map<string, PackagePart>;
  relationships: Relationship[];
  contentTypes: ContentTypeMap;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode?: 'Internal' | 'External';
}

interface CoreProperties {
  title?: string;
  subject?: string;
  creator?: string;
  description?: string;
  keywords?: string;
  lastModifiedBy?: string;
  created?: string;
  modified?: string;
}
```

#### Package Writer

```ts
function createPackage(): OoxmlPackageBuilder;

interface OoxmlPackageBuilder {
  addPart(path: string, content: string, contentType: string): void;
  addBinaryPart(path: string, data: ArrayBuffer | Uint8Array, contentType: string): void;
  addRelationship(sourcePart: string, rel: Relationship): void;
  setCoreProperties(props: CoreProperties): void;
  toBlob(): Promise<Blob>;
  toArrayBuffer(): Promise<ArrayBuffer>;
}
```

#### XML Utilities

```ts
function xmlDeclaration(): string;
function escapeXml(text: string): string;
function attrString(attrs?: Record<string, string | undefined>): string;
function selfClosingElement(tag: string, attrs?: Record<string, string | undefined>): string;
function xmlElement(
  tag: string,
  attrs?: Record<string, string | undefined>,
  ...children: string[]
): string;
function textElement(
  tag: string,
  attrs?: Record<string, string | undefined>,
  text?: string,
): string;
```

#### Namespace Constants

<details>
<summary>All exported namespace and content-type constants</summary>

| Constant                         | Description                                  |
| -------------------------------- | -------------------------------------------- |
| `NS_RELATIONSHIPS`               | Package relationships namespace              |
| `NS_CONTENT_TYPES`               | Content types namespace                      |
| `REL_OFFICE_DOCUMENT`            | Office document relationship type            |
| `REL_CORE_PROPERTIES`            | Core properties relationship type            |
| `REL_EXTENDED_PROPERTIES`        | Extended properties relationship type        |
| `REL_STYLES`                     | Styles relationship type                     |
| `REL_NUMBERING`                  | Numbering relationship type                  |
| `REL_FONT_TABLE`                 | Font table relationship type                 |
| `REL_SETTINGS`                   | Settings relationship type                   |
| `REL_HYPERLINK`                  | Hyperlink relationship type                  |
| `REL_IMAGE`                      | Image relationship type                      |
| `REL_FOOTNOTES`                  | Footnotes relationship type                  |
| `REL_THEME`                      | Theme relationship type                      |
| `NS_WML`                         | WordprocessingML main namespace              |
| `NS_PML`                         | PresentationML main namespace                |
| `NS_SML`                         | SpreadsheetML main namespace                 |
| `NS_DRAWINGML`                   | DrawingML main namespace                     |
| `NS_WP_DRAWING`                  | DrawingML WordprocessingML drawing namespace |
| `NS_PICTURE`                     | DrawingML picture namespace                  |
| `NS_DC`                          | Dublin Core elements namespace               |
| `NS_DCTERMS`                     | Dublin Core terms namespace                  |
| `NS_CORE_PROPERTIES`             | Core properties namespace                    |
| `NS_XSI`                         | XML Schema Instance namespace                |
| `NS_MC`                          | Markup Compatibility namespace               |
| `NS_R`                           | Office relationships namespace               |
| `CONTENT_TYPE_RELATIONSHIPS`     | OOXML relationships content type             |
| `CONTENT_TYPE_CORE_PROPERTIES`   | Core properties content type                 |
| `CONTENT_TYPE_DOCX_DOCUMENT`     | DOCX main document content type              |
| `CONTENT_TYPE_DOCX_STYLES`       | DOCX styles content type                     |
| `CONTENT_TYPE_DOCX_NUMBERING`    | DOCX numbering content type                  |
| `CONTENT_TYPE_DOCX_SETTINGS`     | DOCX settings content type                   |
| `CONTENT_TYPE_DOCX_FONT_TABLE`   | DOCX font table content type                 |
| `CONTENT_TYPE_DOCX_FOOTNOTES`    | DOCX footnotes content type                  |
| `CONTENT_TYPE_PPTX_PRESENTATION` | PPTX main presentation content type          |
| `CONTENT_TYPE_XLSX_WORKBOOK`     | XLSX main workbook content type              |

</details>

### Subpath: PPTX (stub)

**Import:** `@bendyline/squisq-formats/pptx`

> Not yet implemented. All functions throw `"PPTX export is not yet implemented"`.

```ts
async function markdownDocToPptx(doc: MarkdownDocument, options?: PptxExportOptions): Promise<Blob>;
async function docToPptx(doc: Doc, options?: PptxExportOptions): Promise<Blob>;
async function pptxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options?: PptxImportOptions,
): Promise<MarkdownDocument>;
async function pptxToDoc(data: ArrayBuffer | Blob, options?: PptxImportOptions): Promise<Doc>;

interface PptxExportOptions {
  title?: string;
  author?: string;
}
interface PptxImportOptions {
  extractImages?: boolean;
}
```

### Subpath: XLSX (stub)

**Import:** `@bendyline/squisq-formats/xlsx`

> Not yet implemented. All functions throw `"XLSX export is not yet implemented"`.

```ts
async function markdownDocToXlsx(doc: MarkdownDocument, options?: XlsxExportOptions): Promise<Blob>;
async function docToXlsx(doc: Doc, options?: XlsxExportOptions): Promise<Blob>;
async function xlsxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options?: XlsxImportOptions,
): Promise<MarkdownDocument>;
async function xlsxToDoc(data: ArrayBuffer | Blob, options?: XlsxImportOptions): Promise<Doc>;

interface XlsxExportOptions {
  title?: string;
  author?: string;
}
interface XlsxImportOptions {
  sheet?: number | string;
}
```

---

## `@bendyline/squisq-editor-react`

Rich markdown editor shell with Raw (Monaco), WYSIWYG (Tiptap), and Preview modes.

**Import:** `@bendyline/squisq-editor-react`  
**Styles:** `@bendyline/squisq-editor-react/styles`  
**Peer dependencies:** `monaco-editor`, `@tiptap/react`, `@tiptap/starter-kit`

### Editor Components

#### `EditorShell`

Top-level editor with toolbar, view switcher, and three editing modes.

```ts
interface EditorShellProps {
  initialMarkdown?: string; // Default: ''
  initialView?: EditorView; // Default: 'raw'
  articleId?: string; // Default: 'untitled'
  basePath?: string; // Default: '/'
  onChange?: (source: string) => void;
  theme?: 'light' | 'dark'; // Default: 'light'
  className?: string;
  height?: string; // Default: '100vh'
}
```

#### `RawEditor`

Monaco-based code editor for raw markdown editing.

```ts
interface RawEditorProps {
  theme?: string; // Default: 'vs-dark'
  minimap?: boolean; // Default: false
  fontSize?: number; // Default: 14
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded'; // Default: 'on'
  className?: string;
}
```

#### `WysiwygEditor`

Tiptap-based WYSIWYG editor.

```ts
interface WysiwygEditorProps {
  placeholder?: string; // Default: 'Start typing your markdown…'
  className?: string;
}
```

#### `PreviewPanel`

Live block preview via `DocPlayer`.

```ts
interface PreviewPanelProps {
  basePath?: string;
  className?: string;
}
```

#### `Toolbar`

Formatting toolbar (bold, italic, headings, lists, etc.).

```ts
interface ToolbarProps {
  className?: string;
}
```

#### `StatusBar`

Document statistics — word count, character count, line count, block count, parse status.

```ts
interface StatusBarProps {
  className?: string;
}
```

#### `ViewSwitcher`

Tab bar to switch between Raw, WYSIWYG, and Preview modes.

```ts
interface ViewSwitcherProps {
  className?: string;
}
```

### Editor Context

#### `EditorProvider`

Provides shared editor state to all child components.

```ts
interface EditorProviderProps {
  initialMarkdown?: string;
  initialView?: EditorView;
  articleId?: string;
  theme?: EditorTheme;
  children: ReactNode;
}
```

#### `useEditorContext()`

Hook to access editor state and actions.

```ts
function useEditorContext(): EditorContextValue;

type EditorView = 'raw' | 'wysiwyg' | 'preview';
type EditorTheme = 'light' | 'dark';

interface EditorState {
  markdownSource: string;
  markdownDoc: MarkdownDocument | null;
  doc: Doc | null;
  activeView: EditorView;
  parseError: string | null;
  isParsing: boolean;
  theme: EditorTheme;
}

interface EditorActions {
  setMarkdownSource: (source: string) => void;
  setMarkdownDoc: (doc: MarkdownDocument) => void;
  setActiveView: (view: EditorView) => void;
  setTiptapEditor: (editor: TiptapEditor | null) => void;
  setMonacoEditor: (editor: MonacoEditor | null) => void;
  setTheme: (theme: EditorTheme) => void;
}

interface EditorContextValue extends EditorState, EditorActions {
  tiptapEditor: TiptapEditor | null;
  monacoEditor: MonacoEditor | null;
}
```

### Editor Bridge Utilities

Bidirectional conversion between raw markdown and Tiptap HTML.

```ts
function markdownToTiptap(markdown: string): string;
function tiptapToMarkdown(html: string): string;
```

### Tiptap Extension

**`HeadingWithTemplate`** — Custom Tiptap extension that recognises template annotation syntax (`{[templateName key=value]}`) inside headings and preserves it across editing round-trips.

---

## `@bendyline/squisq-cli`

Command-line tool and programmatic API for converting Squisq documents and rendering them to MP4 video.

**Install:** `npm install -g @bendyline/squisq-cli`

### CLI Programmatic API

**Import:** `@bendyline/squisq-cli/api`

Library-style entry point for rendering Squisq docs to MP4 from Node.js — avoids shelling out to the CLI.

#### `renderDocToMp4`

```ts
async function renderDocToMp4(
  doc: Doc,
  container: MemoryContentContainer,
  options: RenderDocToMp4Options,
): Promise<RenderDocToMp4Result>;

interface RenderDocToMp4Options {
  /** Output file path for the MP4. */
  outputPath: string;
  /** Frames per second (default: 30). */
  fps?: number;
  /** Encoding quality preset (default: 'normal'). */
  quality?: 'draft' | 'normal' | 'high';
  /** Video orientation (default: 'landscape'). */
  orientation?: 'landscape' | 'portrait';
  /** Override video width in pixels. */
  width?: number;
  /** Override video height in pixels. */
  height?: number;
  /** Caption style to bake into the video. */
  captionStyle?: 'standard' | 'social';
  /** Seconds of cover-slide pre-roll before the story starts (default: 0). */
  coverPreRoll?: number;
  /** Progress callback — called with a phase name and 0-100 percentage. */
  onProgress?: (phase: string, percent: number) => void;
}

interface RenderDocToMp4Result {
  /** Duration of the rendered video in seconds. */
  duration: number;
  /** Number of frames captured. */
  frameCount: number;
  /** Output file path. */
  outputPath: string;
}
```

#### `extractThumbnails`

Extract JPEG thumbnails from the first frame of an MP4 video.

```ts
async function extractThumbnails(options: ExtractThumbnailsOptions): Promise<void>;

interface ExtractThumbnailsOptions {
  /** Path to the source MP4 video. */
  videoPath: string;
  /** Directory to write thumbnails into. */
  outputDir: string;
  /** Base slug for filenames (produces `{slug}-{width}x{height}.jpg`). */
  slug: string;
  /** Thumbnail sizes to generate. */
  sizes: ThumbnailSpec[];
  /** Overwrite existing thumbnails (default: false). */
  force?: boolean;
}

interface ThumbnailSpec {
  name: string;
  width: number;
  height: number;
  /** FFmpeg video filter string (e.g., 'scale=1280:720'). */
  filter: string;
}
```

#### Re-exports

The API entry point re-exports several utilities for convenience:

```ts
export type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
export { MemoryContentContainer } from '@bendyline/squisq/storage';
export { readInput } from './util/readInput.js';
export type { ReadInputResult } from './util/readInput.js';
```

### CLI Commands

#### `squisq convert`

Convert a document to DOCX, PPTX, PDF, HTML, or DBK:

| Option         | Description                                      | Default     |
| -------------- | ------------------------------------------------ | ----------- |
| `--output-dir` | Output directory                                 | current dir |
| `--formats`    | Comma-separated list: docx, pptx, pdf, html, dbk | all         |
| `--theme`      | Squisq theme ID (e.g., documentary, cinematic)   | none        |
| `--transform`  | Transform style (e.g., documentary, magazine)    | none        |

#### `squisq video`

Render a document to MP4 video:

| Option          | Description               | Default   |
| --------------- | ------------------------- | --------- |
| `--fps`         | Frames per second (1–120) | 30        |
| `--quality`     | draft, normal, or high    | normal    |
| `--orientation` | landscape or portrait     | landscape |
| `--captions`    | off, standard, or social  | off       |
| `--width`       | Override width in pixels  | auto      |
| `--height`      | Override height in pixels | auto      |

**Requires:** [ffmpeg](https://ffmpeg.org/) on PATH and Playwright (chromium) for frame capture.
