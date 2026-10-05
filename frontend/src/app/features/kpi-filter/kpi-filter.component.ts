import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, HostBinding, Input, effect, inject, signal } from '@angular/core';
import { SessionStore } from '../../core/session.store';
import { EventBusService } from '../../core/events/event-bus.service';
import { KpiPriorities } from '../../core/events/event-types';
import { TranslocoPipe } from '@jsverse/transloco';

interface KpiDef {
  key: keyof KpiPriorities;
  label: string;
}

@Component({
  selector: 'app-kpi-filter',
  standalone: true,
  imports: [TranslocoPipe, CommonModule],
  templateUrl: './kpi-filter.component.html',
  styleUrl: './kpi-filter.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class KpiFilterComponent {
  @Input() embedded = false;

  @HostBinding('class.embedded')
  get embeddedClass(): boolean {
    return this.embedded;
  }

  store = inject(SessionStore);
  bus = inject(EventBusService);

  /** KPI is the primary directive lever in Director mode → expanded there;
   *  collapsed elsewhere to keep the screen simple. Re-defaults on mode change;
   *  the user can still toggle within a mode. */
  readonly collapsed = signal<boolean>(false);

  constructor() {
    effect(() => {
      const director = this.store.aiInControl();
      // Runs initially and whenever the mode crosses into/out of Director.
      this.collapsed.set(!director);
    });
  }

  toggleCollapsed() {
    this.collapsed.update((v) => !v);
  }

  kpis: KpiDef[] = [
    { key: 'time',            label: 'Time' },
    { key: 'energy',          label: 'Energy' },
    { key: 'platformRouting', label: 'Platform Routing' },
    { key: 'trainRouting',    label: 'Train Routing' },
  ];

  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Slider hat 11 Schritte: 0, 0.1, 0.2, ..., 1.0
  setValue(key: keyof KpiPriorities, value: number) {
    const cur = this.store.kpiPriorities();
    const next: KpiPriorities = { ...cur, [key]: Math.max(0, Math.min(1, value)) };
    this.store.kpiPriorities.set(next);
    this.bus.emit({ type: 'KPI_FILTER_CHANGED', priorities: next });
    // KPI weights now affect backend scoring (scenarios + recommendation).
    // Debounce so dragging across several dots triggers a single recompute.
    this._scheduleForecastRefresh();
  }

  private _scheduleForecastRefresh() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.store.refreshForecasts();
    }, 500);
  }

  onSlider(key: keyof KpiPriorities, event: Event) {
    const v = +(event.target as HTMLInputElement).value / 100;
    this.setValue(key, v);
  }

  // 10 Dots fuer Visualisierung
  dotStates(value: number): boolean[] {
    const filled = Math.round(value * 10);
    return Array.from({ length: 10 }, (_, i) => i < filled);
  }

  pct(value: number): string {
    return `${Math.round(value * 100)}%`;
  }
}
