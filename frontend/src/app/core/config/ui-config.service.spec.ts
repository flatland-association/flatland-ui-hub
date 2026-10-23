import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UiConfigService } from './ui-config.service';

describe('UiConfigService — loading the real plan-b-ui-config.json', () => {
  let service: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(UiConfigService);
  });

  it('hides every id the checked-in file lists under "hidden"', async () => {
    await service.load('/assets/ui-configs/plan-b-ui-config.json');
    expect(service.isHidden('control.contrast')).toBeTrue();
    expect(service.isHidden('control.mapNavigation')).toBeTrue();
    expect(service.isHidden('control.endShift')).toBeTrue();
    expect(service.isHidden('widget.proposal-compare.axis.time')).toBeTrue();
  });

  it('leaves an id not listed under "hidden" visible', async () => {
    await service.load('/assets/ui-configs/plan-b-ui-config.json');
    expect(service.isHidden('widget.proposal-compare.axis.lateness')).toBeFalse();
    expect(service.isHidden('widget.decision-log')).toBeFalse();
  });

  it('collapses widget.decision-log by default', async () => {
    await service.load('/assets/ui-configs/plan-b-ui-config.json');
    expect(service.isCollapsedByDefault('widget.decision-log')).toBeTrue();
  });

  it('exposes the policy allowlist', async () => {
    await service.load('/assets/ui-configs/plan-b-ui-config.json');
    expect(service.policyAllowlist()).toEqual(['deadlock_avoidance', 'plan']);
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
});
