# @bendyline/squisq-grid-react

Virtualized data grid for squisq data sidecars: an in-house columnar store
behind a Web Worker (`TableStoreClient`, implementing core's
`TableQueryProvider`), plus a TanStack-Virtual React renderer (`DataGrid`)
with spreadsheet-style sort/filter/selection/clipboard and journaled cell
editing.

The Tiptap mount lives in `@bendyline/squisq-editor-react` (the data-card
widget lazy-imports this package); the grid itself has no editor
dependencies and works in any React 18/19 host.

```tsx
import { DataGrid, TableStoreClient, EditJournal } from '@bendyline/squisq-grid-react';
import '@bendyline/squisq-grid-react/styles';

const provider = new TableStoreClient({ headers, cells });
<DataGrid provider={provider} journal={new EditJournal()} view={{ sort: [], filter: [] }} />;
```

Theming: every color resolves through `--squisq-grid-*` CSS custom
properties with literal fallbacks; hosts re-bind them to their own palette
(editor-react aliases them onto its chrome tokens).
