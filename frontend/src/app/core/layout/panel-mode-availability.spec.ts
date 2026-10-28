import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UiConfigService } from '../config/ui-config.service';
import { isPanelAvailable, isPanelAvailableInMode } from './panel-mode-availability';

describe('isPanelAvailable — the mode gate and the config gate together', () => {
  let uiConfig: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    uiConfig = TestBed.inject(UiConfigService);
  });

  it('allows a panel that neither gate objects to', () => {
    expect(isPanelAvailable('impact', 'co-learning', uiConfig)).toBeTrue();
  });

  it('hides a panel the config names, in a mode that would allow it', () => {
    expect(isPanelAvailable('impact', 'co-learning', uiConfig)).toBeTrue();
    uiConfig.apply({ hidden: ['widget.impact'] });
    expect(isPanelAvailable('impact', 'co-learning', uiConfig)).toBeFalse();
  });

  it('leaves the mode gate alone — a config that hides nothing changes nothing', () => {
    uiConfig.apply({ hidden: ['widget.impact'] });
    // director-directive is mode-restricted; the config says nothing about it.
    expect(isPanelAvailable('director-directive', 'co-learning', uiConfig)).toBeFalse();
    expect(isPanelAvailable('director-directive', 'director', uiConfig)).toBeTrue();
  });

  it('keeps a mode-restricted panel hidden even when the config is dropped', () => {
    uiConfig.apply({ hidden: ['widget.director-directive'] });
    expect(isPanelAvailable('director-directive', 'director', uiConfig)).toBeFalse();
    uiConfig.apply({});
    expect(isPanelAvailable('director-directive', 'director', uiConfig)).toBeTrue();
  });

  it('does not change isPanelAvailableInMode, which knows nothing about the config', () => {
    uiConfig.apply({ hidden: ['widget.impact'] });
    expect(isPanelAvailableInMode('impact', 'co-learning')).toBeTrue();
  });
});
