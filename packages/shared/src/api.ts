import { z } from 'zod';
import type { Step } from './definition.ts';
import type { ErrorCode } from './errors.ts';
import type { RecorderWarning } from './recorder.ts';
import type { EnvironmentKind, RunStatus, StepPhase, StepStatus } from './status.ts';
import { environmentKindSchema } from './status.ts';
import { isValidVariableName } from './templates.ts';

/**
 * Request bodies and response DTOs of the REST API (PROJECT_RULES §18).
 * These hand-written schemas are the API contract; DB-derived types never leak into it.
 */

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(100);
const description = z.string().max(2000);

/** An origin: scheme + host + optional port, http/https only, no path/query/hash. */
export const originSchema = z.string().superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Must be an origin like https://shop.example:8443' });
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'Only http and https origins are allowed' });
  } else if (url.origin !== value) {
    ctx.addIssue({ code: 'custom', message: `Must be exactly an origin, e.g. ${url.origin}` });
  }
});

/** Absolute http(s) base URL; may carry a path prefix (e.g. https://api.example/v1), no query/hash. */
export const baseUrlSchema = z.string().superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Must be an absolute URL' });
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'Only http and https URLs are allowed' });
  }
  if (url.search || url.hash || url.username || url.password) {
    ctx.addIssue({ code: 'custom', message: 'Base URL must not contain credentials, query or hash' });
  }
});

// ---- Projects ----

export const createProjectSchema = z.strictObject({ name, description: description.default('') });
export const updateProjectSchema = z.strictObject({ name: name.optional(), description: description.optional() });
export type CreateProjectBody = z.input<typeof createProjectSchema>;

export interface ProjectDto {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Environments ----

export const createEnvironmentSchema = z.strictObject({
  name,
  kind: environmentKindSchema,
  frontendBaseUrl: baseUrlSchema,
  apiBaseUrl: baseUrlSchema,
  /** Extra origins (CDNs etc.). The base URL origins are always allowed. */
  allowedOrigins: z.array(originSchema).max(50).default([]),
  /** Explicit permission for loopback/private/link-local targets (cloud metadata stays blocked). */
  allowPrivateNetwork: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export const updateEnvironmentSchema = createEnvironmentSchema.partial();
export type CreateEnvironmentBody = z.input<typeof createEnvironmentSchema>;

export interface EnvironmentDto {
  id: string;
  projectId: string;
  name: string;
  kind: EnvironmentKind;
  frontendBaseUrl: string;
  apiBaseUrl: string;
  allowedOrigins: string[];
  /** allowedOrigins plus the origins of both base URLs. */
  effectiveAllowedOrigins: string[];
  allowPrivateNetwork: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Immutable copy stored on a run when it is created. */
export interface EnvironmentSnapshot {
  id: string;
  name: string;
  kind: EnvironmentKind;
  frontendBaseUrl: string;
  apiBaseUrl: string;
  allowedOrigins: string[];
  allowPrivateNetwork: boolean;
}

export function effectiveAllowedOrigins(env: { frontendBaseUrl: string; apiBaseUrl: string; allowedOrigins: readonly string[] }): string[] {
  return [...new Set([new URL(env.frontendBaseUrl).origin, new URL(env.apiBaseUrl).origin, ...env.allowedOrigins])];
}

// ---- Test cases and revisions ----

/** `definition` is validated server-side by its own schemaVersion, so it is `unknown` here. */
export const createTestCaseSchema = z.strictObject({
  name,
  description: description.default(''),
  definition: z.unknown(),
});

export const updateTestCaseSchema = z.strictObject({ name: name.optional(), description: description.optional() });

export const createRevisionSchema = z.strictObject({
  /** The revision the editor started from; must equal the current one, else REVISION_CONFLICT. */
  baseRevisionId: id.nullable(),
  definition: z.unknown(),
});

export interface TestCaseDto {
  id: string;
  projectId: string;
  name: string;
  description: string;
  currentRevisionId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRun: { id: string; status: RunStatus; createdAt: string } | null;
}

export interface RevisionDto {
  id: string;
  testCaseId: string;
  revisionNumber: number;
  schemaVersion: number;
  definition: unknown;
  createdAt: string;
}

// ---- Runs ----

export const inputValueSchema = z.union([z.string().max(10_000), z.number(), z.boolean()]);

export const createRunSchema = z.strictObject({
  environmentId: id,
  /** Defaults to the test case's current revision. */
  revisionId: id.optional(),
  inputs: z.record(z.string(), inputValueSchema).default({}),
});
export type CreateRunBody = z.input<typeof createRunSchema>;

export interface FailureSummary {
  code: ErrorCode;
  message: string;
  stepId?: string;
}

export interface RunDto {
  id: string;
  testCaseId: string;
  revisionId: string;
  revisionNumber: number;
  environmentId: string;
  environment: EnvironmentSnapshot;
  inputs: Record<string, string | number | boolean>;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancellationRequestedAt: string | null;
  failureSummary: FailureSummary | null;
  steps: StepRunDto[];
}

export interface StepRunDto {
  id: string;
  stepId: string;
  name: string;
  type: string;
  phase: StepPhase;
  order: number;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  expected: unknown;
  actual: unknown;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  skipReason: string | null;
  artifacts: ArtifactDto[];
}

export interface ArtifactDto {
  id: string;
  type: string;
  mimeType: string;
  size: number;
  sensitive: boolean;
  createdAt: string;
}

// ---- Secrets ----

export const createSecretSchema = z.strictObject({
  name: z.string().refine(isValidVariableName, 'Use letters, digits and "_", starting with a letter, e.g. testPassword'),
  /** Never echoed back. Minimum length is enforced by the server (SECRET_TOO_SHORT). */
  value: z.string().min(1).max(10_000),
});
export const replaceSecretSchema = z.strictObject({ value: z.string().min(1).max(10_000) });
export type CreateSecretBody = z.input<typeof createSecretSchema>;

/** A secret as the API shows it: the value is never included. */
export interface SecretDto {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Login sessions (auth profiles) ----

/** First page of a login capture or a recording, relative to the website address. */
const startPathSchema = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)/, 'Must start with a single "/", e.g. /login')
  .default('/');

export const createAuthCaptureSchema = z.strictObject({
  environmentId: id,
  name,
  /** Page opened first, e.g. /login. */
  startPath: startPathSchema,
});
export type CreateAuthCaptureBody = z.input<typeof createAuthCaptureSchema>;

export const AUTH_CAPTURE_STATUSES = ['starting', 'waiting_for_login', 'saving', 'saved', 'failed', 'cancelled'] as const;
export type AuthCaptureStatus = (typeof AUTH_CAPTURE_STATUSES)[number];

export interface AuthCaptureDto {
  id: string;
  projectId: string;
  environmentId: string;
  profileName: string;
  startPath: string;
  status: AuthCaptureStatus;
  error: string | null;
  authProfileId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** A saved login session; the storage state itself is never returned. */
export interface AuthProfileDto {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Recorder ----

export const createRecordingSchema = z.strictObject({
  environmentId: id,
  startPath: startPathSchema,
  /** The test the draft is meant for (informational). */
  testCaseId: id.optional(),
});
export type CreateRecordingBody = z.input<typeof createRecordingSchema>;

export const RECORDING_STATUSES = ['starting', 'recording', 'stopping', 'stopped', 'failed'] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/** A recording with its draft steps, derived from the recorded events on every read. */
export interface RecordingDto {
  id: string;
  projectId: string;
  environmentId: string;
  testCaseId: string | null;
  startPath: string;
  status: RecordingStatus;
  error: string | null;
  eventCount: number;
  steps: Step[];
  warnings: RecorderWarning[];
  createdAt: string;
  finishedAt: string | null;
}
