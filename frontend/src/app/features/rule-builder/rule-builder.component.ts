import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { LanguageService } from '../../core/i18n/language.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import { LONG_BLOCK_STEPS, LearningRecord, LearningStore } from '../../core/learning-store.service';
import { TourContextService } from '../../core/demo/tour-context.service';
import { SandboxCheckpoint, SandboxItem, SandboxOption } from '../../core/demo/sandbox-replay';
import { RuleCheck, RuleMeasure, TourRule, checkRule, costOf, ruleApplies, ruleSentence } from '../../core/demo/tour-rule';

/** One checkpoint the rule is checked against, with every option's cost there. */
interface RuleCase {
  key: string;
  /** Shift number (1-based) or null for a never-experienced test case. */
  shift: number | null;
  step: number;
  item: SandboxItem;
  costs: Partial<Record<SandboxOption, number>>;
}

const MEASURES: RuleMeasure[] = ['proceed', 'hold_until', 'reroute'];

/**
 * Rule from insight (advanced Co-Learning tour, WP3): after a shift the person
 * turns what they learned into a rule — a condition over the impact analysis'
 * facts and a measure — and checks it against the sandbox: every decision
 * moment of this tour run and the briefing's never-experienced test cases.
 * Every option is played once per case; the verdicts then follow the rule as
 * it is edited. Taken over, the rule becomes a learning record, and shift 2
 * shows it where its condition holds (`rule-match.ts`).
 *
 * Plan: docs/plans/colearning-advanced-tour.md (WP3).
 */
@Component({
  selector: 'app-rule-builder',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './rule-builder.component.html',
  styleUrl: './rule-builder.component.scss',
})
export class RuleBuilderComponent {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly learning = inject(LearningStore);
  private readonly tour = inject(TourContextService);
  private readonly i18n = inject(LanguageService);
  private readonly identity = inject(TrainIdentityService);

  readonly measures = MEASURES;

  readonly useBlock = signal(true);
  readonly minBlockSteps = signal(LONG_BLOCK_STEPS);
  readonly reroute = signal<'yes' | 'no' | 'any'>('yes');
  readonly measure = signal<RuleMeasure>('reroute');

  readonly rule = computed<TourRule>(() => ({
    minBlockSteps: this.useBlock() ? this.minBlockSteps() : null,
    reroute: this.reroute(),
    measure: this.measure(),
  }));
  readonly sentence = computed(() => ruleSentence(this.rule(), (k, p) => this.i18n.t(k, p)));

  readonly cases = signal<RuleCase[]>([]);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly saveState = signal<'idle' | 'saved'>('idle');

  /** Each case with whether the rule applies and how its measure did. */
  readonly results = computed(() =>
    this.cases().map((c) => {
      const applies = ruleApplies(this.rule(), c.item);
      const check: RuleCheck | null = applies ? checkRule(this.rule().measure, c.costs) : null;
      return { c, applies, check };
    }),
  );

  readonly summary = computed(() => {
    const applied = this.results().filter((r) => r.applies);
    const count = (v: string) => applied.filter((r) => r.check?.verdict === v).length;
    return {
      total: this.results().length,
      applied: applied.length,
      best: count('best'),
      tie: count('tie') + count('equal'),
      worse: count('worse'),
    };
  });

  constructor() {
    this.prefill();
    void this.loadCases();
  }

  /** Start from what the person confirmed in this shift, else from the rule
   *  formulated after an earlier shift — to refine it rather than start over. */
  private prefill(): void {
    const since = this.tour.shiftStartedAt();
    const earlier = this.store
      .learningRecords()
      .filter((r: LearningRecord) => r.rule && r.createdAt >= this.tour.runStartedAt())
      .sort((a, b) => b.createdAt - a.createdAt)[0]?.rule;
    if (earlier) {
      this.useBlock.set(earlier.minBlockSteps != null);
      if (earlier.minBlockSteps != null) this.minBlockSteps.set(earlier.minBlockSteps);
      this.reroute.set(earlier.reroute);
      this.measure.set(earlier.measure);
    }
    const latest = this.store
      .learningRecords()
      .filter((r: LearningRecord) => r.createdAt >= since && r.context.impact)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest?.context.impact) return;
    const c = latest.context.impact;
    this.useBlock.set(c.clearsInSteps >= LONG_BLOCK_STEPS);
    this.reroute.set(c.canReroute ? 'yes' : 'any');
    const logged = latest.decision;
    this.measure.set(latest.action === 4 ? 'hold_until' : latest.action === 5 ? 'reroute' : logged === 'proceed' ? 'proceed' : 'reroute');
  }

  /** The decision moments of every shift so far, plus the test cases; every
   *  option played once at each. */
  async loadCases(): Promise<void> {
    const current = this.store.session()?.id;
    if (!current) {
      this.loadState.set('error');
      return;
    }
    this.loadState.set('loading');
    try {
      for (const id of this.tour.briefing()?.ruleTestCases ?? []) {
        await firstValueFrom(this.api.addSandboxCase(current, id));
      }
      const sessions = [
        ...this.tour.shiftHistory().map((s) => ({ sid: s.sessionId, shift: s.leg + 1 })),
        { sid: current, shift: this.store.demoStepIndex() + 1 },
      ].filter((s): s is { sid: string; shift: number } => !!s.sid);

      const cases: RuleCase[] = [];
      for (const { sid, shift } of sessions) {
        const state = await firstValueFrom(this.api.getSandbox(sid));
        for (const cp of state.checkpoints) {
          if (cp.kind === 'test' && sid !== current) continue;
          const item = cp.items[0];
          if (!item) continue;
          cases.push({
            key: `${sid}:${cp.id}`,
            shift: cp.kind === 'test' ? null : shift,
            step: cp.step,
            item,
            costs: await this.costs(sid, cp, item),
          });
        }
      }
      this.cases.set(cases);
      this.loadState.set('ready');
    } catch {
      this.loadState.set('error');
    }
  }

  private async costs(sid: string, cp: SandboxCheckpoint, item: SandboxItem): Promise<Partial<Record<SandboxOption, number>>> {
    const play = async (option: SandboxOption, releaseAfter?: number) =>
      costOf((await firstValueFrom(this.api.runSandbox(sid, {
        checkpoint: cp.id, handle: item.handle, option, release_after: releaseAfter,
      }))).outcome);
    const costs: Partial<Record<SandboxOption, number>> = {
      proceed: await play('proceed'),
      hold_until: await play('hold_until', Math.max(1, item.clears_in_steps)),
    };
    if (item.can_reroute) costs.reroute = await play('reroute');
    return costs;
  }

  setMinBlock(value: string): void {
    const n = Math.round(Number(value));
    if (Number.isFinite(n)) this.minBlockSteps.set(Math.min(40, Math.max(1, n)));
  }

  /** Take the rule over: a learning record with its own condition. */
  save(): void {
    const rule = this.rule();
    const action = rule.measure === 'hold_until' ? 4 : rule.measure === 'reroute' ? 5 : 2;
    const now = Date.now();
    this.learning.addRecord({
      id: `rule_${now}`,
      createdAt: now,
      mode: this.store.interactionMode(),
      handle: -1,
      action,
      strategyLabel: this.i18n.t(`tourUi.rule.measure.${rule.measure}`),
      decision: rule.measure === 'proceed' ? 'proceed' : undefined,
      rule,
      rationale: '',
      hypothesis: this.sentence(),
      response: 'yes',
      once: false,
      context: {
        connectionCritical: false,
        lowDelay: false,
        lowRipple: true,
        aiSuggestion: null,
        simStep: this.store.elapsedSteps(),
        hasScenario: false,
      },
    });
    this.saveState.set('saved');
  }

  caseLabel(c: RuleCase): string {
    return c.shift == null
      ? this.i18n.t('tourUi.rule.caseTest', { step: c.step, train: this.trainName(c.item.handle) })
      : this.i18n.t('tourUi.rule.caseShift', { n: c.shift, step: c.step, train: this.trainName(c.item.handle) });
  }

  caseFacts(c: RuleCase): string {
    return this.i18n.t(c.item.can_reroute ? 'tourUi.rule.factsReroute' : 'tourUi.rule.factsNoReroute', { n: c.item.clears_in_steps });
  }

  verdictText(check: RuleCheck): string {
    return this.i18n.t(`tourUi.rule.verdict.${check.verdict}`, {
      best: this.i18n.t(`tourUi.rule.measure.${check.bestOption}`),
      gap: check.gap,
    });
  }

  measureLabel(m: RuleMeasure): string {
    return this.i18n.t(`tourUi.rule.measure.${m}`);
  }

  trainName(handle: number): string {
    return this.identity.nameFor(handle);
  }
}
