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
  readonly actionRows = [0, 1, 2, 3, 4];
  readonly matrixActions = [2, 4, 1, 3];
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

  /** Online PPO v2's choice for every train at its next decision point. */
  readonly aiChoices = signal<Record<number, LabAiChoice>>({});
  readonly aiChoice = computed<LabAiChoice | null>(() => {
    const handle = this.activeAgent()?.handle;
    return handle == null ? null : this.aiChoices()[handle] ?? null;
  });
  private aiChoiceKey: string | null = null;

  constructor() {
    // Refresh the complete matrix when the simulation reaches a new decision
    // point or an override changes.
    effect(() => {
      const sid = this.store.session()?.id ?? null;
      const agents = this.store.agents();
      const evaluationPolicy = this.store.onlinePpoEvaluationAvailable()
        ? 'lab:online-ppo'
        : this.store.activePolicyIsLearned() ? this.store.activePolicy() : undefined;
      const wanted = this.store.activePolicyIsLearned() || !!evaluationPolicy;
      const handles = agents.map((a) => `${a.handle}:${a.override_action ?? ''}`).join(',');
      const key = sid && agents.length > 0 && wanted
        ? `${sid}|${this.store.elapsedSteps()}|${evaluationPolicy ?? this.store.activePolicy()}|${handles}`
        : null;
      untracked(() => this.requestAiChoices(key, evaluationPolicy, agents.map((a) => a.handle)));
    });
    inject(DestroyRef).onDestroy(() => (this.aiChoiceKey = null));
  }

  private requestAiChoices(key: string | null, evaluationPolicy: string | undefined, handles: number[]): void {
    this.aiChoiceKey = key;
    if (!key) {
      this.aiChoices.set({});
      return;
    }
    const sid = key.split('|', 1)[0];
    this.aiChoices.set({});
    for (const handle of handles) {
      this.api.getLabAiChoice(sid, handle, evaluationPolicy).subscribe({
        next: (choice) => {
          if (key !== this.aiChoiceKey) return;
          this.aiChoices.update((choices) => ({ ...choices, [handle]: choice }));
        },
        error: () => {},
      });
    }
  }

  matrixChoice(handle: number): LabAiChoice | null {
    return this.aiChoices()[handle] ?? null;
  }

  matrixActionText(choice: LabAiChoice | null, action: number | null | undefined): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    return action != null ? this.aiActionLabel(action) : this.i18n.t('lab.inspector.loading');
  }

  matrixValueText(choice: LabAiChoice | null, action: number | null | undefined): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    return action != null ? this.actionValueText(choice, action) : this.i18n.t('lab.inspector.loading');
  }

  matrixSelectedAction(choice: LabAiChoice | null): number | null {
    if (!choice) return null;
    return choice.overrideAction ?? choice.simulationAction ?? choice.policyAction ?? choice.action ?? null;
  }

  isMatrixActionAvailable(choice: LabAiChoice | null, action: number): boolean {
    return !!choice && !choice.done && choice.available && this.actionValue(choice, action) != null;
  }

  isMatrixOverride(choice: LabAiChoice | null, action: number): boolean {
    return choice?.overrideAction === action;
  }

  hasMatrixOverride(handle: number, choice: LabAiChoice | null): boolean {
    const agent = this.store.agents().find((candidate) => candidate.handle === handle);
    return agent?.override_action != null || choice?.overridden === true;
  }

  onMatrixActionClick(handle: number, action: number): void {
    const choice = this.matrixChoice(handle);
    if (this.isMatrixActionAvailable(choice, action)) {
      this.onActionClick(handle, action, this.isOverrideOption(handle, action));
    }
  }

  resetMatrixOverride(handle: number): void {
    this.trainActions.clear(handle, 'inspector');
  }

  matrixStepsText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    if (choice?.forecastSteps != null) return String(choice.forecastSteps);
    if (choice?.reason === 'not-reached') return this.i18n.t('lab.inspector.forecastNotReached');
    if (choice?.reason === 'no-decision') return this.i18n.t('lab.inspector.noDecisionAhead');
    return this.i18n.t('lab.inspector.forecasting');
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

  actionValue(choice: LabAiChoice, action: number): number | null {
    const value = choice.actionValues?.[String(action)];
    return typeof value === 'number' ? value : null;
  }

  actionValueText(choice: LabAiChoice, action: number): string {
    const value = this.actionValue(choice, action);
    return value == null ? this.i18n.t('lab.inspector.notAllowed') : value.toFixed(2);
  }

  advantageValue(choice: LabAiChoice | null, action: number): number | null {
    const value = choice?.advantages?.[String(action)];
    return typeof value === 'number' ? value : null;
  }

  private normalizedOptionProbabilities(choice: LabAiChoice): Array<[number, number]> {
    const entries = Object.entries(choice.optionProbabilities ?? {})
      .map(([action, probability]) => [Number(action), probability] as [number, number])
      .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]) && entry[1] >= 0);
    const total = entries.reduce((sum, [, probability]) => sum + probability, 0);
    return total > 0 ? entries.map(([action, probability]) => [action, probability / total]) : [];
  }

  private selectedOptionProbability(choice: LabAiChoice | null): number | null {
    const selected = choice ? this.matrixSelectedAction(choice) : null;
    if (selected == null || !choice) return null;
    return this.normalizedOptionProbabilities(choice).find(([action]) => action === selected)?.[1] ?? null;
  }

  matrixLogLikelihoodText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const probability = this.selectedOptionProbability(choice);
    return probability == null || probability <= 0
      ? this.i18n.t('lab.inspector.notAvailable')
      : Math.log(probability).toFixed(2);
  }

  matrixLikelihoodInterpretation(choice: LabAiChoice | null): string {
    if (!choice) return 'lab.inspector.loading';
    if (choice.done) return 'lab.inspector.done';
    const probability = this.selectedOptionProbability(choice);
    const optionCount = this.normalizedOptionProbabilities(choice).length;
    if (probability == null || optionCount === 0) return 'lab.inspector.notAvailable';
    const uniformProbability = 1 / optionCount;
    if (probability > uniformProbability * 1.25) return 'lab.inspector.likelihoodAboveUniform';
    if (probability < uniformProbability * 0.75) return 'lab.inspector.likelihoodBelowUniform';
    return 'lab.inspector.likelihoodNearUniform';
  }

  logLikelihoodTooltip(choice: LabAiChoice | null): string | null {
    const probability = this.selectedOptionProbability(choice);
    const action = choice ? this.matrixSelectedAction(choice) : null;
    if (probability == null || action == null) return null;
    return this.i18n.t('lab.inspector.logLikelihoodTooltip', {
      action: this.aiActionLabel(action),
      probability: (probability * 100).toFixed(2),
      value: Math.log(probability).toFixed(2),
    });
  }

  private optionEntropy(choice: LabAiChoice): number | null {
    const probabilities = this.normalizedOptionProbabilities(choice).map(([, probability]) => probability);
    if (probabilities.length === 0) return null;
    return -probabilities.reduce((sum, probability) =>
      probability > 0 ? sum + probability * Math.log(probability) : sum, 0);
  }

  matrixEntropyText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const entropy = this.optionEntropy(choice);
    return entropy == null ? this.i18n.t('lab.inspector.notAvailable') : entropy.toFixed(2);
  }

  entropyTooltip(choice: LabAiChoice | null): string | null {
    if (!choice || choice.done) return null;
    const entropy = this.optionEntropy(choice);
    const optionCount = this.normalizedOptionProbabilities(choice).length;
    if (entropy == null) return null;
    const maxEntropy = Math.log(optionCount);
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;
    const interpretation = optionCount === 1 || normalizedEntropy < 0.33
      ? 'lab.inspector.entropyConcentrated'
      : normalizedEntropy > 0.67
        ? 'lab.inspector.entropySpread'
        : 'lab.inspector.entropyModerate';
    return this.i18n.t('lab.inspector.entropyTooltip', {
      value: entropy.toFixed(2),
      interpretation: this.i18n.t(interpretation),
    });
  }

  private selectedActionSeenCount(choice: LabAiChoice | null): number | null {
    const action = choice ? this.matrixSelectedAction(choice) : null;
    if (action == null) return null;
    const value = choice?.actionSeenCounts?.[String(action)];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
  }

  matrixExperiencePercentText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const count = this.selectedActionSeenCount(choice);
    return count == null
      ? this.i18n.t('lab.inspector.notAvailable')
      : `${(100 * count / (count + 10)).toFixed(0)}%`;
  }

  experienceTooltip(choice: LabAiChoice | null): string | null {
    const action = choice ? this.matrixSelectedAction(choice) : null;
    const count = this.selectedActionSeenCount(choice);
    if (!choice || action == null || count == null) return null;
    const sourceCounts = choice.actionSeenCountsBySource;
    const exact = choice.actionSeenCountsExact === true;
    return this.i18n.t(exact
      ? 'lab.inspector.seenActionTooltipExact'
      : 'lab.inspector.seenActionTooltipEstimate', {
      action: this.aiActionLabel(action),
      count: count.toFixed(1),
      percent: this.matrixExperiencePercentText(choice),
      executed: sourceCounts?.['executed']?.[String(action)] ?? 0,
      simulated: sourceCounts?.['simulated']?.[String(action)] ?? 0,
    });
  }

  private selectedCountUncertainty(choice: LabAiChoice | null): number | null {
    const action = choice ? this.matrixSelectedAction(choice) : null;
    if (action == null) return null;
    const value = choice?.actionSeenCountUncertainty?.[String(action)];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;
  }

  matrixCountUncertaintyText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const uncertainty = this.selectedCountUncertainty(choice);
    if (uncertainty == null) return this.i18n.t('lab.inspector.notAvailable');
    const statusKey = uncertainty >= 50
      ? 'lab.inspector.uncertaintyFewObservations'
      : uncertainty >= 20
        ? 'lab.inspector.uncertaintyModerate'
        : 'lab.inspector.uncertaintyLower';
    return `${uncertainty.toFixed(0)}% · ${this.i18n.t(statusKey)}`;
  }

  isHighCountUncertainty(choice: LabAiChoice | null): boolean {
    const uncertainty = this.selectedCountUncertainty(choice);
    return uncertainty != null && uncertainty >= 50;
  }

  isMediumCountUncertainty(choice: LabAiChoice | null): boolean {
    const uncertainty = this.selectedCountUncertainty(choice);
    return uncertainty != null && uncertainty >= 20 && uncertainty < 50;
  }

  isLowCountUncertainty(choice: LabAiChoice | null): boolean {
    const uncertainty = this.selectedCountUncertainty(choice);
    return uncertainty != null && uncertainty < 20;
  }

  countUncertaintyTooltip(choice: LabAiChoice | null): string | null {
    const action = choice ? this.matrixSelectedAction(choice) : null;
    const uncertainty = this.selectedCountUncertainty(choice);
    if (!choice || action == null || uncertainty == null) return null;
    const count = this.selectedActionSeenCount(choice);
    const exact = choice.actionSeenCountsExact === true;
    const sourceCounts = choice.actionSeenCountsBySource;
    const spread = choice.actionSeenCountSpread?.[String(action)];
    return this.i18n.t('lab.inspector.countUncertaintyTooltip', {
      action: this.aiActionLabel(action),
      percent: uncertainty.toFixed(0),
      count: count == null ? this.i18n.t('lab.inspector.notAvailable') : count.toFixed(1),
      method: this.i18n.t(exact
        ? 'lab.inspector.countExactMethod'
        : count == null
          ? 'lab.inspector.countUnavailableMethod'
          : 'lab.inspector.countEstimatedMethod'),
      spread: spread == null ? this.i18n.t('lab.inspector.notAvailable') : spread.toFixed(2),
      executed: sourceCounts?.['executed']?.[String(action)] ?? 0,
      simulated: sourceCounts?.['simulated']?.[String(action)] ?? 0,
    });
  }

  matrixAdvantageText(choice: LabAiChoice | null, action: number): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const value = this.advantageValue(choice, action);
    if (value == null) return this.i18n.t('lab.inspector.notAllowed');
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  }

  advantageTitle(choice: LabAiChoice | null, action: number): string | null {
    const value = this.advantageValue(choice, action);
    if (value == null) return null;
    const contextKey = value > 0
      ? 'lab.inspector.advantageBetter'
      : value < 0
        ? 'lab.inspector.advantageWorse'
        : 'lab.inspector.advantageEqual';
    return this.i18n.t('lab.inspector.advantageTooltip', {
      action: this.aiActionLabel(action),
      value: this.matrixAdvantageText(choice, action),
      context: this.i18n.t(contextKey),
    });
  }

  isPositiveAdvantage(choice: LabAiChoice | null, action: number): boolean {
    const value = this.advantageValue(choice, action);
    return value != null && value > 0;
  }

  isNegativeAdvantage(choice: LabAiChoice | null, action: number): boolean {
    const value = this.advantageValue(choice, action);
    return value != null && value < 0;
  }

  isBestAction(choice: LabAiChoice, action: number): boolean {
    return choice.bestAction === action;
  }

  isPlayedAction(choice: LabAiChoice, action: number): boolean {
    return (choice.rawPolicyAction ?? choice.policyAction ?? choice.action) === action;
  }

  isOverrideAction(choice: LabAiChoice, action: number): boolean {
    return choice.overrideAction === action;
  }

  overrideDeltaText(choice: LabAiChoice): string | null {
    if (choice.overrideValue == null || choice.bestValue == null) return null;
    return (choice.overrideValue - choice.bestValue).toFixed(2);
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
