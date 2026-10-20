import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  createSecret,
  type DatabaseHandle,
  decryptSecret,
  deleteProject,
  deleteSecret,
  encryptSecret,
  listSecrets,
  loadMasterKey,
  missingSecrets,
  openDatabase,
  replaceSecretValue,
  revealSecrets,
} from '../src/index.ts';

let dir: string;
let handle: DatabaseHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowcheck-secrets-'));
  handle = openDatabase(join(dir, 'test.db'));
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('secret box', () => {
  it('generates a key file once and reuses it', () => {
    const a = loadMasterKey(dir, {});
    const b = loadMasterKey(dir, {});
    expect(a.source).toBe('key-file');
    expect(a.key.equals(b.key)).toBe(true);
    expect(readFileSync(join(dir, 'master.key'), 'utf8')).toMatch(/^base64:/);
  });

  it('accepts a base64 key or a long passphrase, and rejects weak ones', () => {
    expect(loadMasterKey(dir, { FLOWCHECK_MASTER_KEY: `base64:${Buffer.alloc(32, 7).toString('base64')}` }).source).toBe('env-key');
    expect(loadMasterKey(dir, { FLOWCHECK_MASTER_KEY: 'a long enough passphrase' }).source).toBe('env-passphrase');
    expect(() => loadMasterKey(dir, { FLOWCHECK_MASTER_KEY: 'short' })).toThrow(/at least 16/);
    expect(() => loadMasterKey(dir, { FLOWCHECK_MASTER_KEY: 'base64:AAAA' })).toThrow(/32 bytes/);
  });

  it('round-trips and binds the ciphertext to its owner', () => {
    const key = loadMasterKey(dir, {});
    const sealed = encryptSecret(key, 'p1:password', 'S3cret-value!');
    expect(sealed).not.toContain('S3cret');
    expect(decryptSecret(key, 'p1:password', sealed)).toBe('S3cret-value!');
    // Moved to another secret or project: authentication fails.
    expect(() => decryptSecret(key, 'p1:other', sealed)).toThrow();
    expect(() => decryptSecret(key, 'p2:password', sealed)).toThrow();
    // Tampered ciphertext: authentication fails.
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(key, 'p1:password', parts.join('.'))).toThrow();
    // Another key cannot open it.
    const other = loadMasterKey(dir, { FLOWCHECK_MASTER_KEY: `base64:${Buffer.alloc(32, 9).toString('base64')}` });
    expect(() => decryptSecret(other, 'p1:password', sealed)).toThrow();
  });
});

describe('secrets repository', () => {
  it('stores only ciphertext and never returns the value', () => {
    const key = loadMasterKey(dir, {});
    const project = createProject(handle.db, { name: 'P', description: '' });
    const created = createSecret(handle.db, key, project.id, 'password', 'correct horse battery');
    expect(JSON.stringify(created)).not.toContain('correct horse');
    expect(JSON.stringify(listSecrets(handle.db, project.id))).not.toContain('correct horse');
    const raw = handle.sqlite.prepare('select encrypted_value from secrets').get() as { encrypted_value: string };
    expect(raw.encrypted_value).not.toContain('correct horse');
    expect(revealSecrets(handle.db, key, project.id, ['password'])).toEqual({ password: 'correct horse battery' });

    replaceSecretValue(handle.db, key, created.id, 'another value 123');
    expect(revealSecrets(handle.db, key, project.id, ['password'])).toEqual({ password: 'another value 123' });
  });

  it('rejects short values and duplicate names, reports missing ones', () => {
    const key = loadMasterKey(dir, {});
    const project = createProject(handle.db, { name: 'P', description: '' });
    expect(() => createSecret(handle.db, key, project.id, 'pin', '1234567')).toThrow(expect.objectContaining({ code: 'SECRET_TOO_SHORT' }));
    createSecret(handle.db, key, project.id, 'token', '12345678');
    expect(() => createSecret(handle.db, key, project.id, 'token', 'abcdefgh')).toThrow(/already exists/);
    expect(missingSecrets(handle.db, project.id, ['token', 'apiKey'])).toEqual(['apiKey']);
    expect(() => revealSecrets(handle.db, key, project.id, ['apiKey'])).toThrow(expect.objectContaining({ code: 'SECRET_NOT_FOUND' }));
  });

  it('is removed with its project and can be deleted', () => {
    const key = loadMasterKey(dir, {});
    const project = createProject(handle.db, { name: 'P', description: '' });
    const s = createSecret(handle.db, key, project.id, 'token', '12345678');
    deleteSecret(handle.db, s.id);
    expect(listSecrets(handle.db, project.id)).toEqual([]);
    createSecret(handle.db, key, project.id, 'token', '12345678');
    deleteProject(handle.db, project.id);
    expect((handle.sqlite.prepare('select count(*) as n from secrets').get() as { n: number }).n).toBe(0);
  });
});
