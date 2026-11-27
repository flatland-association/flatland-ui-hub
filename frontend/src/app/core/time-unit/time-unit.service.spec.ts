import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import en from '../../../../public/i18n/en.json';
import de from '../../../../public/i18n/de.json';
import fr from '../../../../public/i18n/fr.json';
import { UiConfigService } from '../config/ui-config.service';
import { LAYOUT_PRESETS } from '../layout/layout-presets';
import { MINUTE_KEYS, TimeUnitService, timeKey } from './time-unit.service';

/** docs/plans/plan-b-round2-colearning.md, item 2. */
describe('TimeUnitService', () => {
  const lookup = (dict: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);

  it('has a minute sibling for every listed key, in en, de and fr', () => {
    for (const [lang, dict] of [['en', en], ['de', de], ['fr', fr]] as const) {
      for (const key of MINUTE_KEYS) {
        expect(typeof lookup(dict, key)).withContext(`${lang} ${key}`).toBe('string');
        expect(typeof lookup(dict, `${key}Min`)).withContext(`${lang} ${key}Min`).toBe('string');
      }
    }
  });

  it('maps only the listed keys, and only for minutes', () => {
    expect(timeKey('zwd.timeUnit', 'minutes')).toBe('zwd.timeUnitMin');
    expect(timeKey('zwd.timeUnit', 'steps')).toBe('zwd.timeUnit');
    expect(timeKey('proposals.plan', 'minutes')).toBe('proposals.plan');
  });

  describe('which unit applies', () => {
    let time: TimeUnitService;
    let ui: UiConfigService;
    beforeEach(() => {
      try { localStorage.removeItem('flatland.timeUnit'); } catch { /* not available */ }
      TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
      time = TestBed.inject(TimeUnitService);
      ui = TestBed.inject(UiConfigService);
    });
    afterEach(() => {
      try { localStorage.removeItem('flatland.timeUnit'); } catch { /* not available */ }
    });

    it('is steps by default, and the viewer\'s choice otherwise', () => {
      expect(time.unit()).toBe('steps');
      time.setPreference('minutes');
      expect(time.unit()).toBe('minutes');
      expect(time.key('footer.step')).toBe('footer.stepMin');
    });

    it('is fixed by the layout, whatever the viewer chose, and hides the setting there', () => {
      time.setPreference('steps');
      const preset = LAYOUT_PRESETS.find((p) => p.id === 'preset-plan-b-colearning')!;
      ui.apply(preset.ui!);
      expect(time.unit()).toBe('minutes');
      expect(ui.isHidden('control.timeUnit')).toBeTrue();
      ui.apply({});
      expect(time.unit()).toBe('steps');
    });

    it('leaves round 1\'s Plan B in steps', () => {
      ui.apply(LAYOUT_PRESETS.find((p) => p.id === 'preset-plan-b')!.ui!);
      expect(time.unit()).toBe('steps');
    });
  });
});
