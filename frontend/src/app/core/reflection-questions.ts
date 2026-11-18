/**
 * The guided questions of the reflection after a decision, beside the
 * always-asked factors, and their order (docs/plans/reflection-question-order.md).
 * In core, because the deployment config (`UiConfigService`) sets the order
 * and core can't import a feature.
 */

/** The ids are keys of the recorded answers and values in `ui-config.json`: keep them. */
export type ReflectionQuestionId = 'gut' | 'missing' | 'tradeoff';

/** Every guided question, in the default order: from a quick choice to the
 *  one free-text question (decided 2026-11-16, plan Q-2). */
export const REFLECTION_QUESTION_POOL: readonly ReflectionQuestionId[] = ['gut', 'missing', 'tradeoff'];

/**
 * The order the reflection asks in: the configured ids first, in their
 * order, then the questions not listed, in the default order, so every
 * question is still asked. An unknown or repeated id warns and is skipped.
 * Nothing configured gives the default order.
 */
export function resolveReflectionQuestionOrder(configured: readonly unknown[] | null | undefined): ReflectionQuestionId[] {
  const order: ReflectionQuestionId[] = [];
  for (const id of configured ?? []) {
    if (!REFLECTION_QUESTION_POOL.includes(id as ReflectionQuestionId)) {
      console.warn(`[uiConfig] unknown reflection question "${String(id)}", ignoring.`);
    } else if (order.includes(id as ReflectionQuestionId)) {
      console.warn(`[uiConfig] reflection question "${String(id)}" listed twice, ignoring the repeat.`);
    } else {
      order.push(id as ReflectionQuestionId);
    }
  }
  return [...order, ...REFLECTION_QUESTION_POOL.filter((id) => !order.includes(id))];
}
