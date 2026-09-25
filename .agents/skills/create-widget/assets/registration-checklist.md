# Widget registration checklist

A finished widget touches this exact set of seams. Miss one and it either won't
render, won't be draggable, or won't show in the Widget Gallery. Paths are relative
to `frontend/src/app/`.

Let `TYPE` = the panel `@switch` key (e.g. `risk-uncertainty`), `SLUG` = the
feature folder, `Comp` = the component class.

### 1. Plugin host — component wiring
`features/layout/components/panel-plugin-host/panel-plugin-host.component.ts`
- Import: `import { Comp } from '../../../SLUG/SLUG.component';`
- Add `Comp` to the `imports: [...]` array.

### 2. Plugin host — template case
`features/layout/components/panel-plugin-host/panel-plugin-host.component.html`
- Add a case:
  ```html
  @case ('TYPE') {
    <app-SLUG [embedded]="true"></app-SLUG>
  }
  ```

### 3. Designer palette — make it draggable
`features/layout-designer/layout-designer.component.ts` → `palette: PaletteItem[]`
- Add: `{ type: 'TYPE', title: 'Title', minHeight: NNN, description: '≤90 chars', kind: '<kind>' },`

### 4. Mode availability — only if mode-restricted
`core/layout/panel-mode-availability.ts` → `PANEL_MODE_AVAILABILITY`
- Add `'TYPE': ['<mode>', …],` **only if** the widget is not available in all modes.
- Omit the entry entirely for all-modes widgets.

### 5. Widget catalog registry — the Gallery source of truth ★
`core/widgets/widget-catalog.ts` → `WIDGET_CATALOG`
- Add a `WidgetMeta`:
  ```ts
  {
    type: 'TYPE',
    catalogId: 'X#',              // optional
    title: 'Title',
    kind: '<kind>',
    granularity: 'overview' | 'detail' | 'overview-detail',
    status: 'planned' | 'first-cut' | 'shipped',
    description: '…',             // palette-length
    promise: '…',                 // what the operator can now do
    grounding: '…',               // the reference
    availableModes: 'all' | ['<mode>', …],   // MUST match seam #4
    perMode: {
      recommendation: '…' | null,
      'co-learning': '…' | null,
      director: '…' | null,
    },
    defaultZone: 'left' | 'center' | 'right' | 'bottom' | 'floating',
    minHeight: NNN,
    spec: 'docs/plans/widget-<id>-<slug>.md',  // optional
  },
  ```
- **Consistency:** `availableModes` here must equal what seam #4 implies. The
  gallery renders a "⚠ availability drift" warning if they disagree.

### 6. Default layout — only if it ships by default
`app.component.ts` (a `PanelInstance` field) + `app.component.html`
- Add only when the widget should appear in the hardcoded default layout. Most new
  widgets are palette-only at first; skip this until it's earned its place.

### Docs (after code)
- `docs/reference/panel-mode-matrix.md` — availability row + per-mode behaviour
  (if behaviour branches on mode).
- `docs/plans/widget-catalog.md` — flip/append the widget's status.

### Verify
- `cd frontend && npx ng build` clean.
- `/widgets` shows the widget under the right kind, correct per-mode text, no drift warning.
- Preview per mode: behaviour differs exactly as the spec's §3 states.
