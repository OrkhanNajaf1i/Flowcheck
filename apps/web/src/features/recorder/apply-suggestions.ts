import { NETWORK_CHECK_STEP_TYPES, type RecordedSuggestion, type Step, stepNetworkChecks } from '@flowcheck/shared';

/** Request checks a step can hold (PROJECT_RULES §10). */
const MAX_NETWORK_CHECKS = 5;

/**
 * Builds the steps to add from a recording: each recorded step, with the selected request checks
 * attached to it and the selected check steps right after it. Unselected suggestions are dropped.
 */
export function applySuggestions(steps: Step[], suggestions: RecordedSuggestion[], isSelected: (s: RecordedSuggestion) => boolean): Step[] {
  const out: Step[] = [];
  for (const step of steps) {
    const mine = suggestions.filter((s) => s.stepId === step.id && isSelected(s));
    const checks = mine.flatMap((s) => (s.kind === 'networkCheck' ? [s.networkCheck] : []));
    const canHold = (NETWORK_CHECK_STEP_TYPES as readonly string[]).includes(step.type);
    const merged = [...stepNetworkChecks(step), ...(canHold ? checks : [])].slice(0, MAX_NETWORK_CHECKS);
    out.push(merged.length > 0 ? ({ ...step, networkChecks: merged } as Step) : step);
    for (const s of mine) if (s.kind === 'step') out.push(s.step);
  }
  return out;
}
