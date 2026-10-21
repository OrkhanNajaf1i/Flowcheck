import type {
  EnvironmentKind,
  EnvironmentSnapshot,
  ErrorCode,
  FailureSummary,
  InputValue,
  RunStatus,
  StepPhase,
  StepStatus,
} from '@flowcheck/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Tables are added in the implementation phase that uses them (PROJECT_RULES §22).
 * Timestamps are epoch milliseconds. JSON columns are text with mode 'json'.
 * Immutability of revisions and run snapshots is also enforced by triggers (see migrations).
 */

const timestamps = {
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
};

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  ...timestamps,
});

export const environments = sqliteTable(
  'environments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    kind: text('kind').$type<EnvironmentKind>().notNull(),
    frontendBaseUrl: text('frontend_base_url').notNull(),
    apiBaseUrl: text('api_base_url').notNull(),
    allowedOrigins: text('allowed_origins', { mode: 'json' }).$type<string[]>().notNull(),
    allowPrivateNetwork: integer('allow_private_network', { mode: 'boolean' }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    ...timestamps,
  },
  (t) => [index('environments_project_idx').on(t.projectId)],
);

export const testCases = sqliteTable(
  'test_cases',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description').notNull(),
    currentRevisionId: text('current_revision_id'),
    archivedAt: integer('archived_at'),
    ...timestamps,
  },
  (t) => [index('test_cases_project_idx').on(t.projectId)],
);

export const testRevisions = sqliteTable(
  'test_revisions',
  {
    id: text('id').primaryKey(),
    testCaseId: text('test_case_id')
      .notNull()
      .references(() => testCases.id),
    revisionNumber: integer('revision_number').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    definition: text('definition', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('test_revisions_number_uq').on(t.testCaseId, t.revisionNumber)],
);

export const testRuns = sqliteTable(
  'test_runs',
  {
    id: text('id').primaryKey(),
    testCaseId: text('test_case_id')
      .notNull()
      .references(() => testCases.id),
    revisionId: text('revision_id')
      .notNull()
      .references(() => testRevisions.id),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id),
    environmentSnapshot: text('environment_snapshot', { mode: 'json' }).$type<EnvironmentSnapshot>().notNull(),
    /** Never contains secret values. */
    inputsSnapshot: text('inputs_snapshot', { mode: 'json' }).$type<Record<string, InputValue>>().notNull(),
    status: text('status').$type<RunStatus>().notNull(),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    cancellationRequestedAt: integer('cancellation_requested_at'),
    failureSummary: text('failure_summary', { mode: 'json' }).$type<FailureSummary>(),
    workerId: text('worker_id'),
    claimedAt: integer('claimed_at'),
    heartbeatAt: integer('heartbeat_at'),
    traceEnabled: integer('trace_enabled', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('test_runs_queue_idx').on(t.status, t.createdAt), index('test_runs_test_case_idx').on(t.testCaseId, t.createdAt)],
);

export const stepRuns = sqliteTable(
  'step_runs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => testRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    phase: text('phase').$type<StepPhase>().notNull(),
    order: integer('order').notNull(),
    status: text('status').$type<StepStatus>().notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    expected: text('expected', { mode: 'json' }).$type<unknown>(),
    actual: text('actual', { mode: 'json' }).$type<unknown>(),
    errorCode: text('error_code').$type<ErrorCode>(),
    errorMessage: text('error_message'),
    skipReason: text('skip_reason'),
  },
  (t) => [uniqueIndex('step_runs_order_uq').on(t.runId, t.order)],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => testRuns.id, { onDelete: 'cascade' }),
    stepRunId: text('step_run_id').references(() => stepRuns.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    /** Server-generated, relative to the artifacts root. Never user input. */
    relativePath: text('relative_path').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    sensitive: integer('sensitive', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('artifacts_run_idx').on(t.runId)],
);

/** Single-row lock shared by runs, recordings and auth captures. */
export const executionLock = sqliteTable(
  'execution_lock',
  {
    id: integer('id').primaryKey(),
    holderKind: text('holder_kind').$type<'run' | 'recording' | 'auth_capture'>().notNull(),
    holderId: text('holder_id').notNull(),
    acquiredAt: integer('acquired_at').notNull(),
    heartbeatAt: integer('heartbeat_at').notNull(),
  },
  (t) => [check('execution_lock_single_row', sql`${t.id} = 1`)],
);
