import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
  effect,
  inject,
  signal,
} from '@angular/core';
import * as L from 'leaflet';
import { AgentColorService } from '../../core/agent-color.service';
import { GraphEnvAgent, GraphEnvNetwork, LatLon } from './graph-env.models';
import { GraphEnvStore } from './graph-env.store';

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

interface TrainMarker {
  marker: L.Marker;
  /** The icon's selected state, so the icon is only rebuilt when it changes. */
  selected: boolean | null;
  animation: number | null;
}

/**
 * The graph env on OpenStreetMap tiles (docs/plans/graph-env-playground.md §7): tracks, nodes and the trains.
 *
 * Leaflet runs outside the Angular zone; hover and click go back into it. The view is fitted to the network once, then
 * left to the user, so zoom and pan are kept. While playing, trains glide from their previous to their new position
 * over one step interval; when paused they snap to the exact state (docs/plans/smooth-playback.md).
 */
@Component({
  selector: 'app-graph-env-map',
  standalone: true,
  template: '<div #map class="graph-env-map"></div>',
  styleUrl: './graph-env-map.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class GraphEnvMapComponent implements AfterViewInit, OnDestroy {
  private readonly store = inject(GraphEnvStore);
  private readonly agentColors = inject(AgentColorService);
  private readonly zone = inject(NgZone);

  @ViewChild('map', { static: true }) private readonly mapElement!: ElementRef<HTMLDivElement>;

  private map: L.Map | null = null;
  private readonly mapReady = signal(false);
  private readonly networkLayer = L.layerGroup();
  private readonly trainLayer = L.layerGroup();
  private readonly trains = new Map<number, TrainMarker>();
  private fitted = false;

  constructor() {
    effect(() => {
      const network = this.store.network();
      if (this.mapReady() && network) this.zone.runOutsideAngular(() => this.drawNetwork(network));
    });
    effect(() => {
      const agents = this.store.agents();
      const selected = this.store.selectedHandle();
      const animate = this.store.playing();
      const durationMs = 1000 / this.store.playSpeed();
      if (this.mapReady()) this.zone.runOutsideAngular(() => this.drawTrains(agents, selected, animate, durationMs));
    });
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      const map = L.map(this.mapElement.nativeElement, { zoomControl: true });
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
      this.networkLayer.addTo(map);
      this.trainLayer.addTo(map);
      map.on('click', () => this.zone.run(() => this.store.selectedHandle.set(null)));
      this.map = map;
    });
    this.mapReady.set(true);
  }

  ngOnDestroy(): void {
    for (const train of this.trains.values()) {
      if (train.animation !== null) cancelAnimationFrame(train.animation);
    }
    this.map?.remove();
  }

  private drawNetwork(network: GraphEnvNetwork): void {
    this.networkLayer.clearLayers();
    for (const className of ['graph-track-casing', 'graph-track']) {
      L.polyline(network.tracks, { className, interactive: false }).addTo(this.networkLayer);
    }
    for (const node of network.nodes) {
      L.circleMarker([node.lat, node.lon], {
        radius: node.is_switch ? 4 : 3,
        className: node.is_switch ? 'graph-node graph-node--switch' : 'graph-node',
        interactive: false,
      }).addTo(this.networkLayer);
    }
    if (!this.fitted && this.map) {
      this.map.fitBounds(network.bounds, { padding: [24, 24] });
      this.fitted = true;
    }
  }

  private drawTrains(agents: GraphEnvAgent[], selected: number | null, animate: boolean, durationMs: number): void {
    const onMap = new Set<number>();
    for (const agent of agents) {
      if (agent.lat === null || agent.lon === null) continue;
      onMap.add(agent.handle);
      const position: LatLon = [agent.lat, agent.lon];
      const isSelected = agent.handle === selected;
      let train = this.trains.get(agent.handle);
      if (!train) {
        train = { marker: this.createTrainMarker(agent.handle, position), selected: null, animation: null };
        this.trains.set(agent.handle, train);
        this.moveTo(train, position, false, durationMs);
      } else {
        this.moveTo(train, position, animate, durationMs);
      }
      if (train.selected !== isSelected) {
        train.marker.setIcon(this.trainIcon(agent.handle, isSelected));
        train.selected = isSelected;
      }
    }
    for (const [handle, train] of this.trains) {
      if (onMap.has(handle)) continue;
      if (train.animation !== null) cancelAnimationFrame(train.animation);
      train.marker.remove();
      this.trains.delete(handle);
    }
  }

  private createTrainMarker(handle: number, position: LatLon): L.Marker {
    const marker = L.marker(position, { icon: this.trainIcon(handle, false), zIndexOffset: 1000, keyboard: false });
    marker.on('mouseover', () => this.zone.run(() => this.store.hoveredHandle.set(handle)));
    marker.on('mouseout', () => this.zone.run(() => {
      if (this.store.hoveredHandle() === handle) this.store.hoveredHandle.set(null);
    }));
    marker.on('click', () => this.zone.run(() => this.store.toggleAgentSelection(handle)));
    marker.addTo(this.trainLayer);
    return marker;
  }

  /** Linear glide from the drawn position to `to` over `durationMs` while playing, else a snap. */
  private moveTo(train: TrainMarker, to: LatLon, animate: boolean, durationMs: number): void {
    if (train.animation !== null) {
      cancelAnimationFrame(train.animation);
      train.animation = null;
    }
    const from = train.marker.getLatLng();
    if (!animate || (from.lat === to[0] && from.lng === to[1])) {
      train.marker.setLatLng(to);
      return;
    }
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      train.marker.setLatLng([from.lat + t * (to[0] - from.lat), from.lng + t * (to[1] - from.lng)]);
      train.animation = t < 1 ? requestAnimationFrame(frame) : null;
    };
    train.animation = requestAnimationFrame(frame);
  }

  /** The grid map's train glyph (features/flatland-map/flatland-map.component.html, "Agents"): its circle and handle
   *  text with the same classes and attributes, centred on the marker. */
  private trainIcon(handle: number, selected: boolean): L.DivIcon {
    const color = this.agentColor(handle, selected);
    const fill = selected ? 'var(--app-select-color)' : color;
    return L.divIcon({
      className: 'graph-env-icon',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      html: `<svg width="30" height="30" viewBox="-15 -15 30 30">
        <g class="agent flatland-agent-marker${selected ? ' selected flatland-agent-marker-selected' : ''}"
           style="--flatland-agent-color: ${color}">
          <circle cx="0" cy="0" r="9" stroke-width="2.5" class="agent-main-circle" fill="${fill}" stroke="${fill}"/>
          <text x="0" y="4" text-anchor="middle" font-size="11" font-weight="bold"
                class="flatland-agent-id-text agent-handle-text" fill="var(--app-on-fill)" stroke="none">${handle}</text>
        </g>
      </svg>`,
    });
  }

  /** As the grid map's `agentColor`: the solid agent colour, in its focus state when selected. */
  private agentColor(handle: number, selected: boolean): string {
    return this.agentColors.getColorSolid(handle, selected ? 'focus' : 'default');
  }
}
