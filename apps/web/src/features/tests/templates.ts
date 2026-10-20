import { CURRENT_SCHEMA_VERSION, type Step, type TestDefinition } from '@flowcheck/shared';
import { newStepId } from '@/features/editor/definition-form';
import { t } from '@/i18n';

export const TEMPLATE_IDS = ['login', 'pageText', 'api', 'blank'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/**
 * Starting points for new tests. Values are examples the tester replaces with what their site
 * really shows; nothing here is assumed to be true for any website.
 */
export function templateDefinition(id: TemplateId): TestDefinition {
  const steps = TEMPLATE_STEPS[id]();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION as 1,
    metadata: { tags: [] },
    inputs: [],
    setupSteps: [],
    steps,
    cleanupSteps: [],
  };
}

const s = t.steps.types;

const TEMPLATE_STEPS: Record<TemplateId, () => Step[]> = {
  blank: () => [{ id: newStepId(), name: s.navigate, type: 'navigate', url: '/' }],
  login: () => [
    { id: newStepId(), name: `${s.navigate}: /login`, type: 'navigate', url: '/login' },
    {
      id: newStepId(),
      name: `${s.fill}: Email`,
      type: 'fill',
      locator: { kind: 'label', value: 'Email', exact: true },
      value: 'test@example.com',
    },
    {
      id: newStepId(),
      name: `${s.fill}: Password`,
      type: 'fill',
      locator: { kind: 'label', value: 'Password', exact: true },
      value: 'change-me',
    },
    { id: newStepId(), name: `${s.click}: Log in`, type: 'click', locator: { kind: 'role', role: 'button', name: 'Log in' } },
    {
      id: newStepId(),
      name: `${s.assertVisible}: Log out`,
      type: 'assertVisible',
      locator: { kind: 'text', value: 'Log out', exact: true },
    },
  ],
  pageText: () => [
    { id: newStepId(), name: s.navigate, type: 'navigate', url: '/' },
    { id: newStepId(), name: s.assertVisible, type: 'assertVisible', locator: { kind: 'text', value: 'Welcome', exact: false } },
  ],
  api: () => [
    {
      id: newStepId(),
      name: `${s.apiRequest}: GET /health`,
      type: 'apiRequest',
      method: 'GET',
      path: '/health',
      assertions: [{ kind: 'statusEquals', expected: 200 }],
    },
  ],
};
