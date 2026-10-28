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
    expect(service.isHidden('control.mapNavigation')).toBeTrue();
    expect(service.isHidden('control.endShift')).toBeTrue();
    expect(service.isHidden('control.modeTabs')).toBeTrue();
    expect(service.isHidden('control.sessionInfo')).toBeTrue();
    expect(service.isHidden('widget.proposal-compare.axis.time')).toBeTrue();
  });

  it('leaves the sibling comparison axis visible', () => {
    service.apply(planB());
    expect(service.isHidden('widget.proposal-compare.axis.lateness')).toBeFalse();
  });

  it('collapses the Decision Log rather than hiding it', () => {
    service.apply(planB());
    expect(service.isCollapsedByDefault('widget.decision-log')).toBeTrue();
    expect(service.isHidden('widget.decision-log')).toBeFalse();
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
    expect(service.isHidden('control.mapNavigation')).toBeFalse();
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
