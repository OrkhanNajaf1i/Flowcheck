import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Encryption at rest for secrets and auth profiles (PROJECT_RULES §11).
 * AES-256-GCM, a random 12-byte IV per value, and the owner ("<projectId>:<name>") as
 * additional authenticated data, so a ciphertext cannot be moved to another secret.
 *
 * Master key sources, in order:
 * 1. FLOWCHECK_MASTER_KEY="base64:<32 bytes>" — used directly;
 * 2. FLOWCHECK_MASTER_KEY=<passphrase of at least 16 characters> — derived with scrypt and a salt
 *    stored in <dataDir>/kdf.json (losing that file loses the secrets, too);
 * 3. <dataDir>/master.key — generated on first use (file mode 0600 where the OS supports it).
 * If the key is lost, stored secrets cannot be recovered. There is no key rotation in v1.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const MIN_PASSPHRASE = 16;

export interface MasterKey {
  key: Buffer;
  source: 'env-key' | 'env-passphrase' | 'key-file';
  /** Set when the key file permissions could not be restricted (e.g. on Windows). */
  warning?: string;
}

export function loadMasterKey(dataDir: string, env: NodeJS.ProcessEnv = process.env): MasterKey {
  const configured = env.FLOWCHECK_MASTER_KEY?.trim();
  if (configured) {
    if (configured.startsWith('base64:')) {
      const key = Buffer.from(configured.slice('base64:'.length), 'base64');
      if (key.length !== KEY_BYTES) throw new Error(`FLOWCHECK_MASTER_KEY must decode to ${KEY_BYTES} bytes`);
      return { key, source: 'env-key' };
    }
    if (configured.length < MIN_PASSPHRASE) {
      throw new Error(`FLOWCHECK_MASTER_KEY passphrase must have at least ${MIN_PASSPHRASE} characters (or use base64:<32 bytes>)`);
    }
    return { key: scryptSync(configured, readOrCreateSalt(dataDir), KEY_BYTES), source: 'env-passphrase' };
  }

  const file = join(dataDir, 'master.key');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `base64:${randomBytes(KEY_BYTES).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  }
  const text = readFileSync(file, 'utf8').trim();
  const key = Buffer.from(text.replace(/^base64:/, ''), 'base64');
  if (key.length !== KEY_BYTES) throw new Error(`${file} does not contain a ${KEY_BYTES}-byte key`);
  return { key, source: 'key-file', ...keyFileWarning(file) };
}

function keyFileWarning(file: string): { warning?: string } {
  if (process.platform === 'win32') {
    return { warning: `${file} cannot be restricted with file modes on Windows; keep the data folder inside your user profile.` };
  }
  try {
    chmodSync(file, 0o600);
    return {};
  } catch {
    return { warning: `Could not restrict permissions of ${file}.` };
  }
}

function readOrCreateSalt(dataDir: string): Buffer {
  const file = join(dataDir, 'kdf.json');
  if (!existsSync(file)) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ salt: randomBytes(16).toString('base64') }), { mode: 0o600, flag: 'wx' });
  }
  return Buffer.from((JSON.parse(readFileSync(file, 'utf8')) as { salt: string }).salt, 'base64');
}

/** "v1.<iv>.<tag>.<ciphertext>" (base64 parts). */
export function encryptSecret(master: MasterKey, owner: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', master.key, iv);
  cipher.setAAD(Buffer.from(owner, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(master: MasterKey, owner: string, sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', master.key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(owner, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  // Throws if the key, owner or ciphertext does not match.
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export const secretOwner = (projectId: string, name: string) => `${projectId}:${name}`;
