import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiConfigService } from '../../core/config/ui-config.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ConfigShellComponent } from './config-shell.component';

describe('ConfigShellComponent — the Menu\'s Areas section', () => {
  let fixture: ComponentFixture<ConfigShellComponent>;
  let cmp: ConfigShellComponent;
  let uiConfig: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConfigShellComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ConfigShellComponent);
    cmp = fixture.componentInstance;
    cmp.active = 'dispatcher';
    uiConfig = TestBed.inject(UiConfigService);
  });

  it('offers every other area by default', () => {
    expect(cmp.areaLinks.length).toBeGreaterThan(0);
    expect(cmp.areaLinks.some((a) => a.id === 'designer')).toBeTrue();
  });

  it('never links to the surface you are already on', () => {
    expect(cmp.areaLinks.some((a) => a.id === 'dispatcher')).toBeFalse();
  });

  it('offers nothing once control.menuAreas is hidden', () => {
    uiConfig.apply({ hidden: ['control.menuAreas'] });
    expect(cmp.areaLinks).toEqual([]);
  });

  it('renders no links and no section heading when it is hidden', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('sbb-menu-link').length).toBeGreaterThan(0);

    uiConfig.apply({ hidden: ['control.menuAreas'] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('sbb-menu-link').length).toBe(0);
  });

  it('comes back when the restriction is dropped', () => {
    uiConfig.apply({ hidden: ['control.menuAreas'] });
    uiConfig.apply({});
    expect(cmp.areaLinks.length).toBeGreaterThan(0);
  });

  it('still honours skipAreas on its own', () => {
    cmp.skipAreas = ['designer'];
    expect(cmp.areaLinks.some((a) => a.id === 'designer')).toBeFalse();
    expect(cmp.areaLinks.length).toBeGreaterThan(0);
  });
});
