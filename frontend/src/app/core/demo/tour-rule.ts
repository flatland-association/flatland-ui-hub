/**
 * A rule the person formulates after a shift (advanced Co-Learning tour, WP3,
 * docs/plans/colearning-advanced-tour.md): the abstract conceptualisation of
 * Kolb's cycle, which the interview tour only draws dashed.
 *
 * A rule is a condition over what the impact analysis reports — how long the
 * section stays blocked, whether a reroute exists — and a measure. It is
 * checked against the sandbox: in every case it applies to, its measure is
 * compared with the other options, played from the same checkpoint.
 */

import { ImpactItem } from '../events/event-types';
import { SandboxOption, SandboxOutcome } from './sandbox-replay';

export type RuleMeasure = 'proceed' | 'hold_until' | 'reroute';

export interface TourRule {
  /** The section is blocked for at least this many more steps; null = any. */
  minBlockSteps: number | null;
  /** Whether a reroute must (not) be available; 'any' = no condition. */
  reroute: 'yes' | 'no' | 'any';
  measure: RuleMeasure;
}

export type Translate = (key: string, params?: Record<string, string>, fallback?: string) => string;

export function ruleApplies(rule: TourRule, item: Pick<ImpactItem, 'clears_in_steps' | 'can_reroute'>): boolean {
  if (rule.minBlockSteps != null && item.clears_in_steps < rule.minBlockSteps) return false;
  if (rule.reroute === 'yes' && !item.can_reroute) return false;
  if (rule.reroute === 'no' && item.can_reroute) return false;
  // A reroute rule cannot be carried out where there is none.
  return rule.measure !== 'reroute' || item.can_reroute;
}

/** The rule as one sentence, «Wenn …, dann …». */
export function ruleSentence(rule: TourRule, t: Translate): string {
  const parts: string[] = [];
  if (rule.minBlockSteps != null) {
    parts.push(t('tourUi.rule.cond.block', { n: String(rule.minBlockSteps) }));
  }
  if (rule.reroute === 'yes') parts.push(t('tourUi.rule.cond.reroute'));
  if (rule.reroute === 'no') parts.push(t('tourUi.rule.cond.noReroute'));
  const measure = t(`tourUi.rule.then.${rule.measure}`);
  return parts.length === 0
    ? t('tourUi.rule.sentenceAlways', { measure })
    : t('tourUi.rule.sentence', { cond: parts.join(t('tourUi.rule.and')), measure });
}

/** Comparable cost of an outcome: delay against the plan, and a train that
 *  does not arrive outweighs any delay. */
export function costOf(o: SandboxOutcome): number {
  return o.totalDelayVsPlan + 1000 * (o.total - o.arrived);
}

/**
 * - best: the rule's measure is the one cheapest option
 * - tie: it is among the cheapest, but another option does as well — the rule
 *   brings nothing here
 * - equal: every option costs the same, no rule could help
 * - worse: another option was cheaper
 */
export type RuleVerdict = 'best' | 'tie' | 'equal' | 'worse' | 'unavailable';

export interface RuleCheck {
  verdict: RuleVerdict;
  /** The cheapest option at this checkpoint. */
  bestOption: SandboxOption;
  /** How much more the rule's measure cost than the best option. */
  gap: number;
}

/**
 * How the rule's measure did at one checkpoint, given every option's cost
 * there. 'equal': every option costs the same, so no rule could help.
 */
export function checkRule(measure: RuleMeasure, costs: Partial<Record<SandboxOption, number>>): RuleCheck {
  const entries = Object.entries(costs) as [SandboxOption, number][];
  const [bestOption, best] = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
  const mine = costs[measure];
  if (mine == null) return { verdict: 'unavailable', bestOption, gap: 0 };
  if (entries.every(([, c]) => c === best)) return { verdict: 'equal', bestOption, gap: 0 };
  if (mine === best) {
    const other = entries.find(([option, c]) => option !== measure && c === best);
    return other ? { verdict: 'tie', bestOption: other[0], gap: 0 } : { verdict: 'best', bestOption: measure, gap: 0 };
  }
  return { verdict: 'worse', bestOption, gap: mine - best };
}
