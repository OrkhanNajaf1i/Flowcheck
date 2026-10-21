import type {
  ArtifactRow,
  AuthCaptureRow,
  AuthProfileRow,
  EnvironmentRow,
  ProjectRow,
  RecordingRow,
  RevisionRow,
  RunRow,
  SecretInfo,
  StepRunRow,
  TestCaseWithLastRun,
} from '@flowcheck/db';
import {
  type ArtifactDto,
  type AuthCaptureDto,
  type AuthProfileDto,
  buildRecordedSteps,
  type EnvironmentDto,
  type EnvironmentSnapshot,
  effectiveAllowedOrigins,
  type ProjectDto,
  type RecordedEvent,
  type RecordingDto,
  type RevisionDto,
  type RunDto,
  type SecretDto,
  type StepRunDto,
  type TestCaseDto,
} from '@flowcheck/shared';

const iso = (ms: number) => new Date(ms).toISOString();
const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms));

export function authProfileDto(row: AuthProfileRow): AuthProfileDto {
  return {
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    name: row.name,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function authCaptureDto(row: AuthCaptureRow): AuthCaptureDto {
  return {
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    profileName: row.profileName,
    startPath: row.startPath,
    status: row.status,
    error: row.error,
    authProfileId: row.authProfileId,
    createdAt: iso(row.createdAt),
    finishedAt: isoOrNull(row.finishedAt),
  };
}

/** Draft steps are derived from the stored events on every read (single source of truth). */
export function recordingDto(row: RecordingRow, events: RecordedEvent[]): RecordingDto {
  const { steps, warnings, suggestions } = buildRecordedSteps(events, row.startPath);
  return {
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    testCaseId: row.testCaseId,
    startPath: row.startPath,
    status: row.status,
    error: row.error,
    eventCount: events.length,
    steps,
    warnings,
    suggestions,
    createdAt: iso(row.createdAt),
    finishedAt: isoOrNull(row.finishedAt),
  };
}

export function secretDto(row: SecretInfo): SecretDto {
  return { id: row.id, projectId: row.projectId, name: row.name, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

export function projectDto(row: ProjectRow): ProjectDto {
  return { id: row.id, name: row.name, description: row.description, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

export function environmentDto(row: EnvironmentRow): EnvironmentDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    kind: row.kind,
    frontendBaseUrl: row.frontendBaseUrl,
    apiBaseUrl: row.apiBaseUrl,
    allowedOrigins: row.allowedOrigins,
    effectiveAllowedOrigins: effectiveAllowedOrigins(row),
    allowPrivateNetwork: row.allowPrivateNetwork,
    enabled: row.enabled,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function environmentSnapshot(row: EnvironmentRow): EnvironmentSnapshot {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    frontendBaseUrl: row.frontendBaseUrl,
    apiBaseUrl: row.apiBaseUrl,
    allowedOrigins: [...row.allowedOrigins],
    allowPrivateNetwork: row.allowPrivateNetwork,
  };
}

export function testCaseDto(row: TestCaseWithLastRun | (Omit<TestCaseWithLastRun, 'lastRun'> & { lastRun?: undefined })): TestCaseDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    currentRevisionId: row.currentRevisionId,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    lastRun: row.lastRun ? { id: row.lastRun.id, status: row.lastRun.status, createdAt: iso(row.lastRun.createdAt) } : null,
  };
}

export function revisionDto(row: RevisionRow): RevisionDto {
  return {
    id: row.id,
    testCaseId: row.testCaseId,
    revisionNumber: row.revisionNumber,
    schemaVersion: row.schemaVersion,
    definition: row.definition,
    createdAt: iso(row.createdAt),
  };
}

function artifactDto(row: ArtifactRow): ArtifactDto {
  return { id: row.id, type: row.type, mimeType: row.mimeType, size: row.size, sensitive: row.sensitive, createdAt: iso(row.createdAt) };
}

export function runDto(run: RunRow, revision: RevisionRow, steps: StepRunRow[], artifacts: ArtifactRow[]): RunDto {
  return {
    id: run.id,
    testCaseId: run.testCaseId,
    revisionId: run.revisionId,
    revisionNumber: revision.revisionNumber,
    environmentId: run.environmentId,
    environment: run.environmentSnapshot,
    inputs: run.inputsSnapshot,
    status: run.status,
    createdAt: iso(run.createdAt),
    startedAt: isoOrNull(run.startedAt),
    finishedAt: isoOrNull(run.finishedAt),
    cancellationRequestedAt: isoOrNull(run.cancellationRequestedAt),
    failureSummary: run.failureSummary ?? null,
    steps: steps.map(
      (s): StepRunDto => ({
        id: s.id,
        stepId: s.stepId,
        name: s.name,
        type: s.type,
        phase: s.phase,
        order: s.order,
        status: s.status,
        startedAt: isoOrNull(s.startedAt),
        finishedAt: isoOrNull(s.finishedAt),
        expected: s.expected ?? null,
        actual: s.actual ?? null,
        errorCode: s.errorCode ?? null,
        errorMessage: s.errorMessage ?? null,
        skipReason: s.skipReason ?? null,
        artifacts: artifacts.filter((a) => a.stepRunId === s.id).map(artifactDto),
      }),
    ),
  };
}
