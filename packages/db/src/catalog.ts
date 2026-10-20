import type { EnvironmentKind } from '@flowcheck/shared';
import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import type { FlowDb } from './client.ts';
import { notFound, RepoError } from './errors.ts';
import { newId } from './ids.ts';
import { environments, projects, secrets, testCases, testRevisions, testRuns } from './schema.ts';

export type ProjectRow = typeof projects.$inferSelect;
export type EnvironmentRow = typeof environments.$inferSelect;
export type TestCaseRow = typeof testCases.$inferSelect;
export type RevisionRow = typeof testRevisions.$inferSelect;

// ---- Projects ----

export function createProject(db: FlowDb, input: { name: string; description: string }, now = Date.now()): ProjectRow {
  return db
    .insert(projects)
    .values({ id: newId(now), ...input, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function listProjects(db: FlowDb): ProjectRow[] {
  return db.select().from(projects).orderBy(asc(projects.name)).all();
}

export function getProject(db: FlowDb, id: string): ProjectRow {
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) throw notFound('Project', id);
  return row;
}

export function updateProject(
  db: FlowDb,
  id: string,
  patch: { name?: string | undefined; description?: string | undefined },
  now = Date.now(),
): ProjectRow {
  getProject(db, id);
  return db
    .update(projects)
    .set({ ...definedOnly(patch), updatedAt: now })
    .where(eq(projects.id, id))
    .returning()
    .get() as ProjectRow;
}

/**
 * Permanently deletes a project with its environments, test cases, revisions, runs, step
 * results and artifact rows. Refused while any of its runs is queued or running, so no run is
 * cut off half-way. Artifact files are removed by the caller after this commits.
 */
export function deleteProject(db: FlowDb, id: string): void {
  db.transaction(
    (tx) => {
      getProject(tx as unknown as FlowDb, id);
      const caseIds = tx
        .select({ id: testCases.id })
        .from(testCases)
        .where(eq(testCases.projectId, id))
        .all()
        .map((r) => r.id);
      if (caseIds.length > 0) {
        const active = tx
          .select({ id: testRuns.id })
          .from(testRuns)
          .where(and(inArray(testRuns.testCaseId, caseIds), inArray(testRuns.status, ['queued', 'running'])))
          .get();
        if (active) {
          throw new RepoError(
            'PROJECT_HAS_ACTIVE_RUNS',
            'This project has a queued or running test. Stop it before deleting the project.',
            {
              runId: active.id,
            },
          );
        }
        // step_runs and artifacts rows go with their runs (ON DELETE CASCADE).
        tx.delete(testRuns).where(inArray(testRuns.testCaseId, caseIds)).run();
        tx.delete(testRevisions).where(inArray(testRevisions.testCaseId, caseIds)).run();
        tx.delete(testCases).where(eq(testCases.projectId, id)).run();
      }
      tx.delete(secrets).where(eq(secrets.projectId, id)).run();
      tx.delete(environments).where(eq(environments.projectId, id)).run();
      tx.delete(projects).where(eq(projects.id, id)).run();
    },
    { behavior: 'immediate' },
  );
}

// ---- Environments ----

export interface EnvironmentInput {
  name: string;
  kind: EnvironmentKind;
  frontendBaseUrl: string;
  apiBaseUrl: string;
  allowedOrigins: string[];
  allowPrivateNetwork: boolean;
  enabled: boolean;
}

export function createEnvironment(db: FlowDb, projectId: string, input: EnvironmentInput, now = Date.now()): EnvironmentRow {
  getProject(db, projectId);
  return db
    .insert(environments)
    .values({ id: newId(now), projectId, ...input, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function listEnvironments(db: FlowDb, projectId: string): EnvironmentRow[] {
  getProject(db, projectId);
  return db.select().from(environments).where(eq(environments.projectId, projectId)).orderBy(asc(environments.name)).all();
}

export function getEnvironment(db: FlowDb, id: string): EnvironmentRow {
  const row = db.select().from(environments).where(eq(environments.id, id)).get();
  if (!row) throw notFound('Environment', id);
  return row;
}

export function updateEnvironment(db: FlowDb, id: string, patch: Partial<EnvironmentInput>, now = Date.now()): EnvironmentRow {
  getEnvironment(db, id);
  return db
    .update(environments)
    .set({ ...definedOnly(patch), updatedAt: now })
    .where(eq(environments.id, id))
    .returning()
    .get() as EnvironmentRow;
}

// ---- Test cases and revisions ----

export interface NewRevision {
  schemaVersion: number;
  definition: unknown;
}

/** Creates the test case and its first revision atomically. */
export function createTestCase(
  db: FlowDb,
  projectId: string,
  input: { name: string; description: string },
  revision: NewRevision,
  now = Date.now(),
): { testCase: TestCaseRow; revision: RevisionRow } {
  return db.transaction(
    (tx) => {
      getProject(tx as unknown as FlowDb, projectId);
      const testCaseId = newId(now);
      tx.insert(testCases)
        .values({ id: testCaseId, projectId, ...input, currentRevisionId: null, archivedAt: null, createdAt: now, updatedAt: now })
        .run();
      const rev = tx
        .insert(testRevisions)
        .values({ id: newId(now), testCaseId, revisionNumber: 1, ...revision, createdAt: now })
        .returning()
        .get();
      const testCase = tx
        .update(testCases)
        .set({ currentRevisionId: rev.id })
        .where(eq(testCases.id, testCaseId))
        .returning()
        .get() as TestCaseRow;
      return { testCase, revision: rev };
    },
    { behavior: 'immediate' },
  );
}

export interface TestCaseWithLastRun extends TestCaseRow {
  lastRun: { id: string; status: (typeof testRuns.$inferSelect)['status']; createdAt: number } | null;
}

export function listTestCases(db: FlowDb, projectId: string, options: { includeArchived?: boolean } = {}): TestCaseWithLastRun[] {
  getProject(db, projectId);
  const where = options.includeArchived
    ? eq(testCases.projectId, projectId)
    : and(eq(testCases.projectId, projectId), isNull(testCases.archivedAt));
  const rows = db.select().from(testCases).where(where).orderBy(asc(testCases.name)).all();
  if (rows.length === 0) return [];
  const runs = db
    .select({ id: testRuns.id, testCaseId: testRuns.testCaseId, status: testRuns.status, createdAt: testRuns.createdAt })
    .from(testRuns)
    .where(
      inArray(
        testRuns.testCaseId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(desc(testRuns.createdAt), desc(testRuns.id))
    .all();
  const latest = new Map<string, TestCaseWithLastRun['lastRun']>();
  for (const run of runs) {
    if (!latest.has(run.testCaseId)) latest.set(run.testCaseId, { id: run.id, status: run.status, createdAt: run.createdAt });
  }
  return rows.map((row) => ({ ...row, lastRun: latest.get(row.id) ?? null }));
}

export function getTestCase(db: FlowDb, id: string): TestCaseRow {
  const row = db.select().from(testCases).where(eq(testCases.id, id)).get();
  if (!row) throw notFound('Test case', id);
  return row;
}

export function updateTestCase(
  db: FlowDb,
  id: string,
  patch: { name?: string | undefined; description?: string | undefined },
  now = Date.now(),
): TestCaseRow {
  getTestCase(db, id);
  return db
    .update(testCases)
    .set({ ...definedOnly(patch), updatedAt: now })
    .where(eq(testCases.id, id))
    .returning()
    .get() as TestCaseRow;
}

/** Archiving keeps all revisions and runs. There is no hard delete of test cases in v1. */
export function archiveTestCase(db: FlowDb, id: string, now = Date.now()): TestCaseRow {
  const row = getTestCase(db, id);
  if (row.archivedAt !== null) return row;
  return db.update(testCases).set({ archivedAt: now, updatedAt: now }).where(eq(testCases.id, id)).returning().get() as TestCaseRow;
}

/**
 * Saves a new immutable revision. `baseRevisionId` must be the current revision, otherwise
 * another editor saved in between and REVISION_CONFLICT is raised instead of overwriting.
 */
export function createRevision(
  db: FlowDb,
  testCaseId: string,
  baseRevisionId: string | null,
  revision: NewRevision,
  now = Date.now(),
): RevisionRow {
  return db.transaction(
    (tx) => {
      const testCase = getTestCase(tx as unknown as FlowDb, testCaseId);
      if (testCase.archivedAt !== null) {
        throw new RepoError('VALIDATION_ERROR', 'Archived test cases cannot be edited');
      }
      if (testCase.currentRevisionId !== baseRevisionId) {
        throw new RepoError('REVISION_CONFLICT', 'The test was changed since you opened it', {
          currentRevisionId: testCase.currentRevisionId,
        });
      }
      const last = tx
        .select({ n: max(testRevisions.revisionNumber) })
        .from(testRevisions)
        .where(eq(testRevisions.testCaseId, testCaseId))
        .get();
      const rev = tx
        .insert(testRevisions)
        .values({ id: newId(now), testCaseId, revisionNumber: (last?.n ?? 0) + 1, ...revision, createdAt: now })
        .returning()
        .get();
      tx.update(testCases).set({ currentRevisionId: rev.id, updatedAt: now }).where(eq(testCases.id, testCaseId)).run();
      return rev;
    },
    { behavior: 'immediate' },
  );
}

export function listRevisions(db: FlowDb, testCaseId: string): RevisionRow[] {
  getTestCase(db, testCaseId);
  return db.select().from(testRevisions).where(eq(testRevisions.testCaseId, testCaseId)).orderBy(desc(testRevisions.revisionNumber)).all();
}

export function getRevision(db: FlowDb, id: string): RevisionRow {
  const row = db.select().from(testRevisions).where(eq(testRevisions.id, id)).get();
  if (!row) throw notFound('Revision', id);
  return row;
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Copies the current revision into a new test case. Run history is not copied. */
export function duplicateTestCase(db: FlowDb, id: string, now = Date.now()): { testCase: TestCaseRow; revision: RevisionRow } {
  const source = getTestCase(db, id);
  if (source.currentRevisionId === null) throw new RepoError('VALIDATION_ERROR', 'The test case has no saved revision to copy');
  const revision = getRevision(db, source.currentRevisionId);
  return createTestCase(
    db,
    source.projectId,
    { name: `Copy of ${source.name}`.slice(0, 100), description: source.description },
    { schemaVersion: revision.schemaVersion, definition: revision.definition },
    now,
  );
}
