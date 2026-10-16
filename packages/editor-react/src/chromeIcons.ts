/**
 * Chrome glyph vocabulary: Font Awesome icon names → Lucide outlines.
 *
 * The editor chrome was written against Font Awesome class strings
 * (`"fa-solid fa-bold"`), and every call site still names glyphs that way.
 * {@link Icon} looks the name up here and draws the Lucide outline instead, so
 * the whole chrome shares one icon family at one stroke weight — the solid
 * webfont mixed filled shapes (clock, eye, paperclip) with thin ones (bold,
 * list) at visibly different weights.
 *
 * A name missing from this table falls back to the Font Awesome webfont, which
 * is also where brand marks (`fa-brands …`) stay: Lucide does not draw them.
 *
 * Keys are icon names WITHOUT the `fa-` prefix. A few keys are not Font
 * Awesome names at all (`layout-template`, `file-cog`): they let a call site
 * ask for a Lucide glyph that has no Font Awesome Free counterpart.
 *
 * Document content never comes through here. Inline `{[icon]}` nodes and the
 * icon picker render Font Awesome directly, because those glyphs are part of
 * what the author wrote.
 */

import {
  AppWindow,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Ban,
  Bold,
  Captions,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ChevronUp,
  CirclePlay,
  Clock,
  Code,
  Copy,
  CopyPlus,
  Crop,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FaceSlightlySmiling,
  File,
  FileCode,
  FileCog,
  FileImage,
  FileText,
  FileUp,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GripHorizontal,
  GripVertical,
  Image,
  Images,
  Italic,
  LayoutDashboard,
  LayoutPanelLeft,
  LayoutTemplate,
  Link,
  List,
  ListChecks,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Lock,
  LockOpen,
  Maximize2,
  MessageSquareMore,
  Mic,
  MicVocal,
  Minimize2,
  Minus,
  Monitor,
  MousePointer2,
  Move,
  MoveRight,
  PaintBucket,
  Paperclip,
  Pencil,
  PenTool,
  Plus,
  Printer,
  Quote,
  RotateCcwClock,
  Search,
  Settings2,
  Shapes,
  Share2,
  SlidersHorizontal,
  Square,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash,
  TriangleAlert,
  Type,
  Unlink,
  Volume2,
  WandSparkles,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';

export const CHROME_ICONS: Readonly<Record<string, LucideIcon>> = {
  // Text formatting
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  superscript: Superscript,
  subscript: Subscript,
  font: Type,
  code: Code,
  'quote-left': Quote,
  'list-ul': List,
  'list-ol': ListOrdered,
  'list-check': ListChecks,
  indent: ListIndentIncrease,
  outdent: ListIndentDecrease,
  'align-left': TextAlignStart,
  'align-center': TextAlignCenter,
  'align-right': TextAlignEnd,
  minus: Minus,

  // Insert
  plus: Plus,
  link: Link,
  'link-slash': Unlink,
  table: Table,
  image: Image,
  images: Images,
  'photo-film': Images,
  'file-image': FileImage,
  'file-arrow-up': FileUp,
  'file-code': FileCode,
  'chart-column': ChartColumn,
  'diagram-project': Workflow,
  'code-branch': GitBranch,
  'folder-tree': FolderTree,
  timeline: GitCommitHorizontal,
  'pen-nib': PenTool,
  'object-group': LayoutPanelLeft,
  'circle-play': CirclePlay,
  'face-smile': FaceSlightlySmiling,
  microphone: Mic,
  'microphone-lines': MicVocal,
  'comment-dots': MessageSquareMore,
  'volume-high': Volume2,
  film: Film,

  // Documents and files
  file: File,
  'file-lines': FileText,
  folder: Folder,
  'folder-open': FolderOpen,
  'folder-plus': FolderPlus,
  paperclip: Paperclip,
  print: Printer,
  'share-nodes': Share2,
  'up-right-from-square': ExternalLink,

  // Views and modes
  eye: Eye,
  'eye-slash': EyeOff,
  display: Monitor,
  'window-maximize': AppWindow,
  'table-cells-large': LayoutDashboard,
  expand: Maximize2,
  compress: Minimize2,
  'closed-captioning': Captions,
  'clock-rotate-left': RotateCcwClock,
  clock: Clock,

  // Editing actions
  pen: Pencil,
  copy: Copy,
  clone: CopyPlus,
  trash: Trash,
  check: Check,
  xmark: X,
  ban: Ban,
  lock: Lock,
  'lock-open': LockOpen,
  'crop-simple': Crop,
  'fill-drip': PaintBucket,
  'border-top-left': Square,
  square: Square,
  shapes: Shapes,
  sliders: SlidersHorizontal,
  'wand-magic-sparkles': WandSparkles,
  'magnifying-glass': Search,
  'right-left': ArrowLeftRight,
  'triangle-exclamation': TriangleAlert,

  // Navigation and handles
  'chevron-up': ChevronUp,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'angles-right': ChevronsRight,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'arrow-right-long': MoveRight,
  'arrow-pointer': MousePointer2,
  'arrows-up-down-left-right': Move,
  'grip-vertical': GripVertical,
  'grip-lines': GripHorizontal,
  ellipsis: Ellipsis,

  // Lucide-only glyphs, named directly by a call site
  'layout-template': LayoutTemplate,
  'file-cog': FileCog,
  'settings-2': Settings2,
};

/** Font Awesome style and modifier classes, never glyph names. */
const FA_MODIFIERS = new Set(['fa-solid', 'fa-regular', 'fa-light', 'fa-thin', 'fa-fw', 'fa-lg']);

/**
 * The Lucide glyph for an icon string, or `undefined` when the string should
 * keep rendering through Font Awesome — a brand mark or an unmapped name.
 *
 * Accepts a Font Awesome class string (`"fa-solid fa-bold"`) or a bare chrome
 * glyph name (`"layout-template"`).
 */
export function chromeIconFor(icon: string): LucideIcon | undefined {
  const tokens = icon.split(/\s+/u).filter(Boolean);
  if (tokens.includes('fa-brands')) return undefined;
  for (const token of tokens) {
    if (FA_MODIFIERS.has(token)) continue;
    const glyph = CHROME_ICONS[token.startsWith('fa-') ? token.slice(3) : token];
    if (glyph) return glyph;
  }
  return undefined;
}
