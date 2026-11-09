import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiConfigService } from '../../../../core/config/ui-config.service';
import { PanelFrameService, PanelInstance } from '../../../../core/layout';
import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { PanelPluginHostComponent } from '../panel-plugin-host/panel-plugin-host.component';
import { PanelShellComponent } from './panel-shell.component';

/** Stands in for the plugin host, so the shell renders no real panel. */
@Component({ selector: 'app-panel-plugin-host', standalone: true, template: '' })
class PluginHostStub {
  @Input() panel: PanelInstance | null = null;
}

describe('PanelShellComponent — a hidden title (#168)', () => {
  let fixture: ComponentFixture<PanelShellComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PanelShellComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    }).overrideComponent(PanelShellComponent, {
      remove: { imports: [PanelPluginHostComponent] },
      add: { imports: [PluginHostStub] },
    });
    fixture = TestBed.createComponent(PanelShellComponent);
    fixture.componentRef.setInput('panel', {
      id: 'pb-views',
      type: 'view-tabs',
      title: 'Streckenspiegel & ZWL',
      collapsed: false,
    } as PanelInstance);
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('frames the panel with its title and a collapsible header by default', () => {
    fixture.detectChanges();
    expect(el().querySelector('sbb-expansion-panel-header')).not.toBeNull();
    expect(el().querySelector('.layout-panel-shell__title')).not.toBeNull();
  });

  it('drops the header, and with it the collapse, when the layout hides the title', () => {
    TestBed.inject(UiConfigService).apply({ hidden: ['widget.view-tabs.title'] });
    fixture.detectChanges();
    expect(el().querySelector('sbb-expansion-panel')).toBeNull();
    expect(el().querySelector('.layout-panel-shell__title')).toBeNull();
    expect(el().querySelector('.layout-panel-shell--headerless app-panel-plugin-host'))
      .withContext('the content still renders')
      .not.toBeNull();
  });

  it('keeps the title of other panel types', () => {
    TestBed.inject(UiConfigService).apply({ hidden: ['widget.view-tabs.title'] });
    fixture.componentRef.setInput('panel', { id: 'tt', type: 'timetable', title: 'Fahrplan', collapsed: false } as PanelInstance);
    fixture.detectChanges();
    expect(el().querySelector('sbb-expansion-panel-header')).not.toBeNull();
  });
});

/** A frame follows requests for its panel type (docs/plans/reflection-inline.md
 *  §4.8, D25): closed after a choice, opened for new options. */
describe('PanelShellComponent — open and close on request', () => {
  let fixture: ComponentFixture<PanelShellComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PanelShellComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    }).overrideComponent(PanelShellComponent, {
      remove: { imports: [PanelPluginHostComponent] },
      add: { imports: [PluginHostStub] },
    });
    fixture = TestBed.createComponent(PanelShellComponent);
    fixture.componentRef.setInput('panel', { id: 'pb-whatif', type: 'proposal-compare', title: 'Plan / KI / Mensch', collapsed: false } as PanelInstance);
    fixture.detectChanges();
  });

  it('closes and opens again for its own type, and drops its content while closed', () => {
    const frames = TestBed.inject(PanelFrameService);
    frames.setExpanded('proposal-compare', false);
    fixture.detectChanges();
    expect(fixture.componentInstance.isExpanded()).toBeFalse();
    expect(fixture.nativeElement.querySelector('app-panel-plugin-host')).toBeNull();
    frames.setExpanded('proposal-compare', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.isExpanded()).toBeTrue();
  });

  it('ignores requests for other panel types', () => {
    TestBed.inject(PanelFrameService).setExpanded('decision-log', false);
    fixture.detectChanges();
    expect(fixture.componentInstance.isExpanded()).toBeTrue();
  });

  it('follows its layout, not a request made before it existed', () => {
    TestBed.inject(PanelFrameService).setExpanded('proposal-compare', false);
    const later = TestBed.createComponent(PanelShellComponent);
    later.componentRef.setInput('panel', { id: 'pb-whatif-2', type: 'proposal-compare', title: 'Plan / KI / Mensch', collapsed: false } as PanelInstance);
    later.detectChanges();
    expect(later.componentInstance.isExpanded()).toBeTrue();
  });
});
