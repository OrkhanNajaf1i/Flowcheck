import type {
  ApiError as ApiErrorBody,
  AuthCaptureDto,
  AuthProfileDto,
  CreateAuthCaptureBody,
  CreateEnvironmentBody,
  CreateProjectBody,
  CreateRunBody,
  EnvironmentDto,
  ErrorCode,
  FailureSummary,
  ProjectDto,
  RevisionDto,
  RunDto,
  RunStatus,
  SecretDto,
  TestCaseDto,
  ValidationIssue,
} from '@flowcheck/shared';
import ky, { HTTPError } from 'ky';

/** API failure in the standard `{ error: { code, message, details } }` format. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  get issues(): ValidationIssue[] {
    const issues = this.details.issues;
    return Array.isArray(issues) ? (issues as ValidationIssue[]) : [];
  }
}

const http = ky.create({
  prefix: '/api',
  // Same origin as the page (the server or the Vite proxy); explicit so non-browser fetch resolves it too.
  baseUrl: globalThis.location?.origin,
  // No hidden retries: a failed POST must never be sent twice.
  retry: 0,
  timeout: 30_000,
});

async function call<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof HTTPError) {
      const data = error.data as Partial<ApiErrorBody> | undefined;
      if (data?.error) throw new ApiError(error.response.status, data.error);
      throw new ApiError(error.response.status, { code: 'INTERNAL_ERROR', message: `HTTP ${error.response.status}`, details: {} });
    }
    throw error;
  }
}

const get = <T>(path: string) => call(http.get(path).json<T>());
const post = <T>(path: string, json?: unknown) => call(http.post(path, json === undefined ? {} : { json }).json<T>());
const patch = <T>(path: string, json: unknown) => call(http.patch(path, { json }).json<T>());
const del = (path: string) => call(http.delete(path).then(() => undefined));

export interface RunListItem {
  id: string;
  status: RunStatus;
  revisionId: string;
  environmentId: string;
  createdAt: string;
  finishedAt: string | null;
  failureSummary: FailureSummary | null;
}

export const api = {
  projects: () => get<ProjectDto[]>('projects'),
  project: (id: string) => get<ProjectDto>(`projects/${id}`),
  createProject: (body: CreateProjectBody) => post<ProjectDto>('projects', body),
  deleteProject: (id: string) => del(`projects/${id}`),

  authProfiles: (projectId: string) => get<AuthProfileDto[]>(`projects/${projectId}/auth-profiles`),
  deleteAuthProfile: (id: string) => del(`auth-profiles/${id}`),
  startAuthCapture: (projectId: string, body: CreateAuthCaptureBody) => post<AuthCaptureDto>(`projects/${projectId}/auth-captures`, body),
  authCapture: (id: string) => get<AuthCaptureDto>(`auth-captures/${id}`),
  saveAuthCapture: (id: string) => post<AuthCaptureDto>(`auth-captures/${id}/save`),
  cancelAuthCapture: (id: string) => post<AuthCaptureDto>(`auth-captures/${id}/cancel`),

  secrets: (projectId: string) => get<SecretDto[]>(`projects/${projectId}/secrets`),
  createSecret: (projectId: string, body: { name: string; value: string }) => post<SecretDto>(`projects/${projectId}/secrets`, body),
  replaceSecret: (id: string, value: string) => call(http.put(`secrets/${id}`, { json: { value } }).json<SecretDto>()),
  deleteSecret: (id: string) => del(`secrets/${id}`),

  environments: (projectId: string) => get<EnvironmentDto[]>(`projects/${projectId}/environments`),
  createEnvironment: (projectId: string, body: CreateEnvironmentBody) => post<EnvironmentDto>(`projects/${projectId}/environments`, body),
  updateEnvironment: (id: string, body: Partial<CreateEnvironmentBody>) => patch<EnvironmentDto>(`environments/${id}`, body),

  testCases: (projectId: string, includeArchived = false) =>
    get<TestCaseDto[]>(`projects/${projectId}/test-cases?includeArchived=${includeArchived}`),
  testCase: (id: string) => get<TestCaseDto>(`test-cases/${id}`),
  createTestCase: (projectId: string, body: { name: string; description: string; definition: unknown }) =>
    post<{ testCase: TestCaseDto; revision: RevisionDto }>(`projects/${projectId}/test-cases`, body),
  updateTestCase: (id: string, body: { name?: string; description?: string }) => patch<TestCaseDto>(`test-cases/${id}`, body),
  archiveTestCase: (id: string) => post<TestCaseDto>(`test-cases/${id}/archive`),
  duplicateTestCase: (id: string) => post<{ testCase: TestCaseDto; revision: RevisionDto }>(`test-cases/${id}/duplicate`),

  revisions: (testCaseId: string) => get<RevisionDto[]>(`test-cases/${testCaseId}/revisions`),
  revision: (id: string) => get<RevisionDto>(`revisions/${id}`),
  saveRevision: (testCaseId: string, body: { baseRevisionId: string | null; definition: unknown }) =>
    post<RevisionDto>(`test-cases/${testCaseId}/revisions`, body),

  runs: (testCaseId: string) => get<RunListItem[]>(`test-cases/${testCaseId}/runs`),
  run: (id: string) => get<RunDto>(`runs/${id}`),
  startRun: (testCaseId: string, body: CreateRunBody) => post<{ runId: string }>(`test-cases/${testCaseId}/runs`, body),
  cancelRun: (id: string) => post<{ runId: string; status: RunStatus }>(`runs/${id}/cancel`),

  artifactUrl: (runId: string, artifactId: string) => `/api/runs/${runId}/artifacts/${artifactId}`,
};
