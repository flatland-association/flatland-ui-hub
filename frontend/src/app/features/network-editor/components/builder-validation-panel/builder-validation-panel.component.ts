import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NetworkEditorStoreService } from '../../services/network-editor-store.service';

@Component({
  selector: 'app-builder-validation-panel',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './builder-validation-panel.component.html',
  styleUrl: './builder-validation-panel.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class BuilderValidationPanelComponent {
  readonly store = inject(NetworkEditorStoreService);
}
