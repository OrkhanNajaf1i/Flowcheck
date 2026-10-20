import { createReadStream, rmSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  archiveTestCase,
  createEnvironment,
  createProject,
  createRevision,
  createRun,
  createSecret,
  createTestCase,
  deleteProject,
  deleteSecret,
  duplicateTestCase,
  type FlowDb,
  getArtifact,
  getArtifacts,
  getEnvironment,
  getProject,
  getRevision,
  getRun,
  getStepRuns,
  getTestCase,
  listEnvironments,
  listProjects,
  listRevisions,
  listRunsForTestCase,
  listSecrets,
  listTestCases,
  loadMasterKey,
  missingSecrets,
  replaceSecretValue,
  requestCancel,
  updateEnvironment,
  updateProject,
  updateTestCase,
} from '@flowcheck/db';
import {
  createEnvironmentSchema,
  createProjectSchema,
  createRevisionSchema,
  createRunSchema,
  createSecretSchema,
  createTestCaseSchema,
  parseDefinition,
  referencedSecrets,
  replaceSecretSchema,
  resolveInputs,
  type TestDefinition,
  updateEnvironmentSchema,
  updateProjectSchema,
  updateTestCaseSchema,
  zodIssuesToValidationIssues,
} from '@flowcheck/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ServerConfig } from './config.ts';
import { environmentDto, environmentSnapshot, projectDto, revisionDto, runDto, secretDto, testCaseDto } from './dto.ts';
import { HttpError, validationError } from './errors.ts';

const idParam = <K extends string>(name: K) => z.object({ [name]: z.string().min(1).max(64) } as Record<K, z.ZodString>);

/** Validates a definition with the schema of its own schemaVersion. */
function validateDefinition(input: unknown): { schemaVersion: number; definition: TestDefinition } {
  const result = parseDefinition(input);
  if (result.ok) return { schemaVersion: result.definition.schemaVersion, definition: result.definition };
  if (result.code === 'UNSUPPORTED_SCHEMA_VERSION') throw new HttpError('UNSUPPORTED_SCHEMA_VERSION', result.message);
  throw validationError(
    'Test definition is invalid',
    zodIssuesToValidationIssues(result.error).map((issue) => ({ ...issue, path: ['definition', ...issue.path] })),
  );
}

export function apiRoutes(db: FlowDb, config: ServerConfig): FastifyPluginAsyncZod {
  return async (app) => {
    const master = loadMasterKey(config.dataDir);
    if (master.warning) app.log.warn(master.warning);

    // ---- Secrets: values go in, never come out ----
    app.get('/projects/:projectId/secrets', { schema: { params: idParam('projectId') } }, async (req) =>
      listSecrets(db, req.params.projectId).map(secretDto),
    );
    app.post('/projects/:projectId/secrets', { schema: { params: idParam('projectId'), body: createSecretSchema } }, async (req, reply) =>
      reply.code(201).send(secretDto(createSecret(db, master, req.params.projectId, req.body.name, req.body.value))),
    );
    app.put('/secrets/:secretId', { schema: { params: idParam('secretId'), body: replaceSecretSchema } }, async (req) =>
      secretDto(replaceSecretValue(db, master, req.params.secretId, req.body.value)),
    );
    app.delete('/secrets/:secretId', { schema: { params: idParam('secretId') } }, async (req, reply) => {
      deleteSecret(db, req.params.secretId);
      return reply.code(204).send();
    });

    // ---- Projects ----
    app.get('/projects', async () => listProjects(db).map(projectDto));

    app.post('/projects', { schema: { body: createProjectSchema } }, async (req, reply) =>
      reply.code(201).send(projectDto(createProject(db, req.body))),
    );

    app.get('/projects/:projectId', { schema: { params: idParam('projectId') } }, async (req) =>
      projectDto(getProject(db, req.params.projectId)),
    );

    app.patch('/projects/:projectId', { schema: { params: idParam('projectId'), body: updateProjectSchema } }, async (req) =>
      projectDto(updateProject(db, req.params.projectId, req.body)),
    );

    app.delete('/projects/:projectId', { schema: { params: idParam('projectId') } }, async (req, reply) => {
      deleteProject(db, req.params.projectId);
      // Rows are gone; now remove the screenshots. A failure here is logged, not hidden.
      const root = resolve(config.artifactsDir);
      const dir = resolve(root, req.params.projectId);
      if (dir.startsWith(root + sep)) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch (error) {
          req.log.error({ err: error, dir }, 'failed to delete project artifacts');
        }
      }
      return reply.code(204).send();
    });

    // ---- Environments ----
    app.get('/projects/:projectId/environments', { schema: { params: idParam('projectId') } }, async (req) =>
      listEnvironments(db, req.params.projectId).map(environmentDto),
    );

    app.post(
      '/projects/:projectId/environments',
      { schema: { params: idParam('projectId'), body: createEnvironmentSchema } },
      async (req, reply) => reply.code(201).send(environmentDto(createEnvironment(db, req.params.projectId, req.body))),
    );

    app.get('/environments/:environmentId', { schema: { params: idParam('environmentId') } }, async (req) =>
      environmentDto(getEnvironment(db, req.params.environmentId)),
    );

    app.patch(
      '/environments/:environmentId',
      { schema: { params: idParam('environmentId'), body: updateEnvironmentSchema } },
      async (req) => environmentDto(updateEnvironment(db, req.params.environmentId, stripUndefined(req.body))),
    );

    // ---- Test cases and revisions ----
    app.get(
      '/projects/:projectId/test-cases',
      { schema: { params: idParam('projectId'), querystring: z.object({ includeArchived: z.enum(['true', 'false']).optional() }) } },
      async (req) => listTestCases(db, req.params.projectId, { includeArchived: req.query.includeArchived === 'true' }).map(testCaseDto),
    );

    app.post(
      '/projects/:projectId/test-cases',
      { schema: { params: idParam('projectId'), body: createTestCaseSchema } },
      async (req, reply) => {
        const revision = validateDefinition(req.body.definition);
        const created = createTestCase(db, req.params.projectId, { name: req.body.name, description: req.body.description }, revision);
        return reply.code(201).send({ testCase: testCaseDto(created.testCase), revision: revisionDto(created.revision) });
      },
    );

    app.get('/test-cases/:testCaseId', { schema: { params: idParam('testCaseId') } }, async (req) =>
      testCaseDto(getTestCase(db, req.params.testCaseId)),
    );

    app.patch('/test-cases/:testCaseId', { schema: { params: idParam('testCaseId'), body: updateTestCaseSchema } }, async (req) =>
      testCaseDto(updateTestCase(db, req.params.testCaseId, req.body)),
    );

    app.post('/test-cases/:testCaseId/archive', { schema: { params: idParam('testCaseId') } }, async (req) =>
      testCaseDto(archiveTestCase(db, req.params.testCaseId)),
    );

    app.post('/test-cases/:testCaseId/duplicate', { schema: { params: idParam('testCaseId') } }, async (req, reply) => {
      const copy = duplicateTestCase(db, req.params.testCaseId);
      return reply.code(201).send({ testCase: testCaseDto(copy.testCase), revision: revisionDto(copy.revision) });
    });

    app.get('/test-cases/:testCaseId/revisions', { schema: { params: idParam('testCaseId') } }, async (req) =>
      listRevisions(db, req.params.testCaseId).map(revisionDto),
    );

    app.post(
      '/test-cases/:testCaseId/revisions',
      { schema: { params: idParam('testCaseId'), body: createRevisionSchema } },
      async (req, reply) => {
        const revision = validateDefinition(req.body.definition);
        return reply.code(201).send(revisionDto(createRevision(db, req.params.testCaseId, req.body.baseRevisionId, revision)));
      },
    );

    app.get('/revisions/:revisionId', { schema: { params: idParam('revisionId') } }, async (req) =>
      revisionDto(getRevision(db, req.params.revisionId)),
    );

    // ---- Runs ----
    app.get('/test-cases/:testCaseId/runs', { schema: { params: idParam('testCaseId') } }, async (req) => {
      getTestCase(db, req.params.testCaseId);
      return listRunsForTestCase(db, req.params.testCaseId).map((run) => ({
        id: run.id,
        status: run.status,
        revisionId: run.revisionId,
        environmentId: run.environmentId,
        createdAt: new Date(run.createdAt).toISOString(),
        finishedAt: run.finishedAt === null ? null : new Date(run.finishedAt).toISOString(),
        failureSummary: run.failureSummary ?? null,
      }));
    });

    app.post('/test-cases/:testCaseId/runs', { schema: { params: idParam('testCaseId'), body: createRunSchema } }, async (req, reply) => {
      const testCase = getTestCase(db, req.params.testCaseId);
      if (testCase.archivedAt !== null) throw new HttpError('VALIDATION_ERROR', 'Archived test cases cannot be run');
      const revisionId = req.body.revisionId ?? testCase.currentRevisionId;
      if (revisionId === null) throw new HttpError('VALIDATION_ERROR', 'The test case has no saved revision');
      const revision = getRevision(db, revisionId);
      if (revision.testCaseId !== testCase.id) throw new HttpError('NOT_FOUND', `Revision ${revisionId} does not belong to this test case`);

      const parsed = parseDefinition(revision.definition);
      if (!parsed.ok) {
        throw new HttpError(parsed.code, parsed.code === 'UNSUPPORTED_SCHEMA_VERSION' ? parsed.message : 'Stored definition is invalid');
      }
      // A run never starts without the secrets it needs.
      const missing = missingSecrets(db, testCase.projectId, referencedSecrets(parsed.definition));
      if (missing.length > 0) {
        throw new HttpError('SECRET_NOT_FOUND', `This test needs secret(s) that do not exist in the project: ${missing.join(', ')}`, {
          missing,
        });
      }
      const inputs = resolveInputs(parsed.definition, req.body.inputs);
      if (!inputs.ok) {
        throw validationError(
          'Run inputs are invalid',
          inputs.issues.map((issue) => ({ path: ['inputs', issue.input], code: 'custom', message: issue.message })),
        );
      }

      const environment = getEnvironment(db, req.body.environmentId);
      if (environment.projectId !== testCase.projectId) {
        throw new HttpError('NOT_FOUND', `Environment ${environment.id} does not belong to this project`);
      }
      if (!environment.enabled) throw new HttpError('ENVIRONMENT_DISABLED', `Environment "${environment.name}" is disabled`);

      // Snapshot at creation: the run executes against what the tester saw when starting it.
      const run = createRun(db, {
        testCaseId: testCase.id,
        revisionId: revision.id,
        environmentId: environment.id,
        environmentSnapshot: environmentSnapshot(environment),
        inputsSnapshot: inputs.values,
      });
      return reply.code(202).send({ runId: run.id, status: run.status });
    });

    app.get('/runs/:runId', { schema: { params: idParam('runId') } }, async (req) => {
      const run = getRun(db, req.params.runId);
      return runDto(run, getRevision(db, run.revisionId), getStepRuns(db, run.id), getArtifacts(db, run.id));
    });

    app.post('/runs/:runId/cancel', { schema: { params: idParam('runId') } }, async (req, reply) => {
      const run = requestCancel(db, req.params.runId);
      return reply.code(202).send({
        runId: run.id,
        status: run.status,
        cancellationRequestedAt: run.cancellationRequestedAt === null ? null : new Date(run.cancellationRequestedAt).toISOString(),
      });
    });

    // ---- Artifacts: only through the run they belong to, never from a static directory ----
    app.get(
      '/runs/:runId/artifacts/:artifactId',
      { schema: { params: z.object({ runId: z.string().max(64), artifactId: z.string().max(64) }) } },
      async (req, reply) => {
        const artifact = getArtifact(db, req.params.runId, req.params.artifactId);
        const root = resolve(config.artifactsDir);
        const file = resolve(root, artifact.relativePath);
        if (!file.startsWith(root + sep)) throw new HttpError('NOT_FOUND', 'Artifact not found');
        let size: number;
        try {
          size = statSync(file).size;
        } catch {
          throw new HttpError('NOT_FOUND', 'Artifact file is missing (it may have been removed by retention)');
        }
        const inline = artifact.mimeType === 'image/png';
        return reply
          .header('content-type', inline ? artifact.mimeType : 'application/octet-stream')
          .header('content-length', size)
          .header('content-disposition', inline ? 'inline' : `attachment; filename="${artifact.id}"`)
          .header('content-security-policy', "sandbox; default-src 'none'")
          .header('cache-control', 'private, no-store')
          .send(createReadStream(file));
      },
    );
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
