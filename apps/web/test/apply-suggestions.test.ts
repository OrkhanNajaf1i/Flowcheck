import type { RecordedSuggestion, Step } from '@flowcheck/shared';
import { describe, expect, it } from 'vitest';
import { applySuggestions } from '@/features/recorder/apply-suggestions';

const open: Step = { id: 'rec-1', name: 'Open /', type: 'navigate', url: '/' };
const click: Step = { id: 'rec-2', name: 'Click "Create"', type: 'click', locator: { kind: 'role', role: 'button', name: 'Create' } };
const dialogCheck: RecordedSuggestion = {
  id: 'sug-1',
  stepId: 'rec-2',
  what: 'dialog',
  selected: true,
  kind: 'step',
  step: { id: 'rec-check-1', name: 'Check "New" is shown', type: 'assertVisible', locator: { kind: 'role', role: 'dialog', name: 'New' } },
};
const request: RecordedSuggestion = {
  id: 'sug-2',
  stepId: 'rec-2',
  what: 'request',
  selected: true,
  kind: 'networkCheck',
  networkCheck: {
    id: 'nc-1',
    name: 'POST /api/items',
    match: { origin: 'api', method: 'POST', pathname: '/api/items' },
    assertions: [{ kind: 'statusEquals', expected: 201 }],
  },
};

describe('applySuggestions', () => {
  it('attaches selected request checks to their step and inserts selected checks after it', () => {
    const steps = applySuggestions([open, click], [dialogCheck, request], (s) => s.selected);
    expect(steps.map((s) => s.id)).toEqual(['rec-1', 'rec-2', 'rec-check-1']);
    expect(steps[1]).toMatchObject({ networkChecks: [request.kind === 'networkCheck' ? request.networkCheck : null] });
  });

  it('drops unselected suggestions', () => {
    expect(applySuggestions([open, click], [dialogCheck, request], () => false)).toEqual([open, click]);
  });
});
