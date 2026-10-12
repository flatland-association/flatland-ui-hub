import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { InfrastructureExportService } from '../../services/infrastructure-export.service';
import { NetworkEditorStoreService } from '../../services/network-editor-store.service';

@Component({
  selector: 'app-builder-export-panel',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './builder-export-panel.component.html',
  styleUrl: './builder-export-panel.component.scss',
})
export class BuilderExportPanelComponent {
  private readonly exporter = inject(InfrastructureExportService);
  readonly store = inject(NetworkEditorStoreService);
  readonly exportFormat = signal<'json' | 'mermaid'>('json');

  readonly exportText = computed(() => this.exportFormat() === 'json'
    ? this.exporter.exportJson(this.store.scene())
    : this.exporter.exportMermaid(this.store.scene()));
}
