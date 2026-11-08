import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import '@sbb-esta/lyne-elements/button.js';
import '@sbb-esta/lyne-elements/menu.js';
import type { SbbMenuElement } from '@sbb-esta/lyne-elements/menu.js';
import { UiConfigService } from '../../core/config/ui-config.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ConfigShellComponent } from './config-shell.component';

@Component({
  standalone: true,
  imports: [ConfigShellComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<app-config-shell #shell active="dispatcher">
    <sbb-menu-button configActions data-testid="settings-action"
      (click)="shell.requestMenuClose(); settingsOpen.set(true)">Settings</sbb-menu-button>
    </app-config-shell>
    @if (settingsOpen()) { <button data-testid="settings-control">Basic settings</button> }`,
})
class SettingsMenuHost {
  readonly settingsOpen = signal(false);
}

describe('ConfigShellComponent — Settings menu lifecycle', () => {
  let fixture: ComponentFixture<SettingsMenuHost>;
  let menu: SbbMenuElement;
  let action: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [SettingsMenuHost],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(SettingsMenuHost);
    fixture.detectChanges();
    await fixture.whenStable();
    menu = fixture.nativeElement.querySelector('sbb-menu');
    await menu.updateComplete;
    // Exercise actual animation events while keeping the isolated unit quick.
    menu.style.setProperty('--sbb-menu-animation-duration', '40ms');
    action = fixture.nativeElement.querySelector('[data-testid="settings-action"]');
  });

  const nextEvent = (element: HTMLElement, name: string): Promise<void> =>
    new Promise(resolve => element.addEventListener(name, () => resolve(), { once: true }));

  const expectSettingsAccessible = () => {
    fixture.detectChanges();
    const control = fixture.nativeElement.querySelector('[data-testid="settings-control"]') as HTMLButtonElement;
    expect(control).not.toBeNull();
    expect(menu.matches(':popover-open')).toBeFalse();
    expect(control.closest('[inert]')).toBeNull();
    control.focus();
    expect(document.activeElement).toBe(control);
  };

  it('closes after a projected Settings action is activated during opening', async () => {
    const events: string[] = [];
    menu.addEventListener('open', () => events.push('open'));
    menu.addEventListener('close', () => events.push('close'));
    const closed = nextEvent(menu, 'close');
    menu.open();
    expect(menu.isOpen).toBeFalse();
    expect(menu.trigger?.getAttribute('aria-expanded')).toBe('true');
    action.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.settingsOpen()).toBeTrue();
    await closed;
    expect(events).toEqual(['open', 'close']);
    expectSettingsAccessible();

    // A fulfilled queued close must not close the next ordinary opening.
    const openedAgain = nextEvent(menu, 'open');
    menu.open();
    await openedAgain;
    expect(menu.isOpen).toBeTrue();
    const closedAgain = nextEvent(menu, 'close');
    menu.close();
    await closedAgain;
  });

  it('closes normally when Settings is activated after the menu opened', async () => {
    const opened = nextEvent(menu, 'open');
    menu.open();
    await opened;
    expect(menu.isOpen).toBeTrue();
    const closed = nextEvent(menu, 'close');
    action.click();
    await closed;
    expectSettingsAccessible();
  });
});

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
