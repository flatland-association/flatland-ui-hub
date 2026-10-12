import { Component, OnInit, inject } from '@angular/core';
import {
  LayoutStoreService,
  PanelInstance,
} from '../../../../core/layout';
import { LayoutRendererComponent } from '../../components/layout-renderer/layout-renderer.component';

@Component({
  selector: 'app-layout-sandbox',
  standalone: true,
  imports: [
    LayoutRendererComponent,
  ],
  templateUrl: './layout-sandbox.component.html',
  styleUrl: './layout-sandbox.component.scss',
})
export class LayoutSandboxComponent implements OnInit {
  private readonly store = inject(LayoutStoreService);

  ngOnInit(): void {
    this.seedDemoLayout();
  }

  private seedDemoLayout(): void {
    if (this.store.snapshot().panels.length > 0) {
      return;
    }

    const panels: PanelInstance[] = [
      {
        id: 'sandbox-situation-summary',
        type: 'situation-summary',
        title: 'Situation Summary',
        zone: 'left',
        order: 5,
        collapsed: false,
        hidden: false,
        sizeMode: 'auto',
      },
      {
        id: 'sandbox-notifications',
        type: 'notifications',
        title: 'Notifications',
        zone: 'left',
        order: 10,
        collapsed: false,
        hidden: false,
        sizeMode: 'auto',
      },
      {
        id: 'sandbox-agents',
        type: 'agents',
        title: 'Agents',
        zone: 'left',
        order: 20,
        collapsed: false,
        hidden: false,
        sizeMode: 'auto',
      },
      {
        id: 'sandbox-kpi-filter',
        type: 'kpi-filter',
        title: 'KPI Filter',
        zone: 'left',
        order: 30,
        collapsed: false,
        hidden: false,
        sizeMode: 'auto',
      },
      {
        id: 'sandbox-map',
        type: 'flatland-map',
        title: 'Flatland Map',
        zone: 'center',
        order: 10,
        collapsed: false,
        hidden: false,
        sizeMode: 'fill',
      },
      {
        id: 'sandbox-graphic-timetable',
        type: 'graphic-timetable',
        title: 'Graphic Timetable',
        zone: 'center',
        order: 20,
        collapsed: false,
        hidden: false,
        sizeMode: 'auto',
      },
      {
        id: 'sandbox-scenario',
        type: 'strategy-comparison',
        title: 'Strategy comparison',
        zone: 'right',
        order: 10,
        collapsed: false,
        hidden: false,
        sizeMode: 'auto',
      },
      {
        id: 'sandbox-recommendations',
        type: 'recommendations',
        title: 'Recommendations',
        zone: 'right',
        order: 20,
        collapsed: false,
        hidden: false,
        sizeMode: 'auto',
      },
      {
        id: 'sandbox-impact',
        type: 'impact',
        title: 'Impact',
        zone: 'right',
        order: 30,
        collapsed: false,
        hidden: false,
        sizeMode: 'auto',
      },
    ];

    for (const panel of panels) {
      this.store.addPanel(panel);
    }
  }
}
