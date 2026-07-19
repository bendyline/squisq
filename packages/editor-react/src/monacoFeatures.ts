/**
 * Monaco contributions used by every Squisq code editor.
 *
 * Monaco's `editor.all.js` barrel also registers IDE features such as code
 * lenses, inline edits, sticky scroll, quick access, and symbol navigation.
 * Those add startup work to Markdown source editors and fenced-code insets.
 * Keep the shared profile focused on editing mechanics Squisq exposes on
 * every surface. Rich language-service UI loads separately, and only for a
 * full CSS/HTML/JSON/JavaScript/TypeScript file.
 */

import 'monaco-editor/esm/vs/editor/browser/coreCommands.js';
import 'monaco-editor/esm/vs/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/esm/vs/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/esm/vs/editor/contrib/caretOperations/browser/transpose.js';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/esm/vs/editor/contrib/dnd/browser/dnd.js';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/esm/vs/editor/contrib/fontZoom/browser/fontZoom.js';
import 'monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/esm/vs/editor/contrib/lineSelection/browser/lineSelection.js';
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/esm/vs/editor/contrib/links/browser/links.js';
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/esm/vs/editor/contrib/smartSelect/browser/smartSelect.js';
import 'monaco-editor/esm/vs/editor/contrib/tokenization/browser/tokenization.js';
import 'monaco-editor/esm/vs/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js';
import 'monaco-editor/esm/vs/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js';
import 'monaco-editor/esm/vs/editor/contrib/unusualLineTerminators/browser/unusualLineTerminators.js';
import 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/esm/vs/editor/contrib/wordPartOperations/browser/wordPartOperations.js';
import 'monaco-editor/esm/vs/editor/contrib/readOnlyMessage/browser/contribution.js';
import 'monaco-editor/esm/vs/editor/common/standaloneStrings.js';
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codiconStyles.js';
import 'monaco-editor/esm/vs/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard.js';
