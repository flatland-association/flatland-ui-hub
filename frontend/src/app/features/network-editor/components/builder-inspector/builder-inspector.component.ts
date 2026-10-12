import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NetworkEditorStoreService } from '../../services/network-editor-store.service';

@Component({
  selector: 'app-builder-inspector',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './builder-inspector.component.html',
  styleUrl: './builder-inspector.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class BuilderInspectorComponent {
  readonly store = inject(NetworkEditorStoreService);
}
