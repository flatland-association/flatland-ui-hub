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
type InspectorAgentGroup = 'MOVING' | 'WAITING' | 'DONE';
type ExpertMetric =
  | 'policyProbability'
  | 'advantage'
  | 'qValue'
  | 'vValue'
  | 'qMinusV'
  | 'logLikelihood'
  | 'entropy'
  | 'actionExperience'
  | 'countUncertainty';

const INSPECTOR_AGENT_GROUPS: readonly InspectorAgentGroup[] = ['MOVING', 'WAITING', 'DONE'];
const EXPERT_TOOLTIP_KEYS: Record<ExpertMetric, string> = {
  policyProbability: 'lab.inspector.expertTooltipPolicyProbability',
  advantage: 'lab.inspector.expertTooltipAdvantage',
  qValue: 'lab.inspector.expertTooltipQValue',
  vValue: 'lab.inspector.expertTooltipVValue',
  qMinusV: 'lab.inspector.expertTooltipQMinusV',
  logLikelihood: 'lab.inspector.expertTooltipLogLikelihood',
  entropy: 'lab.inspector.expertTooltipEntropy',
  actionExperience: 'lab.inspector.expertTooltipActionExperience',
  countUncertainty: 'lab.inspector.expertTooltipCountUncertainty',
};

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
  readonly collapsedMatrixGroups = signal<Record<InspectorAgentGroup, boolean>>({
    MOVING: false,
    WAITING: false,
    DONE: false,
  });
  readonly matrixAgentGroups = computed(() => {
    const agents = this.store.agents();
    return INSPECTOR_AGENT_GROUPS.map((key) => ({
      key,
      labelKey: `roster.group.${key.toLowerCase()}Label`,
      agents: agents.filter((agent) => this._groupOf(agent) === key),
    }));
  });
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
    this.api.getLabAiChoices(sid, evaluationPolicy).subscribe({
      next: (choices) => {
        if (key !== this.aiChoiceKey) return;
        this.aiChoices.set(choices);
      },
      error: () => {},
    });
  }

  matrixChoice(handle: number): LabAiChoice | null {
    return this.aiChoices()[handle] ?? null;
  }

  toggleMatrixGroup(group: InspectorAgentGroup): void {
    this.collapsedMatrixGroups.update((current) => ({ ...current, [group]: !current[group] }));
  }

  private _groupOf(agent: AgentDTO): InspectorAgentGroup {
    const state = String(agent.state ?? '').toUpperCase();
    if (state === 'DONE') return 'DONE';
    if (this.store.isMalfunctioning(agent)) return 'MOVING';
    if (state === 'WAITING' && (agent.eta_to_depart ?? 0) > 0) return 'WAITING';
    return 'MOVING';
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

  matrixActionPreferenceText(choice: LabAiChoice | null, action: number): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const probability = this.normalizedOptionProbabilities(choice)
      .find(([option]) => option === action)?.[1];
    return probability == null ? this.i18n.t('lab.inspector.notAvailable') : `${Math.round(probability * 100)}%`;
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

  private optionProbability(choice: LabAiChoice, action: number): number | null {
    return this.normalizedOptionProbabilities(choice).find(([option]) => option === action)?.[1] ?? null;
  }

  private preferredOption(choice: LabAiChoice): [number, number] | null {
    return [...this.normalizedOptionProbabilities(choice)]
      .sort((left, right) => right[1] - left[1])[0] ?? null;
  }

  isPreferredAction(choice: LabAiChoice | null, action: number): boolean {
    return choice != null && this.preferredOption(choice)?.[0] === action;
  }

  matrixDecisionConfidenceText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const options = this.normalizedOptionProbabilities(choice);
    if (options.length === 0) return this.i18n.t('lab.inspector.notAvailable');
    const mostPreferredProbability = Math.max(...options.map(([, probability]) => probability));
    return options.length === 1 || mostPreferredProbability > (1 / options.length) * 1.25
      ? this.i18n.t('lab.inspector.decisionClear')
      : this.i18n.t('lab.inspector.decisionSeveralSimilar');
  }

  private optionEntropy(choice: LabAiChoice): number | null {
    const probabilities = this.normalizedOptionProbabilities(choice).map(([, probability]) => probability);
    if (probabilities.length === 0) return null;
    return -probabilities.reduce((sum, probability) =>
      probability > 0 ? sum + probability * Math.log(probability) : sum, 0);
  }

  matrixSpreadText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const entropy = this.optionEntropy(choice);
    const optionCount = this.normalizedOptionProbabilities(choice).length;
    if (entropy == null || optionCount === 0) return this.i18n.t('lab.inspector.notAvailable');
    const maximum = Math.log(optionCount);
    const spread = maximum > 0 ? entropy / maximum : 0;
    const key = spread < 0.55
      ? 'lab.inspector.spreadClear'
      : spread >= 0.9
        ? 'lab.inspector.spreadHigh'
        : 'lab.inspector.spreadModerate';
    return this.i18n.t(key);
  }

  entropyTooltip(choice: LabAiChoice | null): string | null {
    if (!choice || choice.done) return null;
    const entropy = this.optionEntropy(choice);
    if (entropy == null) return null;
    return this.i18n.t('lab.inspector.matrixHelpEntropy');
  }

  private selectedActionSeenCount(choice: LabAiChoice | null): number | null {
    const action = choice ? this.preferredOption(choice)?.[0] ?? null : null;
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

  matrixExperienceText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const count = this.selectedActionSeenCount(choice);
    if (count == null) return this.i18n.t('lab.inspector.notAvailable');
    return this.i18n.t(count >= 10
      ? 'lab.inspector.experienceMany'
      : count >= 3
        ? 'lab.inspector.experienceSome'
        : 'lab.inspector.experienceFew');
  }

  matrixSortedActions(choice: LabAiChoice | null): number[] {
    return [...this.matrixActions].sort((left, right) => {
      const leftProbability = choice ? this.optionProbability(choice, left) : null;
      const rightProbability = choice ? this.optionProbability(choice, right) : null;
      if (leftProbability == null) return rightProbability == null ? 0 : 1;
      if (rightProbability == null) return -1;
      return rightProbability - leftProbability;
    });
  }

  matrixActionPreferencePercent(choice: LabAiChoice | null, action: number): number | null {
    if (!choice || choice.done) return null;
    const probability = this.optionProbability(choice, action);
    return probability == null ? null : Math.round(probability * 100);
  }

  matrixConfidencePercent(choice: LabAiChoice | null): number | null {
    const options = choice ? this.normalizedOptionProbabilities(choice) : [];
    const preferred = choice ? this.preferredOption(choice) : null;
    if (!preferred) return null;
    if (options.length === 1) return 100;
    const secondProbability = [...options].sort((left, right) => right[1] - left[1])[1]?.[1] ?? 0;
    return Math.round(Math.max(0, Math.min(100, (preferred[1] - secondProbability) * 100)));
  }

  matrixConfidenceBand(choice: LabAiChoice | null): string {
    const percent = this.matrixConfidencePercent(choice);
    if (percent == null) return 'unavailable';
    return percent >= 90 ? 'very-high' : percent >= 80 ? 'high' : percent >= 40 ? 'medium' : 'low';
  }

  matrixConfidenceText(choice: LabAiChoice | null): string {
    const band = this.matrixConfidenceBand(choice);
    return this.i18n.t(`lab.inspector.confidence${this._capitalizeBand(band)}`);
  }

  matrixForecastQualityPercent(choice: LabAiChoice | null): number | null {
    if (!choice || choice.done) return null;
    const preferred = this.preferredOption(choice);
    const experience = this.selectedActionSeenCount(choice);
    const uncertainty = this.selectedCountUncertainty(choice);
    const entropy = this.optionEntropy(choice);
    const advantage = preferred ? this.advantageValue(choice, preferred[0]) : null;
    const options = this.normalizedOptionProbabilities(choice);
    if (!preferred || experience == null || uncertainty == null || entropy == null || advantage == null) return null;
    const maximumEntropy = options.length > 1 ? Math.log(options.length) : 0;
    const entropyClarity = maximumEntropy > 0 ? 100 * (1 - entropy / maximumEntropy) : 100;
    const familiarity = 100 * experience / (experience + 10);
    const estimateReliability = 100 - uncertainty;
    const confidenceGap = this.matrixConfidencePercent(choice) ?? 0;
    const advantageStrength = Math.min(100, Math.abs(advantage) / 0.2 * 100);
    return Math.round((familiarity + estimateReliability + entropyClarity + confidenceGap + advantageStrength) / 5);
  }

  matrixForecastQualityBand(choice: LabAiChoice | null): string {
    const percent = this.matrixForecastQualityPercent(choice);
    if (percent == null) return 'unavailable';
    return percent >= 90
      ? 'very-high'
      : percent >= 80
        ? 'high'
        : percent >= 60
          ? 'medium'
          : percent >= 40
            ? 'low'
            : 'very-low';
  }

  matrixForecastQualityText(choice: LabAiChoice | null): string {
    const band = this.matrixForecastQualityBand(choice);
    return this.i18n.t(`lab.inspector.forecastQuality${this._capitalizeBand(band)}`);
  }

  matrixExperienceIndexPercent(choice: LabAiChoice | null): number | null {
    const count = this.selectedActionSeenCount(choice);
    return count == null ? null : Math.round(100 * count / (count + 10));
  }

  matrixExperienceBand(choice: LabAiChoice | null): string {
    const count = this.selectedActionSeenCount(choice);
    if (count == null) return 'unavailable';
    return count >= 10 ? 'high' : count >= 3 ? 'medium' : 'low';
  }

  matrixExperienceBandText(choice: LabAiChoice | null): string {
    const band = this.matrixExperienceBand(choice);
    return this.i18n.t(`lab.inspector.experienceBand${this._capitalizeBand(band)}`);
  }

  matrixExperienceDescription(choice: LabAiChoice | null): string {
    const band = this.matrixExperienceBand(choice);
    return this.i18n.t(`lab.inspector.experienceDescription${this._capitalizeBand(band)}`);
  }

  matrixExperienceObservationCountText(choice: LabAiChoice | null): string {
    const count = this.selectedActionSeenCount(choice);
    return count == null
      ? this.i18n.t('lab.inspector.notAvailable')
      : this.i18n.t('lab.inspector.experienceObservationCount', { count: Math.round(count) });
  }

  matrixHasClearFavorite(choice: LabAiChoice | null): boolean {
    const confidence = this.matrixConfidencePercent(choice);
    return confidence != null && confidence >= 40;
  }

  matrixRecommendationMarginPercent(choice: LabAiChoice | null): number | null {
    const options = choice
      ? [...this.normalizedOptionProbabilities(choice)].sort((left, right) => right[1] - left[1])
      : [];
    if (options.length === 0) return null;
    return Math.round((options[0][1] - (options[1]?.[1] ?? 0)) * 100);
  }

  matrixRecommendationMarginText(choice: LabAiChoice | null): string {
    const margin = this.matrixRecommendationMarginPercent(choice);
    return margin == null
      ? this.i18n.t('lab.inspector.notAvailable')
      : this.i18n.t('lab.inspector.recommendationMarginPoints', { margin });
  }

  matrixRecommendationMarginDescription(choice: LabAiChoice | null): string {
    const margin = this.matrixRecommendationMarginPercent(choice);
    return this.i18n.t(margin == null
      ? 'lab.inspector.marginUnavailable'
      : margin <= 5
        ? 'lab.inspector.marginSmall'
        : margin <= 15
          ? 'lab.inspector.marginModerate'
          : 'lab.inspector.marginClear', {
      margin: margin ?? 0,
    });
  }

  matrixCountUncertaintyPercent(choice: LabAiChoice | null): number | null {
    return this.selectedCountUncertainty(choice);
  }

  matrixCountUncertaintyBand(choice: LabAiChoice | null): string {
    const uncertainty = this.matrixCountUncertaintyPercent(choice);
    return uncertainty == null ? 'unavailable' : uncertainty >= 50 ? 'low' : 'high';
  }

  matrixRecommendationText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const preferred = this.preferredOption(choice);
    return preferred ? this.aiActionLabel(preferred[0]) : this.i18n.t('lab.inspector.notAvailable');
  }

  matrixPreferredAction(choice: LabAiChoice | null): number | null {
    return choice ? this.preferredOption(choice)?.[0] ?? null : null;
  }

  matrixRecommendationRationale(choice: LabAiChoice | null): string {
    return this.i18n.t(this.matrixHasClearFavorite(choice)
      ? 'lab.inspector.rationaleClearFavorite'
      : 'lab.inspector.rationaleSimilarOptions');
  }

  matrixOverviewRationale(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const experience = this.selectedActionSeenCount(choice);
    const clearFavorite = this.matrixHasClearFavorite(choice);
    const preferred = this.preferredOption(choice);
    const advantage = preferred ? this.advantageValue(choice, preferred[0]) : null;
    const key = advantage != null && advantage < -0.05
      ? 'lab.inspector.rationaleNegativeEffect'
      : !clearFavorite && experience != null && experience < 3
      ? 'lab.inspector.rationaleSimilarAndLittleExperience'
      : clearFavorite && experience != null && experience < 3
        ? 'lab.inspector.rationaleClearAndLittleExperience'
        : clearFavorite
          ? 'lab.inspector.rationaleClearFavorite'
          : 'lab.inspector.rationaleSimilarOptions';
    return this.i18n.t(key);
  }

  matrixEffectBand(choice: LabAiChoice | null, action?: number): string {
    const preferred = choice ? this.preferredOption(choice) : null;
    const assessedAction = action ?? preferred?.[0];
    if (!choice || assessedAction == null) return 'unavailable';
    const value = this.advantageValue(choice, assessedAction);
    if (value == null) return 'unavailable';
    if (value >= 0.2) return 'very-positive';
    if (value >= 0.05) return 'positive';
    if (value >= -0.05) return 'neutral';
    if (value >= -0.2) return 'critical';
    return 'negative';
  }

  matrixEffectText(choice: LabAiChoice | null, action?: number): string {
    const band = this.matrixEffectBand(choice, action);
    return this.i18n.t(`lab.inspector.effect${this._capitalizeBand(band)}`);
  }

  matrixEffectDescription(choice: LabAiChoice | null, action?: number): string {
    const band = this.matrixEffectBand(choice, action);
    const descriptionBand = band === 'very-positive' || band === 'positive'
      ? 'positive'
      : band === 'critical' || band === 'negative'
        ? 'negative'
        : band;
    return this.i18n.t(`lab.inspector.effectDescription${this._capitalizeBand(descriptionBand)}`);
  }

  matrixRecommendedAdvantageText(choice: LabAiChoice | null): string {
    const preferred = choice ? this.preferredOption(choice) : null;
    return preferred ? this.matrixAdvantageText(choice, preferred[0]) : this.i18n.t('lab.inspector.notAvailable');
  }

  matrixAssessmentTone(choice: LabAiChoice | null): string {
    const quality = this.matrixForecastQualityPercent(choice);
    const confidence = this.matrixConfidencePercent(choice);
    const experience = this.selectedActionSeenCount(choice);
    const uncertainty = this.selectedCountUncertainty(choice);
    const preferred = choice ? this.preferredOption(choice) : null;
    const advantage = preferred && choice ? this.advantageValue(choice, preferred[0]) : null;
    const robust = quality != null && quality >= 80
      && confidence != null && confidence >= 80
      && experience != null && experience >= 10
      && uncertainty != null && uncertainty < 20
      && advantage != null && advantage > -0.05;
    return robust ? 'high' : 'caution';
  }

  matrixAssessmentText(choice: LabAiChoice | null): string {
    return this.i18n.t(this.matrixAssessmentTone(choice) === 'high'
      ? 'lab.inspector.assessmentWellSupported'
      : 'lab.inspector.assessmentCaution');
  }

  matrixAssessmentReasons(choice: LabAiChoice | null): string[] {
    if (!choice || choice.done) return [];
    const reasons: string[] = [];
    const preferred = this.preferredOption(choice);
    const experience = this.selectedActionSeenCount(choice);
    const uncertainty = this.selectedCountUncertainty(choice);
    const advantage = preferred ? this.advantageValue(choice, preferred[0]) : null;
    if (!this.matrixHasClearFavorite(choice)) reasons.push('lab.inspector.reasonNoClearFavorite');
    if (experience == null || experience < 3) reasons.push('lab.inspector.reasonLittleExperience');
    if (advantage != null && advantage < -0.05) reasons.push('lab.inspector.reasonNegativeEffect');
    if (uncertainty == null || uncertainty >= 50) reasons.push('lab.inspector.reasonUncertainEstimate');
    if (reasons.length === 0) reasons.push('lab.inspector.reasonNoMajorConcerns');
    return reasons;
  }

  matrixExpertMetricText(choice: LabAiChoice | null, action: number, metric: ExpertMetric): string {
    if (!choice || choice.done) return choice?.done
      ? this.i18n.t('lab.inspector.done')
      : this.i18n.t('lab.inspector.loading');
    switch (metric) {
      case 'policyProbability':
        return this.matrixActionPreferencePercent(choice, action) == null
          ? this.i18n.t('lab.inspector.notAvailable')
          : `${this.matrixActionPreferencePercent(choice, action)}%`;
      case 'advantage':
      case 'qMinusV':
        return this.matrixAdvantageText(choice, action);
      case 'qValue':
        return this.actionValueText(choice, action);
      case 'vValue':
        return typeof choice.stateValue === 'number'
          ? choice.stateValue.toFixed(2)
          : this.i18n.t('lab.inspector.notAvailable');
      case 'logLikelihood': {
        const probability = this.optionProbability(choice, action);
        return probability == null || probability <= 0
          ? this.i18n.t('lab.inspector.notAvailable')
          : Math.log(probability).toFixed(2);
      }
      case 'entropy': {
        const entropy = this.optionEntropy(choice);
        return entropy == null ? this.i18n.t('lab.inspector.notAvailable') : `${entropy.toFixed(2)} ${this.i18n.t('lab.inspector.nats')}`;
      }
      case 'actionExperience': {
        const count = choice.actionSeenCounts?.[String(action)];
        return typeof count === 'number'
          ? `${Math.round(100 * count / (count + 10))}%`
          : this.i18n.t('lab.inspector.notAvailable');
      }
      case 'countUncertainty': {
        const uncertainty = choice.actionSeenCountUncertainty?.[String(action)];
        return typeof uncertainty === 'number'
          ? `${uncertainty.toFixed(0)}%`
          : this.i18n.t('lab.inspector.notAvailable');
      }
    }
  }

  matrixExpertMetricTooltip(choice: LabAiChoice, action: number, metric: ExpertMetric): string {
    const value = this.matrixExpertMetricText(choice, action, metric);
    const sourceCounts = choice.actionSeenCountsBySource;
    const rawCount = choice.actionSeenCounts?.[String(action)];
    const experienceDetail = typeof rawCount !== 'number'
      ? this.i18n.t('lab.inspector.notAvailable')
      : this.i18n.t(choice.actionSeenCountsExact
        ? 'lab.inspector.seenActionTooltipExact'
        : 'lab.inspector.seenActionTooltipEstimate', {
        action: this.aiActionLabel(action),
        count: rawCount.toFixed(1),
        percent: value,
        executed: sourceCounts?.['executed']?.[String(action)] ?? 0,
        simulated: sourceCounts?.['simulated']?.[String(action)] ?? 0,
      });
    return this.i18n.t(EXPERT_TOOLTIP_KEYS[metric], {
      action: this.aiActionLabel(action),
      value,
      rawCount: typeof rawCount === 'number' ? rawCount.toFixed(1) : this.i18n.t('lab.inspector.notAvailable'),
      experienceDetail,
    });
  }

  matrixExpertDefinition(key: string): string {
    return this.i18n.t(`lab.inspector.expertDefinition${this._capitalizeBand(key)}`);
  }

  experienceTooltip(choice: LabAiChoice | null): string | null {
    const action = choice ? this.preferredOption(choice)?.[0] ?? null : null;
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
    const action = choice ? this.preferredOption(choice)?.[0] ?? null : null;
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

  experienceReliabilityText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const uncertainty = this.selectedCountUncertainty(choice);
    if (uncertainty == null) return this.i18n.t('lab.inspector.notAvailable');
    return this.i18n.t(uncertainty >= 50
      ? 'lab.inspector.reliabilityLow'
      : uncertainty >= 20
        ? 'lab.inspector.reliabilityModerate'
        : 'lab.inspector.reliabilityHigh');
  }

  matrixSummaryText(choice: LabAiChoice | null): string {
    if (!choice) return this.i18n.t('lab.inspector.loading');
    if (choice.done) return this.i18n.t('lab.inspector.done');
    const preferred = this.preferredOption(choice);
    if (!preferred) return this.i18n.t('lab.inspector.notAvailable');
    const [action, probability] = preferred;
    const advantage = this.advantageValue(choice, action);
    const uncertainty = this.selectedCountUncertainty(choice);
    const experience = this.selectedActionSeenCount(choice);
    const options = this.normalizedOptionProbabilities(choice);
    const entropy = this.optionEntropy(choice);
    const maximumEntropy = options.length > 1 ? Math.log(options.length) : 0;
    const normalizedEntropy = entropy != null && maximumEntropy > 0
      ? entropy / maximumEntropy
      : 0;
    const secondProbability = [...options]
      .sort((left, right) => right[1] - left[1])[1]?.[1] ?? 0;
    let key = 'lab.inspector.summaryGeneral';
    if (advantage != null && advantage < 0 && uncertainty != null && uncertainty >= 50) {
      key = 'lab.inspector.summaryCritical';
    } else if (
      probability >= 0.7
      && advantage != null && advantage > 0
      && uncertainty != null && uncertainty < 20
      && experience != null && experience >= 10
    ) {
      key = 'lab.inspector.summaryStrong';
    } else if (
      normalizedEntropy >= 0.9
      && experience != null && experience < 3
      && probability - secondProbability <= 0.2
    ) {
      key = 'lab.inspector.summaryUncertain';
    }
    return this.i18n.t(key, {
      action: this.aiActionLabel(action),
      probability: Math.round(probability * 100),
    });
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
    const action = choice ? this.preferredOption(choice)?.[0] ?? null : null;
    const uncertainty = this.selectedCountUncertainty(choice);
    if (!choice || action == null || uncertainty == null) return null;
    const count = this.selectedActionSeenCount(choice);
    const exact = choice.actionSeenCountsExact === true;
    const sourceCounts = choice.actionSeenCountsBySource;
    const spread = choice.actionSeenCountSpread?.[String(action)];
    const statusKey = uncertainty >= 50
      ? 'lab.inspector.reliabilityLow'
      : uncertainty >= 20
        ? 'lab.inspector.reliabilityModerate'
        : 'lab.inspector.reliabilityHigh';
    return this.i18n.t('lab.inspector.countUncertaintyTooltip', {
      action: this.aiActionLabel(action),
      status: this.i18n.t(statusKey),
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

  private _capitalizeBand(value: string): string {
    return value.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  }
}
