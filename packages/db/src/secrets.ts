import { and, asc, eq, inArray } from 'drizzle-orm';
import { getProject } from './catalog.ts';
import type { FlowDb } from './client.ts';
import { notFound, RepoError } from './errors.ts';
import { newId } from './ids.ts';
import { secrets } from './schema.ts';
import { decryptSecret, encryptSecret, type MasterKey, secretOwner } from './secret-box.ts';

/** Shortest accepted secret: shorter values cannot be redacted reliably (PROJECT_RULES §11). */
export const MIN_SECRET_LENGTH = 8;

export interface SecretInfo {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

const info = (row: typeof secrets.$inferSelect): SecretInfo => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

function checkLength(value: string) {
  if (value.length < MIN_SECRET_LENGTH) {
    throw new RepoError(
      'SECRET_TOO_SHORT',
      `A secret must have at least ${MIN_SECRET_LENGTH} characters so it can be hidden reliably in reports`,
    );
  }
}

export function listSecrets(db: FlowDb, projectId: string): SecretInfo[] {
  getProject(db, projectId);
  return db.select().from(secrets).where(eq(secrets.projectId, projectId)).orderBy(asc(secrets.name)).all().map(info);
}

export function createSecret(db: FlowDb, master: MasterKey, projectId: string, name: string, value: string, now = Date.now()): SecretInfo {
  getProject(db, projectId);
  checkLength(value);
  if (
    db
      .select({ id: secrets.id })
      .from(secrets)
      .where(and(eq(secrets.projectId, projectId), eq(secrets.name, name)))
      .get()
  ) {
    throw new RepoError('VALIDATION_ERROR', `A secret named "${name}" already exists; replace its value instead`, { name });
  }
  const row = db
    .insert(secrets)
    .values({
      id: newId(now),
      projectId,
      name,
      encryptedValue: encryptSecret(master, secretOwner(projectId, name), value),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return info(row);
}

export function replaceSecretValue(db: FlowDb, master: MasterKey, id: string, value: string, now = Date.now()): SecretInfo {
  const row = db.select().from(secrets).where(eq(secrets.id, id)).get();
  if (!row) throw notFound('Secret', id);
  checkLength(value);
  const updated = db
    .update(secrets)
    .set({ encryptedValue: encryptSecret(master, secretOwner(row.projectId, row.name), value), updatedAt: now })
    .where(eq(secrets.id, id))
    .returning()
    .get();
  return info(updated as typeof secrets.$inferSelect);
}

export function deleteSecret(db: FlowDb, id: string): void {
  const result = db.delete(secrets).where(eq(secrets.id, id)).run();
  if (result.changes === 0) throw notFound('Secret', id);
}

/** Names from `wanted` that the project does not have. */
export function missingSecrets(db: FlowDb, projectId: string, wanted: readonly string[]): string[] {
  if (wanted.length === 0) return [];
  const present = new Set(
    db
      .select({ name: secrets.name })
      .from(secrets)
      .where(and(eq(secrets.projectId, projectId), inArray(secrets.name, [...wanted])))
      .all()
      .map((r) => r.name),
  );
  return wanted.filter((name) => !present.has(name));
}

/** Decrypts the requested secrets for a run. Throws SECRET_NOT_FOUND for any missing name. */
export function revealSecrets(db: FlowDb, master: MasterKey, projectId: string, wanted: readonly string[]): Record<string, string> {
  const missing = missingSecrets(db, projectId, wanted);
  if (missing.length > 0) throw new RepoError('SECRET_NOT_FOUND', `Missing secret(s): ${missing.join(', ')}`, { missing });
  if (wanted.length === 0) return {};
  const rows = db
    .select()
    .from(secrets)
    .where(and(eq(secrets.projectId, projectId), inArray(secrets.name, [...wanted])))
    .all();
  return Object.fromEntries(rows.map((row) => [row.name, decryptSecret(master, secretOwner(projectId, row.name), row.encryptedValue)]));
}
