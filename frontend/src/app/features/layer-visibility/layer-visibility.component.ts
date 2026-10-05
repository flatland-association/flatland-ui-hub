import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SessionStore } from '../../core/session.store';
import { EventBusService } from '../../core/events/event-bus.service';
import { LayerVisibility } from '../../core/events/event-types';

/**
 * Layer-Visibility: Toggles fuer Trains / Switches / Signals.
 * Stand: kontrolliert nur den Store-Signal layerVisibility.
 * In Phase E emittiert es LAYER_VISIBILITY_CHANGED auf den EventBus.
 *
 * A chip shows the resolved state (mode default, or the operator's choice where
 * they made one) and writes a choice, not the whole set — the modes have
 * different defaults now, and a full-set write would flatten the mode's baseline
 * into the first toggle. `core/layout/layer-mode-defaults.ts` owns the defaults.
 */
@Component({
  selector: 'app-layer-visibility',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './layer-visibility.component.html',
  styleUrl: './layer-visibility.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class LayerVisibilityComponent {
  store = inject(SessionStore);
  bus = inject(EventBusService);

  /** Symbol key for the map. HMI review: "Was bedeuten die Icons? Sie
   *  waren vorher nicht sichtbar." — toggling a layer on made glyphs appear
   *  that nothing on screen explained. Closed by default so it costs no space
   *  until asked for. */
  readonly legendOpen = signal(false);

  toggleLegend(): void {
    this.legendOpen.update((v) => !v);
  }

  toggle(layer: keyof LayerVisibility) {
    this.store.setLayerVisible(layer, !this.store.layerVisibility()[layer]);
    this.bus.emit({ type: 'LAYER_VISIBILITY_CHANGED', layers: this.store.layerVisibility() });
  }

  /** Back to what this mode opens with. Offered only while something differs,
   *  because otherwise the mode's defaults would quietly stop applying after the
   *  first toggle and there would be no way back to them. */
  resetToModeDefaults(): void {
    this.store.resetLayersToModeDefaults();
    this.bus.emit({ type: 'LAYER_VISIBILITY_CHANGED', layers: this.store.layerVisibility() });
  }
}
