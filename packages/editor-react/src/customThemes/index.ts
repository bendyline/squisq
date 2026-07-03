/**
 * Public exports for the custom-theme designer + runtime — the theme analog
 * of `customTemplates/index.ts`.
 *
 *   - `<CustomThemeProvider>` wraps the editor so the picker and dialog can
 *     read/write doc + library theme lists.
 *   - `<CustomThemeDialog>` is the modal designer opened from the ThemePicker's
 *     "+ Create custom theme" affordance.
 *   - the `*LibraryTheme` helpers back the browser-local theme library.
 */

export {
  CustomThemeProvider,
  useCustomThemes,
  type CustomThemeContextValue,
  type CustomThemeProviderProps,
} from './CustomThemeContext';
export {
  listLibraryThemes,
  saveLibraryTheme,
  deleteLibraryTheme,
  clearThemeLibrary,
  THEME_LIBRARY_STORAGE_KEY,
} from './customThemeLibrary';
export { useDocCustomThemes, type DocCustomThemes } from './useDocCustomThemes';
export {
  CustomThemeDialog,
  type CustomThemeDialogProps,
  type ThemeSaveTarget,
} from './CustomThemeDialog';
export { compileDraft, themeToDraft, type Draft } from './themeDraft';
