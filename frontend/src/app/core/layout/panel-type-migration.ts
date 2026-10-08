export const CURRENT_LAYOUT_SCHEMA_VERSION = 2;

export function migratePanelType(type: string): string {
  return type === 'scenario' ? 'strategy-comparison' : type;
}

export function migrateStoredDesign<T extends Record<string, any>>(design: T): T {
  const columns = design['layout']?.columns;

  if (!Array.isArray(columns)) {
    return design;
  }

  const migratedColumns = columns.map((column: any) => ({
    ...column,
    panels: Array.isArray(column.panels)
      ? column.panels.map((panel: any) => ({
          ...panel,
          type: migratePanelType(String(panel?.type ?? '')),
        }))
      : column.panels,
  }));

  const changed =
    design['schemaVersion'] !== CURRENT_LAYOUT_SCHEMA_VERSION ||
    JSON.stringify(migratedColumns) !== JSON.stringify(columns);

  if (!changed) {
    return design;
  }

  return {
    ...design,
    schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
    layout: {
      ...design['layout'],
      columns: migratedColumns,
    },
  };
}
