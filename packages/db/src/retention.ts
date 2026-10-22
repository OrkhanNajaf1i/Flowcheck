import { eq, inArray } from 'drizzle-orm';
import type { FlowDb } from './client.ts';
import { artifacts, testCases, testRuns } from './schema.ts';

export interface RetentionPolicy {
  /** Artifacts older than this are removed (PROJECT_RULES §16: 30 days). */
  maxAgeMs: number;
  /** Per-project budget; above it the oldest artifacts are removed first (500 MB). */
  projectQuotaBytes: number;
}

export interface PrunedArtifact {
  id: string;
  relativePath: string;
  size: number;
  reason: 'age' | 'quota';
}

const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const;

/**
 * Removes artifact rows by age and per-project quota and returns them so the caller can delete
 * the files. Artifacts of queued or running runs are never touched; they still count towards the
 * quota, so a project over budget loses its oldest finished artifacts first.
 */
export function pruneArtifacts(db: FlowDb, policy: RetentionPolicy, now = Date.now()): PrunedArtifact[] {
  return db.transaction(
    (tx) => {
      const rows = tx
        .select({
          id: artifacts.id,
          relativePath: artifacts.relativePath,
          size: artifacts.size,
          createdAt: artifacts.createdAt,
          projectId: testCases.projectId,
          runStatus: testRuns.status,
        })
        .from(artifacts)
        .innerJoin(testRuns, eq(artifacts.runId, testRuns.id))
        .innerJoin(testCases, eq(testRuns.testCaseId, testCases.id))
        .all();

      const pruned: PrunedArtifact[] = [];
      const byProject = new Map<string, typeof rows>();
      for (const row of rows) {
        const removable = !(ACTIVE_RUN_STATUSES as readonly string[]).includes(row.runStatus);
        if (removable && row.createdAt < now - policy.maxAgeMs) {
          pruned.push({ id: row.id, relativePath: row.relativePath, size: row.size, reason: 'age' });
          continue;
        }
        byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row]);
      }
      for (const kept of byProject.values()) {
        let total = kept.reduce((sum, r) => sum + r.size, 0);
        const oldestFirst = kept
          .filter((r) => !(ACTIVE_RUN_STATUSES as readonly string[]).includes(r.runStatus))
          .sort((a, b) => a.createdAt - b.createdAt);
        for (const row of oldestFirst) {
          if (total <= policy.projectQuotaBytes) break;
          pruned.push({ id: row.id, relativePath: row.relativePath, size: row.size, reason: 'quota' });
          total -= row.size;
        }
      }
      if (pruned.length > 0) {
        tx.delete(artifacts)
          .where(
            inArray(
              artifacts.id,
              pruned.map((p) => p.id),
            ),
          )
          .run();
      }
      return pruned;
    },
    { behavior: 'immediate' },
  );
}
