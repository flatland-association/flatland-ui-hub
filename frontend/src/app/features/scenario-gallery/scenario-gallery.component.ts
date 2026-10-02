import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { ApiService } from '../../core/api.service';
import { ScenarioPreset } from '../../core/models';
import { ConfigShellComponent } from '../config-shell/config-shell.component';

@Component({
  selector: 'app-scenario-gallery',
  standalone: true,
  imports: [CommonModule, ConfigShellComponent, TranslocoPipe],
  templateUrl: './scenario-gallery.component.html',
  styleUrl: './scenario-gallery.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ScenarioGalleryComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly presets = signal<ScenarioPreset[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly query = signal('');

  readonly shownPresets = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return this.presets();
    return this.presets().filter((preset) =>
      [
        preset.id,
        preset.name,
        preset.network,
        preset.traffic,
        preset.disruption,
        preset.source,
        preset.description,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  });

  ngOnInit(): void {
    this.api.listScenarioPresets().subscribe({
      next: (presets) => {
        this.presets.set(presets);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('scenarioGallery.loadError');
        this.loading.set(false);
      },
    });
  }

  setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  modeLabel(mode: string): string {
    return `mode.${mode}`;
  }
}
