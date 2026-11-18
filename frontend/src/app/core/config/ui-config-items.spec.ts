import schema from '../../../../public/ui-config.schema.json';
import { UI_CONFIG_ALIASES, UI_CONFIG_ITEMS, UiConfigVerb } from './ui-config-items';

/** Ids the schema's own `enum` for a given array property. */
function schemaIdsFor(property: 'hidden' | 'collapsedByDefault'): string[] {
  return (schema.properties as any)[property].items.enum;
}

describe('ui-config.schema.json', () => {
  it('lists exactly the ids that support "hidden", and the legacy aliases', () => {
    const expected = [
      ...UI_CONFIG_ITEMS.filter((item) => item.supports.includes('hidden')).map((item) => item.id),
      ...Object.keys(UI_CONFIG_ALIASES),
    ];
    expect(new Set(schemaIdsFor('hidden'))).toEqual(new Set(expected));
  });

  it('lists exactly the ids that support "collapsedByDefault"', () => {
    const expected = UI_CONFIG_ITEMS.filter((item) => item.supports.includes('collapsedByDefault')).map(
      (item) => item.id,
    );
    expect(new Set(schemaIdsFor('collapsedByDefault'))).toEqual(new Set(expected));
  });

  it('has no duplicate ids in the registry', () => {
    const ids = UI_CONFIG_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has aliases that stand only for registry ids, and are none themselves', () => {
    for (const [alias, ids] of Object.entries(UI_CONFIG_ALIASES)) {
      expect(UI_CONFIG_ITEMS.some((i) => i.id === alias)).withContext(alias).toBeFalse();
      for (const id of ids) expect(UI_CONFIG_ITEMS.some((i) => i.id === id)).withContext(id).toBeTrue();
    }
  });

  it('only offers verbs the registry actually declares', () => {
    const verbs: UiConfigVerb[] = ['hidden', 'collapsedByDefault'];
    for (const verb of verbs) {
      for (const id of schemaIdsFor(verb).filter((i) => !(i in UI_CONFIG_ALIASES))) {
        const item = UI_CONFIG_ITEMS.find((i) => i.id === id);
        expect(item?.supports).toContain(verb);
      }
    }
  });
});
