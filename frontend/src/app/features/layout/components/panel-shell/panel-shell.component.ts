import '@sbb-esta/lyne-elements/expansion-panel.js';

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  HostBinding,
  Input,
  OnChanges,
  SimpleChanges,
  effect,
  inject,
  signal,
  untracked,
  DestroyRef,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PanelFrameService, PanelInstance } from '../../../../core/layout';
import { LanguageService } from '../../../../core/i18n/language.service';
import { TourContextService } from '../../../../core/demo/tour-context.service';
import { TourGuideService } from '../../../../core/demo/tour-guide.service';
import { PanelPluginHostComponent } from '../panel-plugin-host/panel-plugin-host.component';
import { UiStateRegistry } from '../../../../core/interaction-log/ui-state-registry.service';
import { UiConfigService } from '../../../../core/config/ui-config.service';

@Component({
  selector: 'app-panel-shell',
  standalone: true,
  imports: [PanelPluginHostComponent, TranslocoPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './panel-shell.component.html',
  styleUrl: './panel-shell.component.scss',
})
export class PanelShellComponent implements OnChanges {
  @Input({ required: true }) panel!: PanelInstance;

  private readonly tour = inject(TourContextService);
  private readonly uiConfig = inject(UiConfigService);
  readonly i18n = inject(LanguageService);

  /** The layout hides this panel's title (`widget.<type>.title`, registered
   *  for `view-tabs` only): the panel is framed without header, so there is
   *  nothing left to collapse it with (docs/plans/zwl-default.md §4.2). */
  headerHidden(): boolean {
    return !!this.panel && this.uiConfig.isHidden(`widget.${this.panel.type}.title`);
  }

  colearningModule(): string | null {
    return this.tour.moduleFor(this.panel?.type);
  }

  /** Tooltip on a Co-Learning panel's title, naming the module the violet edge
   *  stands for. Replaces the chip the header used to carry. */
  moduleHint(): string | null {
    const module = this.colearningModule();
    return module ? this.i18n.t('panels.moduleHint', { module }) : null;
  }

  private readonly guide = inject(TourGuideService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private wasGuideFocus = false;

  /** The tour guide's current step points at this panel. */
  isGuideFocus(): boolean {
    return !!this.panel && this.guide.highlightPanelType() === this.panel.type;
  }

  constructor() {
    // When the guide moves to this panel, open it and bring it into view: a
    // module that becomes relevant below the fold is a module nobody notices.
    effect(() => {
      const focusType = this.guide.highlightPanelType();
      untracked(() => {
        const on = !!focusType && focusType === this.panel?.type;
        if (on && !this.wasGuideFocus) {
          if (!this.isCanvasPanel) {
            this.expanded.set(true);
            this.panel.collapsed = false;
          }
          queueMicrotask(() => this.revealVertically());
        }
        this.wasGuideFocus = on;
      });
    });
    // A request to open or close the frames of this panel's type (D25). Only
    // requests made once this frame exists: an older one was for the frames
    // there were then, and a frame built later follows its layout.
    const frames = inject(PanelFrameService);
    const since = untracked(frames.request)?.n ?? 0;
    effect(() => {
      const request = frames.request();
      untracked(() => {
        if (!request || request.n <= since) return;
        if (this.panel && request.type === this.panel.type) this.setExpanded(request.open);
      });
    });
  }

  /**
   * Scroll the nearest vertical scroller so this panel is in view. Not
   * `scrollIntoView`: that also scrolls ancestors sideways, and `app-root` clips
   * a header wider than narrow windows, so the whole app slid left.
   */
  private revealVertically(): void {
    const el = this.host.nativeElement;
    let scroller = el.parentElement;
    while (scroller) {
      const overflowY = getComputedStyle(scroller).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement;
    }
    const rect = el.getBoundingClientRect();
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
    const viewBottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    let offset = 0;
    if (rect.top < viewTop) offset = rect.top - viewTop;
    else if (rect.bottom > viewBottom) offset = Math.min(rect.bottom - viewBottom, rect.top - viewTop);
    if (offset === 0) return;
    if (scroller) scroller.scrollBy({ top: offset, behavior: 'smooth' });
    else window.scrollBy({ top: offset, behavior: 'smooth' });
  }

  private currentPanelId: string | null = null;
  readonly expanded = signal(true);
  private readonly uiState = inject(UiStateRegistry);
  private readonly destroyRef = inject(DestroyRef);
  private unregisterUiState: (() => void) | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['panel'] || !this.panel) {
      return;
    }

    if (this.currentPanelId !== this.panel.id) {
      this.currentPanelId = this.panel.id;
      this.expanded.set(this.isCanvasPanel || !this.panel.collapsed);
      this.unregisterUiState?.();
      this.unregisterUiState = this.uiState.register(`panel.${this.panel.id}.expanded`, this.expanded, this.destroyRef);
    }
  }

  @HostBinding('attr.data-panel-type')
  get hostPanelType(): string | null {
    return this.panel?.type ?? null;
  }

  @HostBinding('attr.data-panel-zone')
  get hostPanelZone(): string | null {
    return this.panel?.zone ?? null;
  }

  @HostBinding('class.layout-panel-shell-host--canvas')
  get isCanvasPanel(): boolean {
    return this.panel?.type === 'flatland-map' || this.panel?.type === 'graphic-timetable';
  }

  @HostBinding('class.layout-panel-shell-host--accordion')
  get isAccordionPanel(): boolean {
    return !this.isCanvasPanel;
  }

  get expandedAttribute(): '' | null {
    return this.expanded() ? '' : null;
  }

  isExpanded(): boolean {
    return this.expanded();
  }

  /** Open or close this frame on request (`PanelFrameService`). A canvas
   *  panel stays open, and a frame without a header is never closed: nothing
   *  would be left to open it with. */
  setExpanded(open: boolean): void {
    if (this.isCanvasPanel || (!open && this.headerHidden())) return;
    this.expanded.set(open);
    this.panel.collapsed = !open;
  }

  toggleExpanded(): void {
    if (this.isCanvasPanel) {
      this.expanded.set(true);
      this.panel.collapsed = false;
      return;
    }

    const next = !this.expanded();
    this.expanded.set(next);
    this.panel.collapsed = !next;
  }
}
