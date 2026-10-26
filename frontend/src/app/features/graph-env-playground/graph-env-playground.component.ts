import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { GraphEnvEventsComponent } from './graph-env-events.component';
import { GraphEnvMapComponent } from './graph-env-map.component';
import { GraphEnvStore } from './graph-env.store';
import { GraphEnvToolbarComponent } from './graph-env-toolbar.component';

/**
 * The graph env playground page at `/graph-env` (docs/plans/graph-env-playground.md): a GraphRailEnv on the
 * Walenstadt network, stepped with the shortest-path policy. Every load creates a new backend session, so a reload
 * resets the env. Not integrated with the rest of the app.
 */
@Component({
  selector: 'app-graph-env-playground',
  standalone: true,
  imports: [TranslocoPipe, GraphEnvToolbarComponent, GraphEnvMapComponent, GraphEnvEventsComponent],
  providers: [GraphEnvStore],
  templateUrl: './graph-env-playground.component.html',
  styleUrl: './graph-env-playground.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class GraphEnvPlaygroundComponent implements OnInit {
  readonly store = inject(GraphEnvStore);

  ngOnInit(): void {
    this.store.init();
  }
}
