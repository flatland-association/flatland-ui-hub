import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { BrandThemeService } from '../../core/theme/brand-theme.service';
import { ColorSchemeService } from '../../core/theme/color-scheme.service';

export type ConfigArea =
  | 'dispatcher'
  | 'designer'
  | 'network-editor'
  | 'widgets'
  | 'strategies'
  | 'setups'
  | 'contribute';

interface AreaLink {
  id: ConfigArea;
  labelKey: string;
  href: string;
  icon: string;
}

const AREA_LINKS: AreaLink[] = [
  { id: 'dispatcher', labelKey: 'dispatcher', href: '/', icon: 'train-small' },
  { id: 'designer', labelKey: 'layoutDesigner', href: '/designer', icon: 'four-squares-small' },
  { id: 'network-editor', labelKey: 'networkEditor', href: '/network-editor', icon: 'location-pin-map-small' },
  { id: 'widgets', labelKey: 'widgets', href: '/widgets', icon: 'nine-squares-small' },
  { id: 'strategies', labelKey: 'strategies', href: '/strategies', icon: 'robot-small' },
  { id: 'setups', labelKey: 'setups', href: '/setups', icon: 'map-small' },
  { id: 'contribute', labelKey: 'contribute', href: '/contribute', icon: 'handshake-small' },
];

/**
 * Shared app chrome — a single topbar strip (brand + Menu) used by every
 * full-page surface (Dispatcher, Layout Designer, Infrastructure Builder,
 * Widget Gallery) so all four share one consistent header instead of each
 * hand-rolling its own.
 *
 * Area-to-area navigation lives inside the Menu's "Areas" section (generated
 * here, once, for every surface) rather than as always-visible top-bar tabs —
 * those crowded the bar and fought for attention with the live Dispatcher view.
 * A surface's own actions are projected via `[configActions]`, rendered above
 * the Areas section; add a trailing `<sbb-divider configActions>` as your last
 * action if you have any (Widgets Gallery has none, so it skips straight to
 * Areas). A surface that needs extra controls inline in the bar itself (e.g.
 * the Dispatcher's interaction-mode tabs) projects them via `[configCenter]`:
 *
 *   <app-config-shell active="designer" [skipAreas]="['dispatcher']">
 *     <sbb-menu-button configActions (click)="applyAndOpenDispatcher()">Apply &amp; open dispatcher</sbb-menu-button>
 *   </app-config-shell>
 *   <!-- surface body follows -->
 *
 * `skipAreas` omits an area from the generated list when the surface already
 * offers its own, more specific way to reach it (e.g. Designer's save-first
 * "Apply & open dispatcher" instead of a plain "Dispatcher" link) — so there's
 * exactly one way there, not two.
 */
@Component({
  selector: 'app-config-shell',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './config-shell.component.html',
  styleUrl: './config-shell.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ConfigShellComponent {
  /** App language. The switch lives in this shared menu so every surface offers it,
   *  but only in-scope copy follows it — internal tools stay English by design
   *  (docs/plans/i18n-strategy.md). */
  readonly i18n = inject(LanguageService);

  /** Lyne theme (off-brand / standard / safety) — a per-browser preference like
   *  the language (docs/plans/colour-independence-plan.md). */
  readonly brandTheme = inject(BrandThemeService);
  /** Light / dark / auto — a per-browser preference like the theme above. */
  readonly colorScheme = inject(ColorSchemeService);

  /** Which surface is active — drives the brand subtitle and is excluded from Areas. */
  @Input({ required: true }) active!: ConfigArea;

  /** Areas to omit from the generated Areas menu section (see class doc). */
  @Input() skipAreas: ConfigArea[] = [];

  private readonly subtitles: Record<ConfigArea, string> = {
    dispatcher: 'shell.subtitle',
    designer: 'shell.area.layoutDesigner',
    'network-editor': 'shell.area.networkEditor',
    widgets: 'shell.area.widgets',
    strategies: 'shell.area.strategies',
    setups: 'shell.area.setups',
    contribute: 'shell.area.contribute',
  };

  get subtitleKey(): string {
    return this.subtitles[this.active];
  }

  get areaLinks(): AreaLink[] {
    return AREA_LINKS.filter((a) => a.id !== this.active && !this.skipAreas.includes(a.id));
  }
}
