import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LAYOUT_PRESETS } from '../layout/layout-presets';
import { UiConfig, UiConfigService } from './ui-config.service';

describe('UiConfigService — the shipped deployment file', () => {
  let service: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(UiConfigService);
  });

  // Fetched over HTTP from the same path production uses, so "the file we
  // ship" and "the file under test" cannot be two different things.
  it('ships empty, so an unconfigured deployment hides nothing', async () => {
    await service.load('/ui-config.json');
    expect(service.isHidden('control.contrast')).toBeFalse();
    expect(service.isHidden('control.menuAreas')).toBeFalse();
    expect(service.isCollapsedByDefault('widget.decision-log')).toBeFalse();
    expect(service.policyAllowlist()).toBeNull();
    expect(service.studyLogging()).toBeNull();
    expect(service.reflectionPromptQuestionOrder()).toEqual(['gut', 'missing', 'tradeoff']);
  });
});

describe('UiConfigService — the deployment\'s order of the reflection\'s questions', () => {
  let service: UiConfigService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(UiConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  it('is the default order before the file is read', () => {
    expect(service.reflectionPromptQuestionOrder()).toEqual(['gut', 'missing', 'tradeoff']);
  });

  it('reads it from the deployment file and keeps it when a condition applies', async () => {
    const loaded = service.load('ui-config.json');
    http.expectOne('ui-config.json').flush({ reflectionPromptQuestionOrder: ['tradeoff', 'gut'] });
    await loaded;
    expect(service.reflectionPromptQuestionOrder()).toEqual(['tradeoff', 'gut', 'missing']);
    const warn = spyOn(console, 'warn');
    service.apply({ reflectionPromptQuestionOrder: ['missing'] });
    expect(service.reflectionPromptQuestionOrder()).toEqual(['tradeoff', 'gut', 'missing']);
    expect(warn).toHaveBeenCalledOnceWith(jasmine.stringContaining('"reflectionPromptQuestionOrder" is set by the deployment file only'));
  });

  it('warns about no deployment-only value when a condition sets none', async () => {
    const loaded = service.load('ui-config.json');
    http.expectOne('ui-config.json').flush({ reflectionPromptQuestionOrder: ['tradeoff'], studyLogging: true });
    const warn = spyOn(console, 'warn');
    await loaded;
    service.apply({ hidden: ['control.contrast'] });
    service.apply({});
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the default order when the value is not a list', async () => {
    const loaded = service.load('ui-config.json');
    http.expectOne('ui-config.json').flush({ reflectionPromptQuestionOrder: 'tradeoff' });
    await loaded;
    expect(service.reflectionPromptQuestionOrder()).toEqual(['gut', 'missing', 'tradeoff']);
  });
});

describe('UiConfigService — the deployment\'s "Study logging" value', () => {
  let service: UiConfigService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(UiConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  it('reads it from the deployment file and keeps it when a condition applies', async () => {
    const loaded = service.load('ui-config.json');
    http.expectOne('ui-config.json').flush({ studyLogging: false, hidden: ['control.studyLogging'] });
    await loaded;
    expect(service.studyLogging()).toBeFalse();
    expect(service.isHidden('control.studyLogging')).toBeTrue();
    const warn = spyOn(console, 'warn');
    service.apply({ studyLogging: true } as UiConfig);
    expect(service.studyLogging()).toBeFalse();
    expect(warn).toHaveBeenCalledOnceWith(jasmine.stringContaining('"studyLogging" is set by the deployment file only'));
  });
});

describe('UiConfigService — the Plan B preset block', () => {
  let service: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(UiConfigService);
  });

  /** The real block, so the study condition and the test cannot drift. */
  const planB = () => LAYOUT_PRESETS.find((p) => p.id === 'preset-plan-b')!.ui!;

  it('is declared on the preset the Plan B tours run', () => {
    expect(planB()).toBeDefined();
  });

  it('hides every item the condition removes', () => {
    service.apply(planB());
    expect(service.isHidden('control.mapPan')).toBeTrue();
    expect(service.isHidden('control.mapOpacity')).toBeTrue();
    expect(service.isHidden('control.endShift')).toBeTrue();
    expect(service.isHidden('control.playback')).toBeTrue();
    expect(service.isHidden('control.modeTabs')).toBeTrue();
    expect(service.isHidden('control.sessionInfo')).toBeTrue();
    expect(service.isHidden('widget.proposal-compare.axis.time')).toBeTrue();
  });

  it('hides the centre panel title, and its layout opens big tabs on the ZWL (#168)', () => {
    service.apply(planB());
    expect(service.isHidden('widget.view-tabs.title')).toBeTrue();
    const preset = LAYOUT_PRESETS.find((p) => p.id === 'preset-plan-b')!;
    const views = preset.layout.columns.flatMap((c) => c.panels).find((p) => p.type === 'view-tabs')!;
    expect(views.settings).toEqual(jasmine.objectContaining({
      tabs: ['zug-weg-diagramm', 'flatland-map'],
      defaultTab: 'zug-weg-diagramm',
      tabSize: 'l',
    }));
  });

  // docs/plans/hide-scenario-bar.md §4.3: only Plan B numbers its scenarios.
  it('numbers the scenarios without their names and hides the guide strip, and no other layout does', () => {
    service.apply(planB());
    for (const id of ['control.legNames', 'control.guide']) {
      expect(service.isHidden(id)).withContext(id).toBeTrue();
      const others = LAYOUT_PRESETS.filter((p) => p.id !== 'preset-plan-b' && p.ui?.hidden?.includes(id));
      expect(others.map((p) => p.id)).withContext(id).toEqual([]);
    }
  });

  it('keeps the map zoom buttons in Plan B (plan-b-small-changes.md, item 2)', () => {
    service.apply(planB());
    expect(service.isHidden('control.mapZoom')).toBeFalse();
  });

  it('reads the legacy control.mapNavigation as pan arrows and zoom buttons, as before', () => {
    service.apply({ hidden: ['control.mapNavigation'] });
    expect(service.isHidden('control.mapPan')).toBeTrue();
    expect(service.isHidden('control.mapZoom')).toBeTrue();
    expect(service.isHidden('control.mapOpacity')).toBeFalse();
    expect(service.snapshot().hidden).toEqual(['control.mapPan', 'control.mapZoom']);
  });

  it('leaves the sibling comparison axis visible', () => {
    service.apply(planB());
    expect(service.isHidden('widget.proposal-compare.axis.lateness')).toBeFalse();
  });

  it('gives the merged restrictions as sorted lists for the session record', () => {
    service.apply(planB());
    const snap = service.snapshot();
    expect(snap.hidden).toContain('control.endShift');
    expect(snap.hidden).toEqual([...snap.hidden].sort());
    expect(snap.collapsedByDefault).toEqual([]);
  });

  // Its entries reopen the reflections, so they start open
  // (docs/plans/reflection-inline.md D4).
  it('shows the Decision Log open, neither hidden nor collapsed', () => {
    service.apply(planB());
    expect(service.isCollapsedByDefault('widget.decision-log')).toBeFalse();
    expect(service.isHidden('widget.decision-log')).toBeFalse();
  });

  it('still lets a condition collapse the Decision Log', () => {
    service.apply({ collapsedByDefault: ['widget.decision-log'] });
    expect(service.isCollapsedByDefault('widget.decision-log')).toBeTrue();
  });

  // One entry: nothing to pick, so the selector does not render and this is
  // the policy the session runs (issue item 5).
  it('allows exactly one policy, which is what takes the selector away', () => {
    service.apply(planB());
    expect(service.policyAllowlist()).toEqual(['deadlock_avoidance']);
  });

  it('drops the condition again when a layout without a block is selected', () => {
    service.apply(planB());
    service.apply({});
    expect(service.isHidden('control.mapPan')).toBeFalse();
    expect(service.policyAllowlist()).toBeNull();
  });
});

describe('UiConfigService — merging the two routes', () => {
  let service: UiConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(UiConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** Loads `config` as the deployment file (route 1). */
  async function deploy(config: UiConfig): Promise<void> {
    const loaded = service.load('/ui-config.json');
    httpMock.expectOne('/ui-config.json').flush(config);
    await loaded;
  }

  it('keeps what the deployment hid when a condition is applied', async () => {
    await deploy({ hidden: ['control.contrast'] });
    service.apply({ hidden: ['control.endShift'] });
    expect(service.isHidden('control.contrast')).toBeTrue();
    expect(service.isHidden('control.endShift')).toBeTrue();
  });

  it('keeps what the deployment hid after the condition is dropped', async () => {
    await deploy({ hidden: ['control.contrast'] });
    service.apply({ hidden: ['control.endShift'] });
    service.apply({});
    expect(service.isHidden('control.contrast')).toBeTrue();
    expect(service.isHidden('control.endShift')).toBeFalse();
  });

  it('intersects the two policy allowlists', async () => {
    await deploy({ policyAllowlist: ['deadlock_avoidance', 'plan', 'goal_directed'] });
    service.apply({ policyAllowlist: ['plan', 'goal_directed'] });
    expect(service.policyAllowlist()).toEqual(['plan', 'goal_directed']);
  });

  it('lets one route decide when the other has no opinion', async () => {
    await deploy({});
    service.apply({ policyAllowlist: ['plan'] });
    expect(service.policyAllowlist()).toEqual(['plan']);
  });
});

describe('UiConfigService — fallback behaviour', () => {
  let service: UiConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(UiConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('starts with nothing hidden and no policy allowlist before load() is called', () => {
    expect(service.isHidden('control.contrast')).toBeFalse();
    expect(service.policyAllowlist()).toBeNull();
  });

  it('leaves nothing hidden when the fetch fails', async () => {
    const loaded = service.load('/missing-config.json');
    httpMock.expectOne('/missing-config.json').flush('not found', { status: 404, statusText: 'Not Found' });
    await loaded;
    expect(service.isHidden('control.contrast')).toBeFalse();
  });

  it('warns and ignores an unknown id', async () => {
    spyOn(console, 'warn');
    const loaded = service.load('/fake-config.json');
    httpMock.expectOne('/fake-config.json').flush({ hidden: ['control.doesNotExist'] });
    await loaded;
    expect(console.warn).toHaveBeenCalled();
    expect(service.isHidden('control.doesNotExist')).toBeFalse();
  });

  it('warns and ignores an id used with a verb it does not support', async () => {
    spyOn(console, 'warn');
    const loaded = service.load('/fake-config-2.json');
    httpMock.expectOne('/fake-config-2.json').flush({ collapsedByDefault: ['control.endShift'] });
    await loaded;
    expect(console.warn).toHaveBeenCalled();
    expect(service.isCollapsedByDefault('control.endShift')).toBeFalse();
  });

  // A preset block is TypeScript, but it is not type-checked against the id
  // registry, so it runs through the same validation as the fetched file.
  it('warns and ignores an unknown id in a preset block too', () => {
    spyOn(console, 'warn');
    service.apply({ hidden: ['control.doesNotExist'] });
    expect(console.warn).toHaveBeenCalled();
    expect(service.isHidden('control.doesNotExist')).toBeFalse();
  });
});
