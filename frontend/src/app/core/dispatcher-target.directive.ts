import { Directive, ElementRef, Injectable, computed, effect, inject, input, signal } from '@angular/core';
import { DispatcherActivityService } from './dispatcher-activity.service';

/** Semantic UI anchors. Geometry is used only for the visual explanation. */
@Injectable({ providedIn: 'root' })
export class DispatcherTargets {
  readonly elements = signal<ReadonlyMap<string, readonly HTMLElement[]>>(new Map());
  register(key: string, element: HTMLElement): () => void {
    this.elements.update(entries => new Map(entries).set(key, [...(entries.get(key) ?? []), element]));
    return () => this.elements.update(entries => {
      const next = new Map(entries);
      next.set(key, (entries.get(key) ?? []).filter(item => item !== element));
      return next;
    });
  }
}

@Directive({
  selector: '[dispatcherTarget]', standalone: true,
  host: {
    '[attr.data-dispatcher-target]': 'dispatcherTarget()',
    '[attr.data-dispatcher-highlight]': 'highlight()',
  },
})
export class DispatcherTargetDirective {
  readonly dispatcherTarget = input('');
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly targets = inject(DispatcherTargets);
  private readonly activity = inject(DispatcherActivityService);
  readonly highlight = computed(() => {
    const actor = this.activity.store.dispatcher();
    const action = this.activity.interactionTarget();
    return actor?.owner === 'agent' && this.dispatcherTarget() !== 'map'
      && action?.targetKey === this.dispatcherTarget() ? action.stage : null;
  });
  constructor() {
    effect(cleanup => {
      const key = this.dispatcherTarget();
      if (key) cleanup(this.targets.register(key, this.element.nativeElement));
    });
  }
}
