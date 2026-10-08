import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { ApiService } from '../../core/api.service';
import { SetupPreset } from '../../core/models';
import { ConfigShellComponent } from '../config-shell/config-shell.component';

@Component({
  selector: 'app-setup-catalog',
  standalone: true,
  imports: [CommonModule, ConfigShellComponent, TranslocoPipe],
  templateUrl: './setup-catalog.component.html',
  styleUrl: './setup-catalog.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SetupCatalogComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly presets = signal<SetupPreset[]>([]);
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
    this.api.listSetups().subscribe({
      next: (presets) => {
        this.presets.set(presets);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('setupCatalog.loadError');
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
