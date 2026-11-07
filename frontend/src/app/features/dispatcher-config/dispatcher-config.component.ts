import { ApiService } from '../../core/api.service';
import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DEFAULT_DISPATCHER, DispatcherConfig, DispatcherDemo, DispatcherProfile, DispatcherOperatorType, Directive } from '../../core/dispatcher';
import { InteractionMode } from '../../core/events/event-types';

@Component({
  selector: 'app-dispatcher-config', standalone: true, imports: [TranslocoPipe],
  template: `
    <fieldset data-testid="dispatcher-config">
      <legend>{{ 'dispatcher.operator' | transloco }}</legend>
      <label>{{ 'dispatcher.operator' | transloco }}
        <select data-testid="dispatcher-operator" [value]="!value() ? 'human' : operatorType() === 'human_dispatcher_team' ? 'human_dispatcher_team' : 'agent'" (change)="selectOperator($any($event.target).value)">
          <option value="human">{{ 'dispatcher.human' | transloco }}</option>
          <option value="agent" [disabled]="!specs() || mode() === 'co-learning'">{{ 'dispatcher.synthetic' | transloco }}</option>
          <option value="human_dispatcher_team" [disabled]="!specs()">{{ 'dispatcher.team' | transloco }}</option>
        </select>
      </label>
      @if (mode() === 'co-learning' && operatorType() !== 'human_dispatcher_team') { <p>{{ 'dispatcher.incompatible' | transloco }}</p> }
      @if (value(); as cfg) {
        @if (operatorType() === 'human_dispatcher_team') {
          <p data-testid="dispatcher-team-hint">{{ (mode() === 'co-learning' ? 'dispatcher.teamCoLearning' : 'dispatcher.teamApprovalHint') | transloco }}</p>
        }
        @if (demo()) {
          <p data-testid="dispatcher-demo-active">{{ 'dispatcher.demoActive' | transloco }}</p>
          <button data-testid="dispatcher-demo-clear" type="button" (click)="demoSelected.emit(null)">{{ 'dispatcher.demoClear' | transloco }}</button>
        } @else {
          <button data-testid="dispatcher-demo-load" type="button" (click)="loadDemo()">{{ 'dispatcher.demoLoad' | transloco }}</button>
        }
        <label>{{ 'dispatcher.mode' | transloco }}
          <select data-testid="dispatcher-mode" [value]="mode()" (change)="selectMode($any($event.target).value)">
            <option value="recommendation">{{ 'mode.recommendation' | transloco }}</option>
            @if (operatorType() === 'human_dispatcher_team') { <option value="co-learning">{{ 'mode.co-learning' | transloco }}</option> }
            <option value="director">{{ 'mode.director' | transloco }}</option>
          </select>
        </label>
        @if (mode() !== 'co-learning') {
        <label>{{ 'dispatcher.profile' | transloco }}
          <select data-testid="dispatcher-profile" [value]="cfg.profile" (change)="set('profile', $any($event.target).value)">
            @for (profile of profiles(); track profile) {
              <option [value]="profile" [disabled]="!specs()?.[profile]?.modes?.includes(mode())">{{ ('dispatcher.profiles.' + profile) | transloco }}</option>
            }
          </select>
        </label>
        <p>{{ ('dispatcher.description.' + cfg.profile) | transloco }}</p>
        @if (cfg.profile === 'delayed') {
          <label>{{ 'dispatcher.delay' | transloco }}
            <input data-testid="dispatcher-delay" type="number" min="1" max="100" [value]="cfg.delay" (input)="set('delay', +$any($event.target).value)" />
          </label>
        }
        @if (cfg.profile === 'priority' && mode() === 'recommendation') {
          <label>{{ 'dispatcher.trainOrder' | transloco }}
            <input data-testid="dispatcher-priority" type="text" [value]="cfg.priority.join(',')" (change)="setOrder($any($event.target).value)" />
          </label>
        }
        @if (cfg.profile === 'priority' && mode() === 'director') {
          <label>{{ 'dispatcher.objective' | transloco }}
            <select data-testid="dispatcher-objective" [value]="cfg.objective" (change)="set('objective', $any($event.target).value)">
              @for (axis of axes; track axis) { <option [value]="axis">{{ ('dispatcher.axes.' + axis) | transloco }}</option> }
            </select>
          </label>
        }
        @if (mode() === 'director' && cfg.profile !== 'priority') {
          @for (axis of axes; track axis) {
            <label>{{ ('dispatcher.axes.' + axis) | transloco }}
              <input type="number" min="0" max="5" [value]="cfg.initial[axis]" [attr.data-testid]="'dispatcher-initial-' + axis" (input)="weight('initial', axis, +$any($event.target).value)" />
            </label>
          }
        }
        @if (cfg.profile === 'goal-switch') {
          <label>{{ 'dispatcher.switchAt' | transloco }}
            <input data-testid="dispatcher-switch-at" type="number" min="2" [value]="cfg.switch_at" (input)="set('switch_at', +$any($event.target).value)" />
          </label>
          @for (axis of axes; track axis) {
            <label>{{ 'dispatcher.replacement' | transloco }} · {{ ('dispatcher.axes.' + axis) | transloco }}
              <input type="number" min="0" max="5" [value]="cfg.switched[axis]" [attr.data-testid]="'dispatcher-switched-' + axis" (input)="weight('switched', axis, +$any($event.target).value)" />
            </label>
          }
        }
        <p>{{ 'dispatcher.frozen' | transloco }}</p>
        <output data-testid="dispatcher-resolved">{{ (operatorType() === 'human_dispatcher_team' ? 'dispatcher.team' : 'dispatcher.synthetic') | transloco }} · {{ ('dispatcher.profiles.' + cfg.profile) | transloco }} · {{ mode() }}
          @if (cfg.profile === 'delayed') { · {{ 'dispatcher.delay' | transloco }}: {{ cfg.delay }} }
          @if (cfg.profile === 'priority') { · {{ cfg.objective }} · {{ cfg.priority.join(', ') }} }
          @if (mode() === 'director' && cfg.profile !== 'priority') { · {{ cfg.initial.punctuality }} / {{ cfg.initial.connections }} / {{ cfg.initial.stability }} }
          @if (cfg.profile === 'goal-switch') { → {{ cfg.switched.punctuality }} / {{ cfg.switched.connections }} / {{ cfg.switched.stability }} · {{ cfg.switch_at }} }
        </output>
        }
      }
    </fieldset>
  `,
  styles: [`fieldset { border: 1px solid var(--sbb-color-cloud); border-radius: .5rem; padding: 1rem; }
    label { display: flex; justify-content: space-between; gap: 1rem; margin-block: .5rem; }
    input { max-width: 9rem; } p { font-size: .85rem; } output { font-weight: 600; }`],
})
export class DispatcherConfigComponent {
  readonly mode = input.required<InteractionMode>();
  readonly modeChange = output<InteractionMode>();
  readonly value = model<DispatcherConfig | null>(null);
  readonly operatorType = model<DispatcherOperatorType>('human');
  readonly demo = input<DispatcherDemo | null>(null);
  readonly demoSelected = output<DispatcherDemo | null>();
  private readonly api = inject(ApiService);
  loadDemo() { this.api.dispatcherDemo().subscribe({ next: demo => this.demoSelected.emit(demo) }); }
  readonly specs = signal<Record<string, { modes: string[]; capability: string }> | null>(null);
  readonly profiles = computed(() => Object.keys(this.specs() ?? {}) as DispatcherProfile[]);
  constructor() {
    this.api.dispatcherProfiles().subscribe({ next: specs => this.specs.set(specs) });
    effect(() => {
      if (this.mode() === 'co-learning' && this.operatorType() === 'human_dispatcher_team' && this.value() && JSON.stringify(this.value()) !== JSON.stringify(DEFAULT_DISPATCHER)) {
        this.value.set(structuredClone(DEFAULT_DISPATCHER));
      }
    });
  }
  readonly axes: (keyof Directive)[] = ['punctuality', 'connections', 'stability'];
  selectOperator(value: string) {
    const operator = value === 'agent' ? 'synthetic_dispatcher' : value === 'human_dispatcher_team' ? value : 'human';
    if (operator === 'synthetic_dispatcher' && this.mode() === 'co-learning') return;
    this.operatorType.set(operator);
    this.value.set(operator === 'human' ? null : structuredClone(DEFAULT_DISPATCHER));
  }
  selectMode(mode: InteractionMode) {
    if (mode === 'co-learning') this.value.set(structuredClone(DEFAULT_DISPATCHER));
    this.modeChange.emit(mode);
  }
  set<K extends keyof DispatcherConfig>(key: K, value: DispatcherConfig[K]) {
    this.value.update(cfg => cfg ? { ...cfg, [key]: value } : cfg);
  }
  setOrder(value: string) { this.set('priority', value.trim() ? value.split(',').map(Number) : []); }
  weight(phase: 'initial' | 'switched', axis: keyof Directive, value: number) {
    this.value.update(cfg => cfg ? { ...cfg, [phase]: { ...cfg[phase], [axis]: value } } : cfg);
  }
}
