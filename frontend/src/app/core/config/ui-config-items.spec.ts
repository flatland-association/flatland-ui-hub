import schema from '../../../../public/ui-config.schema.json';
import { UI_CONFIG_ITEMS, UiConfigVerb } from './ui-config-items';

/** Ids the schema's own `enum` for a given array property. */
function schemaIdsFor(property: 'hidden' | 'collapsedByDefault'): string[] {
  return (schema.properties as any)[property].items.enum;
}

describe('ui-config.schema.json', () => {
  it('lists exactly the ids that support "hidden"', () => {
    const expected = UI_CONFIG_ITEMS.filter((item) => item.supports.includes('hidden')).map((item) => item.id);
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

  it('only offers verbs the registry actually declares', () => {
    const verbs: UiConfigVerb[] = ['hidden', 'collapsedByDefault'];
    for (const verb of verbs) {
      for (const id of schemaIdsFor(verb)) {
        const item = UI_CONFIG_ITEMS.find((i) => i.id === id);
        expect(item?.supports).toContain(verb);
      }
    }
  });
});
