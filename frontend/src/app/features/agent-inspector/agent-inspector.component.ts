import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { SessionStore } from '../../core/session.store';
import { TrainIdentityService } from '../../core/train-identity.service';
import { AgentDTO, LabAiChoice } from '../../core/models';
import { ApiService } from '../../core/api.service';
import { AgentColorService } from '../../core/agent-color.service';
import { TrainActionService } from '../../core/dispatch/train-action.service';

/**
 * How the learned policy's own choice shows up next to a train's options
 * (MARL lab, docs/plans/marl-lab-plan.md step 4). Only in a session that runs a
 * learned policy; elsewhere nothing changes.
 *  - `highlight` (Recommendation): the AI's option is marked, with its probability.
 *  - `none` (Co-Learning): options stay neutral, the AI's view is not shown.
 *  - `info` (Director): a plain line saying what the AI will do, no marking.
 */
type AiChoiceDisplay = 'highlight' | 'none' | 'info';

@Component({
  selector: 'app-agent-inspector',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './agent-inspector.component.html',
  styleUrl: './agent-inspector.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class AgentInspectorComponent {
  readonly i18n = inject(LanguageService);
  store = inject(SessionStore);
  private readonly identity = inject(TrainIdentityService);

  trainName(handle: number): string {
    return this.identity.nameFor(handle);
  }
  private agentColors = inject(AgentColorService);
  /** Acting goes through the dispatch seam, never straight to the store. */
  private trainActions = inject(TrainActionService);
  private readonly api = inject(ApiService);

  /** The single place this component branches on mode (see AiChoiceDisplay). */
  readonly modeBehavior = computed<{ aiChoice: AiChoiceDisplay }>(() => {
    switch (this.store.interactionMode()) {
      case 'recommendation':
        return { aiChoice: 'highlight' };
      case 'co-learning':
        return { aiChoice: 'none' };
      case 'director':
        return { aiChoice: 'info' };
    }
  });

  /** The learned policy's choice at the selected train's next switch, or null. */
  readonly aiChoice = signal<LabAiChoice | null>(null);
  private aiChoiceKey: string | null = null;
  private aiChoiceInFlight = false;

  constructor() {
    // Ask again when the train, the step or the policy changes. One request at
    // a time: while playing, the latest key is asked once the last one returns.
    effect(() => {
      const sid = this.store.session()?.id ?? null;
      const handle = this.activeAgent()?.handle ?? null;
      const wanted = this.store.activePolicyIsLearned() && this.modeBehavior().aiChoice !== 'none';
      const key = sid && handle != null && wanted
        ? `${sid}|${handle}|${this.store.elapsedSteps()}|${this.store.activePolicy()}|${this.store.agents().find((a) => a.handle === handle)?.override_action ?? ''}`
        : null;
      untracked(() => this.requestAiChoice(key));
    });
    inject(DestroyRef).onDestroy(() => (this.aiChoiceKey = null));
  }

  private requestAiChoice(key: string | null): void {
    this.aiChoiceKey = key;
    if (!key) {
      this.aiChoice.set(null);
      return;
    }
    if (this.aiChoiceInFlight) return;
    const [sid, handle] = key.split('|');
    this.aiChoiceInFlight = true;
    this.api.getLabAiChoice(sid, Number(handle)).subscribe({
      next: (choice) => this.finishAiChoice(key, choice),
      error: () => this.finishAiChoice(key, null),
    });
  }

  private finishAiChoice(key: string, choice: LabAiChoice | null): void {
    this.aiChoiceInFlight = false;
    if (key === this.aiChoiceKey) {
      this.aiChoice.set(choice?.available ? choice : null);
    } else {
      this.requestAiChoice(this.aiChoiceKey);
    }
  }

  /** The AI's action for `a`, if it is the train being shown. */
  aiAction(a: AgentDTO): number | null {
    const c = this.aiChoice();
    return c && c.handle === a.handle && c.action != null ? c.action : null;
  }

  aiPercent(): number {
    return Math.round((this.aiChoice()?.probability ?? 0) * 100);
  }

  /** Label of an action the AI picked that may not be one of the options. */
  aiActionLabel(action: number): string {
    return this.i18n.t(`lab.action.${action}`);
  }

  isAiOption(a: AgentDTO, action: number): boolean {
    return this.modeBehavior().aiChoice === 'highlight' && this.aiAction(a) === action;
  }

  /** The text line under the options: in Director what the AI will do; in
   *  Recommendation only when its pick is not one of the buttons to mark. */
  aiLine(a: AgentDTO): { key: string; action: number } | null {
    const action = this.aiAction(a);
    if (action == null) return null;
    switch (this.modeBehavior().aiChoice) {
      case 'info':
        return { key: 'lab.inspector.willTake', action };
      case 'highlight':
        return this.aiPickOutsideOptions(a) ? { key: 'lab.inspector.recommends', action } : null;
      case 'none':
        return null;
    }
  }

  /** The AI picked something the options do not offer (e.g. hold at the switch). */
  aiPickOutsideOptions(a: AgentDTO): boolean {
    const action = this.aiAction(a);
    return action != null && !(a.next_decision?.options ?? []).some((o) => o.action === action);
  }

  readonly activeAgent = computed<AgentDTO | null>(() => {
    const agents = this.store.agents();

    // 1) Explicit click/selection wins.
    const selected = this.store.selectedHandle();
    if (selected != null) {
      return agents.find((a) => a.handle === selected) ?? null;
    }

    // 2) Hover/cross-highlight fallback.
    const hovered = Array.from(this.store.notificationHoverHandles?.() ?? []);
    if (hovered.length > 0) {
      return agents.find((a) => a.handle === hovered[0]) ?? null;
    }

    return null;
  });

  agentColor(handle: number): string {
    return this.agentColors.getColor(handle, 'default');
  }

  isMalfunctioning(a: AgentDTO | null): boolean {
    if (!a) return false;
    return !!a.is_malfunctioning
      || (a.malfunction_remaining ?? 0) > 0
      || String(a.state ?? '').includes('MALFUNCTION');
  }

  clearSelection() {
    this.store.clearSelection();
  }

  /** Absolute step at which a malfunctioning train is expected to resume. */
  resumeStep(a: AgentDTO): number {
    return this.store.elapsedSteps() + Math.max(0, a.malfunction_remaining ?? 0);
  }

  /** Apply or clear a per-agent override from the overlay action buttons. */
  onActionClick(handle: number, action: number, _isOverride: boolean): void {
    this.trainActions.toggle(handle, action, 'inspector');
  }

  isOverrideOption(handle: number, action: number): boolean {
    return this.trainActions.isActive(handle, action);
  }
}
