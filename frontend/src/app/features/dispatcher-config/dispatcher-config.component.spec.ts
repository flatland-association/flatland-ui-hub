import '@sbb-esta/lyne-elements/radio-button-group.js';
import '@sbb-esta/lyne-elements/radio-button-panel.js';
import '@sbb-esta/lyne-elements/selection-expansion-panel.js';
import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { DispatcherConfig, DispatcherOperatorType } from '../../core/dispatcher';
import { InteractionMode } from '../../core/events/event-types';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { DispatcherConfigComponent } from './dispatcher-config.component';

@Component({
  standalone: true,
  imports: [DispatcherConfigComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<sbb-radio-button-group [value]="door()" (change)="changeDoor($any($event.target).value)">
    <sbb-selection-expansion-panel><sbb-radio-button-panel value="introduction">Introduction</sbb-radio-button-panel></sbb-selection-expansion-panel>
    <sbb-selection-expansion-panel><sbb-radio-button-panel value="build">Build</sbb-radio-button-panel>
    <div slot="content"><app-dispatcher-config [mode]="mode()" (modeChange)="mode.set($event)"
    [(value)]="config" [(operatorType)]="operator" /></div></sbb-selection-expansion-panel></sbb-radio-button-group>`,
})
class ConfigHost {
  readonly door = signal('build');
  changeDoor(value: string): void { if (value === 'build' || value === 'introduction') this.door.set(value); }
  readonly mode = signal<InteractionMode>('recommendation');
  readonly config = signal<DispatcherConfig | null>(null);
  readonly operator = signal<DispatcherOperatorType>('human');
}

describe('DispatcherConfigComponent native weights', () => {
  it('retains edited Director initial weights inside the welcome selection panel', async () => {
    TestBed.configureTestingModule({
      imports: [ConfigHost],
      providers: [provideTranslocoTesting(), { provide: ApiService, useValue: {
        dispatcherProfiles: () => of({ baseline: { modes: ['recommendation', 'director'], capability: '' } }),
      } }],
    });
    const fixture = TestBed.createComponent(ConfigHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const change = (testId: string, value: string) => {
      const element = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement;
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      fixture.detectChanges();
    };
    change('dispatcher-operator', 'human_dispatcher_team');
    change('dispatcher-mode', 'director');
    const weights = { punctuality: 2, connections: 2, stability: 5 };
    for (const [axis, weight] of Object.entries(weights)) {
      const element = fixture.nativeElement.querySelector(`[data-testid="dispatcher-initial-${axis}"]`) as HTMLInputElement;
      element.value = String(weight);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(element.value).toBe(String(weight));
    }
    expect(fixture.componentInstance.config()?.initial).toEqual(weights);
  });
});
